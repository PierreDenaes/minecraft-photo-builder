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
const { renderVoxels } = require('./render');
const { enforceSupport } = require('./support');
const { plantVegetation } = require('./vegetation');
const { decorateInterior } = require('./decorator');

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
    pending.set(username.toLowerCase(), { blocks, size, description });
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

  async function onModel(username, buffer, ext, mode) {
    bot.chat(`Modèle 3D (${ext}) reçu de ${username}, voxelisation...`);
    const { triangles, warning } = await parseModel(buffer, ext);
    if (warning) bot.chat(`${username} : ${warning}`);
    const cleaned = cleanTriangles(triangles);
    if (cleaned.removed > 0) bot.chat(`Nettoyage du scan : ${cleaned.removed} triangles de débris ignorés.`);

    if (mode === 'statue') {
      const colorsStatue = filterColors(blockColors, THEME_BLOCKS.couleurs_vives);
      // Un personnage debout est plus haut que large : son axe le plus long est la verticale
      const span = [0, 1, 2].map((a) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const t of cleaned.triangles) {
          for (const p of [t.a, t.b, t.c]) { lo = Math.min(lo, p[a]); hi = Math.max(hi, p[a]); }
        }
        return hi - lo;
      });
      const up = span[1] >= span[0] && span[1] >= span[2] ? 'y' : span[2] >= span[0] ? 'z' : 'x';
      if (up !== 'y') console.log(`[statue] modèle ${up}-up détecté — redressé`);
      const shell = voxelizeMesh(cleaned.triangles, {
        maxX: 48, maxY: 72, maxZ: 48, defaultBlock: 'white_concrete',
        colors: colorsStatue, up
      });
      const statue = enforceSupport(shell).blocks.map((b) => ({ ...b, y: b.y + 2 }));
      let sx = 0;
      let sz = 0;
      for (const b of statue) { sx = Math.max(sx, b.x); sz = Math.max(sz, b.z); }
      const socle = [];
      for (let x = -1; x <= sx + 1; x++) for (let z = -1; z <= sz + 1; z++) for (let y = 0; y <= 1; y++) {
        socle.push({ x: x + 1, y, z: z + 1, block: 'smooth_stone' });
      }
      const statueBlocks = socle.concat(statue.map((b) => ({ ...b, x: b.x + 1, z: b.z + 1 })));
      bot.chat(`Statue voxelisée : ${sx + 1}x${sz + 1} sur socle.`);
      return proposeStructure(username, statueBlocks, { type_batiment: `statue (${ext})` }, { maxSize: 96, maxBlocks: cfg.limits.max_blocks });
    }

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
    const inspire = (cfg.reconstruction || 'inspire') === 'inspire';
    // mode inspire : la référence analysée est la coquille seule (les strates
    // géologiques noieraient les thèmes du bâtiment sous « roche »)
    const reference = voxelizeMesh(cleaned.triangles, {
      maxX: dio.size_x, maxY: dio.max_y, maxZ: dio.size_z,
      defaultBlock: 'stone', colors, zUp: ext === 'stl',
      solid: !inspire, underground: inspire ? undefined : underground, surfaceThemeOf: themeOfBlock
    });
    let blocks = reference;
    if (inspire) {
      const summary = analyzeStructure(reference);
      const rendered = await renderVoxels(reference, blockColors);
      const sceneDesc = await analyzeImage(rendered.toString('base64'), 'image/png', {
        maxSize: dio.size_x, validBlocks
      });
      const env = (!sceneDesc.erreur && sceneDesc.environnement) || {};
      if (env.ambiance) bot.chat(`Ambiance : ${env.ambiance}`);
      const buildingDesc = sceneDesc.erreur
        ? { type_batiment: `reconstruction du modèle 3D (${ext})` }
        : sceneDesc;
      const generated = await generateStructure(buildingDesc, {
        timeoutMs: cfg.limits.sandbox_timeout_ms, validBlocks: materiaux, structuralSummary: summary
      });
      const support = enforceSupport(generated);
      if (support.removed > 0) console.log(`[modele] gravité : ${support.removed} blocs flottants supprimés`);
      const building = support.blocks;
      const decor = await decorateInterior(building, buildingDesc, { client: apiClient, timeoutMs: cfg.limits.sandbox_timeout_ms });
      if (decor.length > 0) bot.chat(`Décoration intérieure : ${decor.length} éléments.`);
      const furnished = building.concat(decor);
      const bSize = { x: 0, y: 0, z: 0 };
      for (const b of furnished) {
        bSize.x = Math.max(bSize.x, b.x + 1);
        bSize.y = Math.max(bSize.y, b.y + 1);
        bSize.z = Math.max(bSize.z, b.z + 1);
      }
      const hillHeight = Math.max(8, Math.min(24, Math.round(summary.dims.y / 3)));
      const surfaceBlock = summary.themes[0] === 'sable' ? 'sand'
        : summary.themes[0] === 'neige_glace' ? 'snow_block'
        : 'grass_block';
      const terrain = terrainFromHeightmap(summary.heightmap, {
        sizeX: dio.size_x, sizeZ: dio.size_z, maxHeight: hillHeight,
        underground, surfaceBlock, taperWidth: 12
      });
      const offX = Math.floor((dio.size_x - bSize.x) / 2);
      const offZ = Math.floor((dio.size_z - bSize.z) / 2);
      let topY = 0;
      for (const t of terrain) {
        if (t.x >= offX && t.x < offX + bSize.x && t.z >= offZ && t.z < offZ + bSize.z) {
          topY = Math.max(topY, t.y);
        }
      }
      const placed = furnished.map((b) => ({ x: b.x + offX, y: b.y + topY + 1, z: b.z + offZ, block: b.block }));
      const densite = env.arbres === 'dense' ? 0.03 : env.arbres === 'epars' ? 0.012 : 0;
      const essences = (env.types_arbres || []).filter((t) => t === 'chene' || t === 'sapin');
      const trees = plantVegetation(terrain, {
        seed, densite,
        exclude: { x1: offX, x2: offX + bSize.x - 1, z1: offZ, z2: offZ + bSize.z - 1 },
        types: essences.length ? essences : ['chene']
      });
      blocks = terrain.concat(trees, placed);
      bot.chat(`Reconstruction inspirée : bâtiment ${bSize.x}x${bSize.z}x${bSize.y} posé sur un relief de ${hillHeight} blocs, ${trees.length > 0 ? Math.round(trees.length / 14) + ' arbres plantés' : 'sans arbres'}.`);
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
    const decor = await decorateInterior(blocks, description, { client: apiClient, timeoutMs: cfg.limits.sandbox_timeout_ms });
    if (decor.length > 0) bot.chat(`Décoration intérieure : ${decor.length} éléments.`);
    const meubles = blocks.concat(decor);
    return proposeStructure(username, meubles, description, { maxSize: cfg.limits.max_size, maxBlocks: cfg.limits.max_blocks });
  }

  const app = createWebServer({ onPhoto, onDiorama, onModel });
  app.listen(cfg.web.port, () =>
    console.log(`[web] upload sur http://${cfg.web.public_host}:${cfg.web.port}/upload/<pseudo>`)
  );

  return bot;
}

if (require.main === module) createBot(config);
module.exports = { createBot };
