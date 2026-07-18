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
const { loadBlockColors } = require('./blockcolors');

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
  bot.on('kicked', (reason) => console.error('[bot] kick:', reason));
  bot.on('error', (err) => console.error('[bot] erreur:', err.message));
  bot.on('chat', handleChat);

  const blockColors = loadBlockColors();
  const dio = cfg.limits.diorama;

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
    let blocks = voxelizeScene(image, depthMap, {
      sizeX: dio.size_x, sizeZ: dio.size_z, maxY: dio.max_y, colors: blockColors
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
        timeoutMs: cfg.limits.sandbox_timeout_ms, validBlocks
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
    const blocks = voxelizeMesh(triangles, {
      maxX: dio.size_x, maxY: dio.max_y, maxZ: dio.size_z,
      defaultBlock: 'stone', colors: blockColors, zUp: ext === 'stl'
    });
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
      validBlocks
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
