try { process.loadEnvFile(); } catch { /* pas de .env : clé attendue dans l'environnement */ }
const fs = require('node:fs');
const path = require('node:path');
const mineflayer = require('mineflayer');
const config = require('../config.json');
const { analyzeImage, compareToPhoto } = require('./vision');
const { chooseSchemas, analyzeSchema } = require('./schemas');
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
const { loadBlockColors, filterColors, NATURAL_BLOCKS, CONSTRUCTION_BLOCKS, FLUID_BLOCKS } = require('./blockcolors');
const { clusterColors, assignThemes, buildThemePicker, themeOfBlock, realisticMaterials } = require('./palette');
const { THEME_BLOCKS } = require('./blockcolors');
const { createUnderground } = require('./subsurface');
const { createClient } = require('./llm');
const memory = require('./memory');
const { cleanTriangles } = require('./meshclean');
const { analyzeStructure } = require('./structure-analysis');
const { terrainFromHeightmap, buildFoundations } = require('./terrain');
const { renderVoxels } = require('./render');
const { enforceSupport } = require('./support');
const { plantVegetation } = require('./vegetation');
const { decorateInterior } = require('./decorator');
const { portraitBlocks } = require('./portrait');
const { auditHabitability, auditChecks, isMonument } = require('./habitability');
const { carveStaircase } = require('./staircase');
const { refineQuery, searchImages, pickBest } = require('./websearch');

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
  const pending = new Map();
  const builder = new Builder(null, { maxBlocks: cfg.limits.max_blocks, cmdsPerTick: cfg.limits.throttle_cmds_per_tick });
  let bot = null;

  // Reconnexion automatique : un kick (keep-alive, redémarrage serveur...) ne doit
  // jamais laisser le bot hors jeu — l'état (pending, builder) survit à la coupure
  function connect() {
    bot = mineflayer.createBot({
      host: cfg.minecraft.host,
      port: cfg.minecraft.port,
      username: cfg.minecraft.username,
      version: cfg.minecraft.version,
      auth: 'offline'
    });
    builder.bot = bot;
    const handleChat = createChatHandler({ bot, builder, config: cfg, pending, onBuild });

    // memory.warmup() désactivé sur macOS ARM64 : SIGSEGV natif (onnxruntime +
    // sharp/libvips) au chargement CLIP dans le contexte complet (mineflayer +
    // @enginehub/schematicjs + onnxruntime-node global). Isolé ça marche.
    // Cause upstream probable. La mémoire I19 fonctionne en fallback métadonnées
    // (filtre style + type_batiment, tri par note desc — sans similarité visuelle).
    // Pour l'activer : décommenter la ligne suivante et tester sur Linux/Windows.
    // memory.warmup().catch((err) => console.warn('[memory] warmup échoué :', err.message));

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
    bot.on('end', (reason) => {
      console.error(`[bot] déconnecté (${reason}), reconnexion dans 5 s...`);
      setTimeout(connect, 5000);
    });
  }
  connect();

  const blockColors = loadBlockColors();
  const colorsNature = filterColors(blockColors, NATURAL_BLOCKS);
  const colorsBati = filterColors(blockColors, new Set([...NATURAL_BLOCKS, ...CONSTRUCTION_BLOCKS]));
  // Modèles 3D : structures verticales — un fluide y coulerait hors du mur
  const colorsSolides = new Map([...colorsBati].filter(([b]) => !FLUID_BLOCKS.has(b)));
  // eau autorisée pour l'architecte : piscines/bassins (contenus — garde-fou d'audit)
  const materiaux = validBlocks.filter((b) => CONSTRUCTION_BLOCKS.has(b) || b === 'air' || b === 'water');
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

  function proposeStructure(username, blocks, description, { maxSize, maxBlocks }, extras = {}) {
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
    pending.set(username.toLowerCase(), { blocks, size, description, ...extras });
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
    const envP = (!description.erreur && description.environnement) || {};
    const paletteScene = await deliberatePalette(
      pixelSamples, colorsNature,
      description.erreur
        ? 'Scène : paysage extérieur, contexte inconnu.'
        : `Scène : ${description.type_batiment}, sol ${envP.sol || 'inconnu'}, végétation ${envP.vegetation || 'inconnue'}, ambiance ${envP.ambiance || 'inconnue'}.`
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
      const { blocks: building } = await generateStructure(buildingDesc, {
        timeoutMs: cfg.limits.sandbox_timeout_ms, validBlocks: realisticMaterials(materiaux, buildingDesc), existingBlocks: validBlocks, mode: 'primitives'
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
    // Statues : modèles auteurés — pas de nettoyage anti-débris (il ampute yeux et petites pièces)
    if (mode === 'statue') {
      const cleaned = { triangles };
      const colorsStatue = filterColors(blockColors, THEME_BLOCKS.couleurs_vives);
      // Le fichier fait foi : glTF est y-up par spécification — aucune rotation automatique
      // (!redresser et !tourner corrigent manuellement les rares exports non conformes)
      const shell = await voxelizeMesh(cleaned.triangles, {
        maxX: 48, maxY: 72, maxZ: 48, defaultBlock: 'white_concrete',
        colors: colorsStatue
      });
      // Pas de gravité pour les statues : les membres détachés de la coquille sont de l'art, pas des bugs
      const statue = shell.map((b) => ({ ...b, y: b.y + 2 }));
      let sx = 0;
      let sz = 0;
      for (const b of statue) { sx = Math.max(sx, b.x); sz = Math.max(sz, b.z); }
      const socle = [];
      for (let x = -1; x <= sx + 1; x++) for (let z = -1; z <= sz + 1; z++) for (let y = 0; y <= 1; y++) {
        socle.push({ x: x + 1, y, z: z + 1, block: 'smooth_stone' });
      }
      const statueBlocks = socle.concat(statue.map((b) => ({ ...b, x: b.x + 1, z: b.z + 1 })));
      bot.chat(`Statue voxelisée : ${sx + 1}x${sz + 1} sur socle.`);
      return proposeStructure(username, statueBlocks, { type_batiment: `statue (${ext})` }, { maxSize: 96, maxBlocks: cfg.limits.max_blocks }, { socle: { h: 2, block: 'smooth_stone', margin: 1 } });
    }

    const cleaned = cleanTriangles(triangles);
    if (cleaned.removed > 0) bot.chat(`Nettoyage du scan : ${cleaned.removed} triangles de débris ignorés.`);

    const seed = Math.floor(Math.random() * 2 ** 31);
    console.log(`[modele] graine sous-sol : ${seed}`);
    const underground = createUnderground({ seed, maxY: dio.max_y });
    // voxelisation de référence (sert d'analyse en mode inspire, de rendu en mode brut)
    const colored = cleaned.triangles.filter((t) => t.color);
    let colors = colorsSolides;
    if (colored.length > 0) {
      const step = Math.max(1, Math.floor(colored.length / 4000));
      const samples = [];
      for (let i = 0; i < colored.length; i += step) samples.push(colored[i].color);
      colors = await deliberatePalette(samples, colorsSolides, `Scène : modèle 3D scanné (${ext}), contexte inconnu.`);
    }
    const inspire = (cfg.reconstruction || 'inspire') === 'inspire';
    // mode inspire : la référence analysée est la coquille seule (les strates
    // géologiques noieraient les thèmes du bâtiment sous « roche »)
    const reference = await voxelizeMesh(cleaned.triangles, {
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
      const { blocks: generated } = await generateStructure(buildingDesc, {
        timeoutMs: cfg.limits.sandbox_timeout_ms, validBlocks: realisticMaterials(materiaux, buildingDesc), existingBlocks: validBlocks, structuralSummary: summary, mode: 'primitives'
      });
      const support = enforceSupport(generated);
      if (support.removed > 0) console.log(`[modele] gravité : ${support.removed} blocs flottants supprimés`);
      if (support.guard) bot.chat('⚠ Structure majoritairement flottante conservée — sortie IA à revoir.');
      const cage = carveStaircase(support.blocks);
      if (cage.carved > 0) console.log(`[modele] ${cage.carved} cage(s) d'escalier taillée(s)`);
      const building = cage.blocks;
      const decor = await decorateInterior(building, buildingDesc, { client: apiClient, timeoutMs: cfg.limits.sandbox_timeout_ms });
      if (decor.length > 0) bot.chat(`Décoration intérieure : ${decor.length} éléments.`);
      const furnished = building.concat(decor);
      const bSize = { x: 0, y: 0, z: 0 };
      for (const b of furnished) {
        bSize.x = Math.max(bSize.x, b.x + 1);
        bSize.y = Math.max(bSize.y, b.y + 1);
        bSize.z = Math.max(bSize.z, b.z + 1);
      }
      const sujetSeul = sceneDesc.cadrage === 'sujet_seul';
      if (sujetSeul) bot.chat('Cadrage : sujet seul — pas de relief ni de végétation ajoutés.');
      const hillHeight = sujetSeul ? 0 : Math.max(8, Math.min(24, Math.round(summary.dims.y / 3)));
      const surfaceBlock = summary.themes[0] === 'sable' ? 'sand'
        : summary.themes[0] === 'neige_glace' ? 'snow_block'
        : 'grass_block';
      const terrain = sujetSeul ? [] : terrainFromHeightmap(summary.heightmap, {
        sizeX: dio.size_x, sizeZ: dio.size_z, maxHeight: hillHeight,
        underground, surfaceBlock, taperWidth: 12
      });
      const offX = sujetSeul ? 0 : Math.floor((dio.size_x - bSize.x) / 2);
      const offZ = sujetSeul ? 0 : Math.floor((dio.size_z - bSize.z) / 2);
      let topY = 0;
      for (const t of terrain) {
        if (t.x >= offX && t.x < offX + bSize.x && t.z >= offZ && t.z < offZ + bSize.z) {
          topY = Math.max(topY, t.y);
        }
      }
      const lift = sujetSeul ? 0 : topY + 1;
      const placed = furnished.map((b) => ({ x: b.x + offX, y: b.y + lift, z: b.z + offZ, block: b.block }));
      const terrainTop = new Map();
      for (const t of terrain) {
        const k = `${t.x},${t.z}`;
        if (!terrainTop.has(k) || t.y > terrainTop.get(k)) terrainTop.set(k, t.y);
      }
      const baseCells = [...new Set(furnished.filter((b) => b.y === 0).map((b) => `${b.x + offX},${b.z + offZ}`))]
        .map((k) => { const [x, z] = k.split(',').map(Number); return { x, z }; });
      const fondations = buildFoundations(baseCells, topY, (x, z) => terrainTop.get(`${x},${z}`) ?? 0, 'stone_bricks');
      if (fondations.length > 0) console.log(`[modele] fondations : ${fondations.length} blocs`);
      const densite = sujetSeul ? 0 : env.arbres === 'dense' ? 0.03 : env.arbres === 'epars' ? 0.012 : 0;
      const essences = (env.types_arbres || []).filter((t) => t === 'chene' || t === 'sapin');
      const trees = plantVegetation(terrain, {
        seed, densite,
        exclude: { x1: offX, x2: offX + bSize.x - 1, z1: offZ, z2: offZ + bSize.z - 1 },
        types: essences.length ? essences : ['chene']
      });
      blocks = terrain.concat(fondations, trees, placed);
      bot.chat(`Reconstruction inspirée : bâtiment ${bSize.x}x${bSize.z}x${bSize.y} posé sur un relief de ${hillHeight} blocs, ${trees.length > 0 ? Math.round(trees.length / 14) + ' arbres plantés' : 'sans arbres'}.`);
    }
    return proposeStructure(username, blocks, { type_batiment: `modèle 3D (${ext})` }, { maxSize: Math.max(dio.size_x, dio.max_y, dio.size_z), maxBlocks: dio.max_blocks });
  }

  async function onSchema(username, buffer, mimeType) {
    bot.chat(`Photo reçue de ${username} — étape 1/4 : lecture de la photo...`);
    const base64 = buffer.toString('base64');
    const description = await analyzeImage(base64, mimeType, {
      maxSize: cfg.limits.max_size, validBlocks
    });
    if (description.erreur) {
      bot.chat(`${username} : analyse impossible — ${description.erreur}`);
      return `erreur : ${description.erreur}`;
    }
    bot.chat(`Étape 2/4 : sélection de schemas de référence (${description.style} / ${description.type_batiment})...`);
    const chosen = await chooseSchemas(description, 3);
    if (chosen.length === 0) {
      bot.chat(`${username} : aucun schema du même style dans la bibliothèque. Bascule sur !photo (mode primitives sans inspiration).`);
      return onPhoto(username, buffer, mimeType);
    }
    bot.chat(`Références : ${chosen.map((c) => `${c.nom} (${c.style})`).join(', ')}`);
    bot.chat('Étape 3/4 : analyse des références et génération inspirée (~1 min)...');
    const schemas = [];
    for (const c of chosen) {
      try { schemas.push(await analyzeSchema(c)); }
      catch (err) { console.warn(`[schema] analyse ${c.nom} ignorée : ${err.message}`); }
    }
    const memoryCasesSchema = await memory.findSimilar(buffer, description, { n: 3, minNote: 3 })
      .catch((err) => { console.warn('[memory] findSimilar échoué :', err.message); return []; });
    if (memoryCasesSchema.length > 0) {
      bot.chat(`${memoryCasesSchema.length} construction(s) passée(s) similaire(s) injectée(s) en inspiration.`);
    }
    const genOpts = {
      timeoutMs: cfg.limits.sandbox_timeout_ms,
      validBlocks: realisticMaterials(materiaux, description),
      existingBlocks: validBlocks,
      image: { base64, mimeType },
      mode: 'primitives',
      inspiration: { schemas, memoryCases: memoryCasesSchema }
    };
    let { blocks, code } = await generateStructure(description, genOpts);
    // Correction itérative bornée (mêmes 2 tours max qu'onPhoto).
    bot.chat('Correction itérative (jusqu\'à 2 tours) avec schemas en inspiration...');
    const MAX_CORRECTION_ROUNDS_SCHEMA = 2;
    for (let round = 1; round <= MAX_CORRECTION_ROUNDS_SCHEMA; round++) {
      try {
        const render = await renderVoxels(blocks, blockColors);
        const critique = await compareToPhoto(base64, mimeType, render.toString('base64'), { client: apiClient });
        const defauts = auditHabitability(blocks, description);
        const defautsText = defauts.length > 0
          ? `Défauts structurels MESURÉS (tour ${round}) — corrige-les impérativement :\n- ${defauts.join('\n- ')}`
          : '';
        if (!critique && !defautsText) {
          if (round === 1) bot.chat('Rendu jugé fidèle (RAS) — pas de correction nécessaire.');
          else bot.chat(`Rendu fidèle après ${round - 1} correction(s) — arrêt.`);
          break;
        }
        bot.chat(`Correction tour ${round}/${MAX_CORRECTION_ROUNDS_SCHEMA}...`);
        ({ blocks, code } = await generateStructure(description, {
          ...genOpts,
          correction: { codeV1: code, critique: critique || '', defauts: defautsText, round }
        }));
      } catch (err) {
        console.warn(`[schema] correction tour ${round} ignorée :`, err.message);
        break;
      }
    }
    // Monuments non habitables : silhouette prime — skip audit habitabilité + décoration
    if (isMonument(description)) {
      bot.chat(`Monument (${description.type_batiment}) — audit habitabilité et décoration ignorés (silhouette prime).`);
      return proposeStructure(username, blocks, description,
        { maxSize: { x: cfg.limits.max_size, y: cfg.limits.max_y, z: cfg.limits.max_size }, maxBlocks: cfg.limits.max_blocks },
        { photo: buffer, code });
    }
    // Vérifications structurelles finales
    const checks = auditChecks(blocks, description);
    const line = checks.map((c) => `${c.name} ${c.passed ? '✓' : '✗'}`).join(' · ');
    bot.chat(`Vérifications : ${line}`.slice(0, 250));
    const allOk = checks.every((c) => c.passed);
    if (allOk) bot.chat('VALIDÉ ✓');
    else {
      const restants = auditHabitability(blocks, description);
      if (restants.length > 0) bot.chat(`⚠ Défauts restants : ${restants.join(' ; ')}`.slice(0, 250));
    }
    bot.chat('Étape 4/4 : décoration intérieure...');
    const decor = await decorateInterior(blocks, description, { client: apiClient });
    if (decor.length > 0) bot.chat(`Décoration intérieure : ${decor.length} éléments.`);
    const meubles = blocks.concat(decor);
    return proposeStructure(username, meubles, description,
      { maxSize: { x: cfg.limits.max_size, y: cfg.limits.max_y, z: cfg.limits.max_size }, maxBlocks: cfg.limits.max_blocks },
      { photo: buffer, code });
  }

  async function onPortrait(username, buffer) {
    bot.chat(`Photo reçue de ${username}, fresque pixel-art en préparation...`);
    const { data, info } = await sharp(buffer).removeAlpha()
      .resize(128, 96, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const blocks = portraitBlocks({ data, width: info.width, height: info.height }, { colors: colorsBati, frame: true });
    return proposeStructure(username, blocks, { type_batiment: `fresque (${info.width}x${info.height} pixels)` },
      { maxSize: 130, maxBlocks: cfg.limits.max_blocks });
  }

  async function onPhoto(username, buffer, mimeType) {
    bot.chat(`Photo reçue de ${username} — étape 1/4 : lecture de la photo...`);
    const base64 = buffer.toString('base64');
    const description = await analyzeImage(base64, mimeType, {
      maxSize: cfg.limits.max_size,
      validBlocks
    });
    if (description.erreur) {
      bot.chat(`${username} : analyse impossible — ${description.erreur}`);
      return `erreur : ${description.erreur}`;
    }
    bot.chat(`Étape 2/4 : génération de ${description.type_batiment} d'après la photo (~1 min)...`);
    const memoryCases = await memory.findSimilar(buffer, description, { n: 3, minNote: 3 })
      .catch((err) => { console.warn('[memory] findSimilar échoué :', err.message); return []; });
    if (memoryCases.length > 0) {
      bot.chat(`${memoryCases.length} construction(s) passée(s) similaire(s) injectée(s) en inspiration.`);
    }
    if (isMonument(description)) {
      bot.chat(`Sujet identifié comme MONUMENT (${description.type_batiment}) — pas de portes, cloisons, ni décoration.`);
    }
    const genOpts = {
      timeoutMs: cfg.limits.sandbox_timeout_ms,
      validBlocks: realisticMaterials(materiaux, description),
      existingBlocks: validBlocks,
      image: { base64, mimeType },
      mode: 'primitives',
      inspiration: { memoryCases },
      isMonument: isMonument(description)
    };
    let { blocks, code } = await generateStructure(description, genOpts);
    bot.chat('Étape 3/4 : correction itérative (jusqu\'à 2 tours) selon les écarts photo↔rendu...');
    // Boucle inspirée de Voyager : itérer la correction tant que critic remonte des
    // défauts, borné à MAX_CORRECTION_ROUNDS. Chaque tour = render → critic → regen.
    // Stop dès que critic dit "success" (null) ou budget atteint.
    const MAX_CORRECTION_ROUNDS = 2;
    for (let round = 1; round <= MAX_CORRECTION_ROUNDS; round++) {
      try {
        const render = await renderVoxels(blocks, blockColors);
        const critique = await compareToPhoto(base64, mimeType, render.toString('base64'), { client: apiClient });
        const defauts = auditHabitability(blocks, description);
        const defautsText = defauts.length > 0
          ? `Défauts structurels MESURÉS (tour ${round}) — corrige-les impérativement :\n- ${defauts.join('\n- ')}`
          : '';
        if (!critique && !defautsText) {
          if (round === 1) bot.chat('Rendu jugé fidèle (RAS) — pas de correction nécessaire.');
          else bot.chat(`Rendu fidèle après ${round - 1} correction(s) — arrêt.`);
          break;
        }
        bot.chat(`Correction tour ${round}/${MAX_CORRECTION_ROUNDS}...`);
        ({ blocks, code } = await generateStructure(description, {
          ...genOpts,
          correction: { codeV1: code, critique: critique || '', defauts: defautsText, round }
        }));
      } catch (err) {
        console.warn(`[photo] correction tour ${round} ignorée :`, err.message);
        break;
      }
    }
    // Monuments non habitables : silhouette prime — skip audit habitabilité + décoration
    if (isMonument(description)) {
      bot.chat(`Monument (${description.type_batiment}) — audit habitabilité et décoration ignorés (silhouette prime).`);
      return proposeStructure(username, blocks, description,
        { maxSize: { x: cfg.limits.max_size, y: cfg.limits.max_y, z: cfg.limits.max_size }, maxBlocks: cfg.limits.max_blocks },
        { photo: buffer, code });
    }
    const checks = auditChecks(blocks, description);
    const line = checks.map((c) => `${c.name} ${c.passed ? '✓' : '✗'}`).join(' · ');
    bot.chat(`Vérifications : ${line}`.slice(0, 250));
    const allOk = checks.every((c) => c.passed);
    if (allOk) bot.chat('VALIDÉ ✓');
    else {
      const restants = auditHabitability(blocks, description);
      if (restants.length > 0) bot.chat(`⚠ Défauts restants : ${restants.join(' ; ')}`.slice(0, 250));
    }
    bot.chat('Étape 4/4 : décoration intérieure...');
    const decor = await decorateInterior(blocks, description, { client: apiClient, timeoutMs: cfg.limits.sandbox_timeout_ms });
    if (decor.length > 0) bot.chat(`Décoration intérieure : ${decor.length} éléments.`);
    const meubles = blocks.concat(decor);
    return proposeStructure(username, meubles, description,
      { maxSize: { x: cfg.limits.max_size, y: cfg.limits.max_y, z: cfg.limits.max_size }, maxBlocks: cfg.limits.max_blocks },
      { photo: buffer, code });
  }

  async function onBuild(username, userText) {
    bot.chat(`${username} : recherche "${userText}" sur le web...`);
    if (!apiClient) {
      bot.chat(`${username} : clé API Anthropic manquante — impossible de trier les résultats.`);
      return;
    }
    if (!process.env.SERPAPI_KEY) {
      bot.chat(`${username} : SERPAPI_KEY absente de l'env — configure-la et réessaie.`);
      return;
    }
    const refined = await refineQuery(userText, { client: apiClient });
    console.log(`[build] requête reformulée : "${refined}"`);
    const n = (cfg.web_search && cfg.web_search.n_results) || 8;
    const candidates = await searchImages(refined, { apiKey: process.env.SERPAPI_KEY, n });
    if (candidates.length === 0) {
      bot.chat(`${username} : aucune image trouvée pour "${userText}". Réessaie avec une description plus précise.`);
      return;
    }
    const chosen = await pickBest(candidates, { client: apiClient });
    if (chosen === null) {
      bot.chat(`${username} : aucune photo utilisable parmi les ${candidates.length} résultats. Réessaie plus précis, ex: "chateau disneyland paris facade jour".`);
      return;
    }
    bot.chat(`Photo trouvée : ${chosen.url}`);
    bot.chat('Analyse en cours (~1 min)...');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(chosen.url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`téléchargement image HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    return onPhoto(username, buffer, mimeType);
  }

  const app = createWebServer({ onPhoto, onDiorama, onModel, onPortrait, onSchema });
  app.listen(cfg.web.port, () =>
    console.log(`[web] upload sur http://${cfg.web.public_host}:${cfg.web.port}/upload/<pseudo>`)
  );

  return bot;
}

if (require.main === module) createBot(config);
module.exports = { createBot };
