const fs = require('node:fs');
const path = require('node:path');
const mineflayer = require('mineflayer');
const config = require('../config.json');
const { analyzeImage } = require('./vision');
const { generateStructure } = require('./generator');
const { validateStructure } = require('./optimizer');
const { Builder } = require('./builder');
const { createChatHandler } = require('./chat');
const { createWebServer } = require('./webserver');
const sharp = require('sharp');
const { estimateDepth } = require('./depth');
const { voxelizeScene } = require('./voxelizer');
const { composite } = require('./composite');
const { parseModel } = require('./mesh');
const { voxelizeMesh } = require('./meshvoxelizer');
const { loadBlockColors, filterColors, NATURAL_BLOCKS, CONSTRUCTION_BLOCKS } = require('./blockcolors');
const { clusterColors, assignThemes, buildThemePicker, themeOfBlock } = require('./palette');
const { THEME_BLOCKS } = require('./blockcolors');
const { createUnderground } = require('./subsurface');
const { createClient } = require('./llm');
const { cleanTriangles } = require('./meshclean');
const { analyzeStructure } = require('./structure-analysis');
const { terrainFromHeightmap } = require('./terrain');

const validBlocks = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/valid_blocks.json'), 'utf8')
);

function structureSize(blocks) {
  const max = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    max.x = Math.max(max.x, b.x);
    max.y = Math.max(max.y, b.y);
    max.z = Math.max(max.z, b.z);
  }
  return { x: max.x + 1, y: max.y + 1, z: max.z + 1 };
}

function createBot(cfg) {
  const bot = mineflayer.createBot({
    host: cfg.minecraft.host,
    port: cfg.minecraft.port,
    username: cfg.minecraft.username,
    version: cfg.minecraft.version,
    auth: 'offline'
  });

  const pending = new Map();
  const builder = new Builder(bot, { maxBlocks: cfg.limits.max_blocks, cmdsPerTick: cfg.limits.throttle_cmds_per_tick });
  const handleChat = createChatHandler({ bot, builder, config: cfg, pending });

  bot.on('spawn', () => console.log('[bot] connecté et apparu en jeu'));
  bot.on('message', (m) => {
    const t = m.toString();
    if (!/Changed the block|Successfully filled|Avancement|Palette|Construction de|!go|!status/.test(t)) {
      console.log('[mc]', t.slice(0, 200));
    }
  });
  bot.on('kicked', (reason) => console.error('[bot] kick:', reason));
  bot.on('error', (err) => console.error('[bot] erreur:', err.message));
  bot.on('chat', handleChat);

  const blockColors = loadBlockColors();
  const colorsNature = filterColors(blockColors, NATURAL_BLOCKS);
  const colorsBati = filterColors(blockColors, new Set([...NATURAL_BLOCKS, ...CONSTRUCTION_BLOCKS]));
  const materiaux = validBlocks.filter((b) => CONSTRUCTION_BLOCKS.has(b) || b === 'air');
  const dio = cfg.limits.diorama;
  let apiClient = null;
  try { apiClient = createClient(); } catch { /* pas de clé : repli plus-proche-voisin */ }

  async function deliberatePalette(samples, allowedColors, contexte) {
    const centroids = clusterColors(samples, 8);
    const themes = await assignThemes(centroids, allowedColors, { client: apiClient, contexte });
    const uniques = [...new Set(themes)];
    const detail = uniques
      .map((t) => `${t} (${[...THEME_BLOCKS[t]].filter((b) => allowedColors.has(b)).length} blocs)`)
      .join(', ');
    bot.chat(`Palette par thèmes : ${detail}`);
    return buildThemePicker(centroids, themes, allowedColors);
  }

  function proposeStructure(username, blocks, description, { maxSize, maxBlocks }) {
    const check = validateStructure(blocks, {
      maxSize,
      maxBlocks,
      validBlocks
    });
    if (!check.ok) {
      bot.chat(`${username} : structure invalide — ${check.errors[0]}`);
      throw new Error(check.errors.join(' ; '));
    }
    const size = structureSize(blocks);
    pending.set(username, { blocks, size, description });
    bot.chat(`Construction de ${description.type_batiment} (${size.x}x${size.z}x${size.y}, ${blocks.length} blocs) devant toi. Tape !go pour confirmer, !cancel pour annuler.`);
    return 'proposition envoyée en jeu, tape !go dans le chat Minecraft';
  }

  async function onDiorama(username, buffer, mimeType) {
    bot.chat(`Photo reçue de ${username}, création du diorama en cours (~1 min)...`);
    const [depthMap, description] = await Promise.all([
      estimateDepth(buffer),
      analyzeImage(buffer.toString('base64'), mimeType, { maxSize: dio.size_x, validBlocks })
    ]);
    const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const image = { data, width: info.width, height: info.height };
    const pixelSamples = [];
    const stride = Math.max(3, Math.floor((data.length / 3 / 4000)) * 3);
    for (let i = 0; i + 2 < data.length; i += stride) pixelSamples.push([data[i], data[i + 1], data[i + 2]]);
    const paletteScene = await deliberatePalette(
      pixelSamples, colorsNature, description.erreur ? 'paysage extérieur' : `paysage autour de : ${description.type_batiment}`
    );
    const seed = Math.floor(Math.random() * 2 ** 31);
    console.log(`[diorama] graine sous-sol : ${seed}`);
    const underground = createUnderground({ seed, maxY: dio.max_y });
    let blocks = voxelizeScene(image, depthMap, {
      sizeX: dio.size_x, sizeZ: dio.size_z, maxY: dio.max_y, colors: paletteScene,
      underground, surfaceThemeOf: themeOfBlock
    });
    const zone = description.erreur ? null : description.zone_batiment;
    if (zone) {
      const x1 = Math.max(0, Math.round(zone.x / 100 * dio.size_x));
      const x2 = Math.min(dio.size_x - 1, Math.round((zone.x + zone.largeur) / 100 * dio.size_x));
      const cu = (zone.x + zone.largeur / 2) / 100;
      const cv = (zone.y + zone.hauteur / 2) / 100;
      const dCentre = depthMap.data[
        Math.min(depthMap.height - 1, Math.round(cv * (depthMap.height - 1))) * depthMap.width +
        Math.min(depthMap.width - 1, Math.round(cu * (depthMap.width - 1)))
      ];
      const zAnchor = (dio.size_z - 1) - Math.round(dCentre * (dio.size_z - 1));
      const bWidth = Math.max(4, x2 - x1 + 1);
      const bHeight = Math.max(4, Math.round(zone.hauteur / 100 * dio.max_y));
      const buildingDesc = {
        ...description,
        dimensions_estimees: { largeur: bWidth, profondeur: Math.min(bWidth, dio.size_z), hauteur: bHeight }
      };
      const building = await generateStructure(buildingDesc, {
        timeoutMs: cfg.limits.sandbox_timeout_ms, validBlocks: materiaux
      });
      blocks = composite(blocks, building, { x1, x2, zAnchor });
    }
    const desc = description.erreur
      ? { type_batiment: 'diorama' }
      : { ...description, type_batiment: `diorama : ${description.type_batiment}` };
    return proposeStructure(username, blocks, desc, { maxSize: Math.max(dio.size_x, dio.max_y, dio.size_z), maxBlocks: dio.max_blocks });
  }

  async function onModel(username, buffer, ext) {
    bot.chat(`Modèle 3D (${ext}) reçu de ${username}, voxelisation...`);
    const { triangles, warning } = await parseModel(buffer, ext);
    if (warning) bot.chat(`${username} : ${warning}`);
    const cleaned = cleanTriangles(triangles);
    if (cleaned.removed > 0) bot.chat(`Nettoyage du scan : ${cleaned.removed} triangles de débris ignorés.`);
    const seed = Math.floor(Math.random() * 2 ** 31);
    console.log(`[modele] graine sous-sol : ${seed}`);
    const underground = createUnderground({ seed, maxY: dio.max_y });
    // voxelisation de référence (sert d'analyse en mode inspire, de rendu en mode brut)
    const colored = cleaned.triangles.filter((t) => t.color);
    let colors = colorsBati;
    if (colored.length > 0) {
      const step = Math.max(1, Math.floor(colored.length / 4000));
      const samples = [];
      for (let i = 0; i < colored.length; i += step) samples.push(colored[i].color);
      colors = await deliberatePalette(samples, colorsBati, `modèle 3D scanné (${ext})`);
    }
    const reference = voxelizeMesh(cleaned.triangles, {
      maxX: dio.size_x, maxY: dio.max_y, maxZ: dio.size_z,
      defaultBlock: 'stone', colors, zUp: ext === 'stl',
      solid: true, underground, surfaceThemeOf: themeOfBlock
    });
    let blocks = reference;
    if ((cfg.reconstruction || 'inspire') === 'inspire') {
      const summary = analyzeStructure(reference);
      const building = await generateStructure(
        { type_batiment: `reconstruction fidèle du modèle 3D (${ext})` },
        { timeoutMs: cfg.limits.sandbox_timeout_ms, validBlocks: materiaux, structuralSummary: summary }
      );
      const bSize = { x: 0, y: 0, z: 0 };
      for (const b of building) {
        bSize.x = Math.max(bSize.x, b.x + 1);
        bSize.y = Math.max(bSize.y, b.y + 1);
        bSize.z = Math.max(bSize.z, b.z + 1);
      }
      const hillHeight = Math.max(8, Math.min(24, Math.round(summary.dims.y / 3)));
      const terrain = terrainFromHeightmap(summary.heightmap, {
        sizeX: dio.size_x, sizeZ: dio.size_z, maxHeight: hillHeight,
        underground, taperWidth: 12
      });
      const offX = Math.floor((dio.size_x - bSize.x) / 2);
      const offZ = Math.floor((dio.size_z - bSize.z) / 2);
      let topY = 0;
      for (const t of terrain) {
        if (t.x >= offX && t.x < offX + bSize.x && t.z >= offZ && t.z < offZ + bSize.z) {
          topY = Math.max(topY, t.y);
        }
      }
      const placed = building.map((b) => ({ x: b.x + offX, y: b.y + topY + 1, z: b.z + offZ, block: b.block }));
      blocks = terrain.concat(placed);
      bot.chat(`Reconstruction inspirée : bâtiment ${bSize.x}x${bSize.z}x${bSize.y} posé sur un relief de ${hillHeight} blocs.`);
    }
    return proposeStructure(username, blocks, { type_batiment: `modèle 3D (${ext})` }, { maxSize: Math.max(dio.size_x, dio.max_y, dio.size_z), maxBlocks: dio.max_blocks });
  }

  async function onPhoto(username, buffer, mimeType) {
    bot.chat(`Photo reçue de ${username}, analyse en cours...`);
    const description = await analyzeImage(buffer.toString('base64'), mimeType, {
      maxSize: cfg.limits.max_size,
      validBlocks
    });
    if (description.erreur) {
      bot.chat(`${username} : analyse impossible — ${description.erreur}`);
      return `erreur : ${description.erreur}`;
    }
    const blocks = await generateStructure(description, {
      timeoutMs: cfg.limits.sandbox_timeout_ms,
      validBlocks: materiaux
    });
    return proposeStructure(username, blocks, description, { maxSize: cfg.limits.max_size, maxBlocks: cfg.limits.max_blocks });
  }

  const app = createWebServer({ onPhoto, onDiorama, onModel });
  app.listen(cfg.web.port, () =>
    console.log(`[web] upload sur http://${cfg.web.public_host}:${cfg.web.port}/upload/<pseudo>`)
  );

  return bot;
}

if (require.main === module) createBot(config);
module.exports = { createBot };
