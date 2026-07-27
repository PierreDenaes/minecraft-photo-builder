# Plan de correction : src/index.js

Contexte : audit du 27/07/2026 (fichier 2/13). Applique dans l'ordre. Les points 1 à 3 sont des correctifs de bugs, le point 4 est la factorisation principale, 5 à 7 sont des améliorations.

Règle générale : ne change aucun comportement fonctionnel non listé ici.

---

## 1. Monuments : exclure l'audit d'habitabilité de la boucle de correction

Problème : dans `onPhoto` ET `onSchema`, la boucle de correction itérative appelle `auditHabitability(blocks, description)` même quand le sujet est un monument. Le LLM reçoit alors des défauts type « 0 porte, pas de cloisons » alors que le `monumentRule` du générateur lui interdit d'en ajouter : consignes contradictoires.

Dans les DEUX boucles de correction (celle d'`onSchema` et celle d'`onPhoto`), remplacer :
```js
const defauts = auditHabitability(blocks, description);
```
par :
```js
// Monuments : l'habitabilité ne s'applique pas, seule la critique visuelle compte
const defauts = isMonument(description) ? [] : auditHabitability(blocks, description);
```

## 2. onSchema : passer isMonument au générateur

Problème : `onPhoto` passe `isMonument: isMonument(description)` dans ses `genOpts`, mais pas `onSchema`. Un monument traité via !schema est donc généré SANS la règle monument, puis traité comme monument en aval.

Dans `onSchema`, ajouter au `genOpts` :
```js
isMonument: isMonument(description)
```
Et par symétrie avec `onPhoto`, ajouter aussi juste avant le message de chat existant :
```js
if (isMonument(description)) {
  bot.chat(`Sujet identifié comme MONUMENT (${description.type_batiment}) — pas de portes, cloisons, ni décoration.`);
}
```

## 3. onBuild : sécuriser le téléchargement de l'image web

Problème : l'URL choisie par `pickBest` est téléchargée sans vérifier le type ni la taille. Une page HTML d'erreur partirait à l'API vision, et un fichier énorme serait bufferisé entier en mémoire.

Après le `if (!response.ok) throw ...` existant, ajouter :
```js
const contentType = response.headers.get('content-type') || '';
if (!contentType.startsWith('image/')) {
  bot.chat(`${username} : le lien choisi n'est pas une image (${contentType}) — réessaie avec une autre requête.`);
  return;
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const contentLength = Number(response.headers.get('content-length'));
if (contentLength && contentLength > MAX_IMAGE_BYTES) {
  bot.chat(`${username} : image trop lourde (${Math.round(contentLength / 1024 / 1024)} Mo, max 10) — réessaie.`);
  return;
}
const buffer = Buffer.from(await response.arrayBuffer());
if (buffer.length > MAX_IMAGE_BYTES) {
  bot.chat(`${username} : image trop lourde (max 10 Mo) — réessaie.`);
  return;
}
const mimeType = contentType.split(';')[0];
```
(Ce bloc REMPLACE les deux lignes existantes `const buffer = ...` et `const mimeType = ...`.)

## 4. Factoriser la boucle de correction + finalisation dupliquée entre onPhoto et onSchema

Problème : ~80 lignes quasi identiques copiées dans les deux fonctions (boucle render → critique → audit → regen, puis checks finaux → décoration → proposeStructure). C'est ce doublon qui a produit deux fois le bug du point 1.

Créer une fonction interne à `createBot` :
```js
// Boucle de correction itérative (pattern Voyager) + finalisation commune
// à onPhoto et onSchema. Retourne la valeur de proposeStructure.
async function corrigerEtFinaliser({ username, description, genOpts, blocks, code, base64, mimeType, buffer, maxRounds = 2, tag = 'photo' }) {
  for (let round = 1; round <= maxRounds; round++) {
    try {
      const render = await renderVoxels(blocks, blockColors);
      const critique = await compareToPhoto(base64, mimeType, render.toString('base64'), { client: apiClient });
      const defauts = isMonument(description) ? [] : auditHabitability(blocks, description);
      const defautsText = defauts.length > 0
        ? `Défauts structurels MESURÉS (tour ${round}) — corrige-les impérativement :\n- ${defauts.join('\n- ')}`
        : '';
      if (!critique && !defautsText) {
        if (round === 1) bot.chat('Rendu jugé fidèle (RAS) — pas de correction nécessaire.');
        else bot.chat(`Rendu fidèle après ${round - 1} correction(s) — arrêt.`);
        break;
      }
      bot.chat(`Correction tour ${round}/${maxRounds}...`);
      ({ blocks, code } = await generateStructure(description, {
        ...genOpts,
        correction: { codeV1: code, critique: critique || '', defauts: defautsText, round }
      }));
    } catch (err) {
      console.warn(`[${tag}] correction tour ${round} ignorée :`, err.message);
      break;
    }
  }
  const limits = { maxSize: { x: cfg.limits.max_size, y: cfg.limits.max_y, z: cfg.limits.max_size }, maxBlocks: cfg.limits.max_blocks };
  if (isMonument(description)) {
    bot.chat(`Monument (${description.type_batiment}) — audit habitabilité et décoration ignorés (silhouette prime).`);
    return proposeStructure(username, blocks, description, limits, { photo: buffer, code });
  }
  const checks = auditChecks(blocks, description);
  const line = checks.map((c) => `${c.name} ${c.passed ? '✓' : '✗'}`).join(' · ');
  bot.chat(`Vérifications : ${line}`.slice(0, 250));
  if (checks.every((c) => c.passed)) bot.chat('VALIDÉ ✓');
  else {
    const restants = auditHabitability(blocks, description);
    if (restants.length > 0) bot.chat(`⚠ Défauts restants : ${restants.join(' ; ')}`.slice(0, 250));
  }
  bot.chat('Étape 4/4 : décoration intérieure...');
  const decor = await decorateInterior(blocks, description, { client: apiClient, timeoutMs: cfg.limits.sandbox_timeout_ms });
  if (decor.length > 0) bot.chat(`Décoration intérieure : ${decor.length} éléments.`);
  return proposeStructure(username, blocks.concat(decor), description, limits, { photo: buffer, code });
}
```

Puis dans `onSchema` : après le premier `generateStructure`, remplacer TOUT le bloc (boucle de correction + skip monument + checks + décoration + proposeStructure final) par :
```js
bot.chat('Correction itérative (jusqu\'à 2 tours) avec schemas en inspiration...');
return corrigerEtFinaliser({ username, description, genOpts, blocks, code, base64, mimeType, buffer, tag: 'schema' });
```

Et dans `onPhoto`, remplacer le bloc équivalent par :
```js
bot.chat('Étape 3/4 : correction itérative (jusqu\'à 2 tours) selon les écarts photo↔rendu...');
return corrigerEtFinaliser({ username, description, genOpts, blocks, code, base64, mimeType, buffer, tag: 'photo' });
```

Attention aux différences mineures entre les deux versions actuelles : `decorateInterior` d'onSchema n'avait pas `timeoutMs` (la version factorisée le passe, c'est une amélioration voulue). Les points 1 et 2 sont automatiquement absorbés par cette factorisation : les appliquer d'abord n'est utile que si le point 4 est refusé ; si le point 4 est appliqué, vérifier simplement que la fonction factorisée contient bien le garde `isMonument` du point 1.

## 5. Clamper zone_batiment dans onDiorama

La zone vient du LLM vision, sans garantie de bornes. Juste après `const zone = ...`, ajouter :
```js
if (zone) {
  for (const k of ['x', 'y', 'largeur', 'hauteur']) {
    zone[k] = Math.max(0, Math.min(100, Number(zone[k]) || 0));
  }
}
```

## 6. Valider config.json au démarrage

Au début de `createBot(cfg)`, ajouter :
```js
const requis = [
  'minecraft.host', 'minecraft.port', 'minecraft.username', 'minecraft.version',
  'limits.max_blocks', 'limits.max_size', 'limits.max_y', 'limits.sandbox_timeout_ms',
  'limits.throttle_cmds_per_tick', 'limits.diorama', 'web.port'
];
for (const chemin of requis) {
  const v = chemin.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg);
  if (v === undefined || v === null) {
    throw new Error(`config.json : champ requis manquant "${chemin}"`);
  }
}
```
Adapter la liste si certains champs sont réellement optionnels (vérifier les usages avant).

## 7. Réutiliser structureSize dans onModel

Dans `onModel` (mode inspire), remplacer le calcul manuel de `bSize` (la boucle `for (const b of furnished) { bSize.x = Math.max(...) ... }`) par :
```js
const bSize = structureSize(furnished);
```

---

## Point de vigilance (pas de correction ici)

`apiClient` peut être null (pas de clé API) et est passé tel quel à `compareToPhoto`, `decorateInterior`, `assignThemes`. Vérifier lors des audits de vision.js / decorator.js / palette.js que null est géré proprement (repli) et non crashant. Sera traité dans les fichiers de correction correspondants si besoin.

---

## Vérification finale

1. `node -e "require('./src/index.js')"` charge sans erreur (attention : `require.main` évite le démarrage du bot).
2. Test manuel !photo avec une photo de maison : la boucle de correction tourne comme avant.
3. Test manuel !photo avec un monument (photo de la Tour Eiffel) : vérifier dans les logs que les tours de correction ne mentionnent PLUS de défauts d'habitabilité.
4. Test manuel !schema sur un monument : le chat doit annoncer « Sujet identifié comme MONUMENT ».
5. Test !build : vérifier qu'un lien non-image est refusé proprement (message en jeu, pas de crash).
