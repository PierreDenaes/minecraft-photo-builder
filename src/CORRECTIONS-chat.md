# Plan de correction : src/chat.js (+ rotateY dans src/support.js)

Contexte : audit du 27/07/2026 (fichier 5/13). Le point 1 modifie src/support.js (c'est la commande !tourner de chat.js qui est cassée par lui). Les points 2 à 6 modifient src/chat.js.

Règle générale : ne change aucun comportement fonctionnel non listé ici.

---

## 1. support.js : rotateY doit réorienter les états de blocs

Problème : `rotateY` transpose les coordonnées mais laisse les chaînes d'état intactes : après !tourner, tous les stairs, portes, wall_torch et vines pointent à 90° de la bonne direction.

Dans `src/support.js`, ajouter au-dessus de `rotateY` :
```js
// Rotation 90° horaire vue de dessus : est→nord→ouest→sud→est
// (cohérent avec la transposition (x,z) → (z, maxX − x))
const ROT_Y_DIR = { east: 'north', north: 'west', west: 'south', south: 'east' };
function rotateBlockStateY(block) {
  if (!block.includes('[')) return block;
  return block
    // facing des stairs, portes, wall_torch...
    .replace(/facing=(north|south|east|west)/, (_, f) => `facing=${ROT_Y_DIR[f]}`)
    // propriétés directionnelles booléennes (vine[south=true]...)
    .replace(/\b(north|south|east|west)=/g, (_, d) => `${ROT_Y_DIR[d]}=`)
    // axe des logs couchés
    .replace(/axis=(x|z)/, (_, a) => `axis=${a === 'x' ? 'z' : 'x'}`);
}
```
Note d'ordre des replace : `facing=north` ne contient pas `north=` (le `=` PRÉCÈDE la direction), donc le deuxième replace ne retouche pas le résultat du premier. Vérifier ce point en test.

Puis remplacer le corps de `rotateY` :
```js
function rotateY(blocks) {
  let maxX = 0;
  for (const b of blocks) if (b.x > maxX) maxX = b.x;
  return blocks.map((b) => ({ ...b, x: b.z, z: maxX - b.x, block: rotateBlockStateY(b.block) }));
}
```

Pour `rotateX`, ne PAS tenter de réorienter les états (rotation verticale des stairs trop complexe pour le gain : la commande sert surtout aux modèles 3D sans états). Ajouter seulement un commentaire :
```js
// Limitation connue : les états de blocs (facing/half) ne sont pas réorientés
// par la rotation verticale — acceptable, !redresser sert aux modèles scannés
// dont les blocs n'ont pas d'états.
```

## 2. chat.js : !note — envelopper updateNote

Remplacer :
```js
memory.updateNote(buildId, n);
bot.chat(`Note enregistrée : ${n}/5, merci !`);
```
par :
```js
Promise.resolve(memory.updateNote(buildId, n))
  .then(() => bot.chat(`Note enregistrée : ${n}/5, merci !`))
  .catch((err) => {
    console.warn('[chat] updateNote échoué :', err.message);
    bot.chat(`${username} : impossible d'enregistrer la note, réessaie.`);
  });
```

## 3. chat.js : !go — refuser si une construction est déjà en cours

Au début du bloc `if (cmd === '!go')`, avant `pending.get(pkey)` :
```js
const st = builder.status();
if (st.active) {
  bot.chat(`${username} : une construction est déjà en cours (${st.done}/${st.total}). Attends la fin ou !undo.`);
  return;
}
```

## 4. chat.js : !note sans argument — message d'aide

Le bloc actuel ne matche que `cmd.startsWith('!note ')`. Ajouter juste avant :
```js
if (cmd === '!note') {
  bot.chat(`${username} : !note attend une note de 1 à 5, ex : !note 4`);
  return;
}
```

## 5. chat.js : commande !help

Ajouter (par exemple juste avant le bloc `!photo`) :
```js
if (cmd === '!help') {
  bot.chat('Commandes : !photo !schema !diorama !statue !portrait (upload) · !build <texte> · !go !cancel · !tourner !redresser · !status !undo · !note 1-5 · !help');
  return;
}
```
Adapter la liste si des commandes sont ajoutées/retirées. Rester sous ~250 caractères (limite chat).

## 6. chat.js : conserver photo/code dans lastBuilt

Problème : après !tourner sur une construction déjà bâtie puis !go, `p.photo`/`p.code` sont perdus et la sauvegarde mémoire ne se fait plus.

Dans le bloc `!go`, remplacer :
```js
lastBuilt.set(pkey, { blocks: p.blocks, size: p.size, description: p.description, socle: p.socle });
```
par :
```js
lastBuilt.set(pkey, { blocks: p.blocks, size: p.size, description: p.description, socle: p.socle, photo: p.photo, code: p.code });
```

---

## Vérification finale

1. `node -e "require('./src/chat.js'); require('./src/support.js')"` charge sans erreur.
2. Test unitaire rotateY (sans serveur) :
```js
const { rotateY } = require('./src/support');
const r = rotateY([
  { x: 0, y: 0, z: 0, block: 'oak_stairs[facing=east,half=bottom]' },
  { x: 1, y: 0, z: 0, block: 'vine[south=true]' },
  { x: 2, y: 0, z: 0, block: 'oak_log[axis=x]' }
]);
console.log(r.map((b) => b.block));
// attendu : oak_stairs[facing=north,half=bottom], vine[east=true], oak_log[axis=z]
```
3. Quadruple rotation = identité : appliquer rotateY 4 fois sur le tableau ci-dessus et vérifier que les blocks reviennent à l'état initial.
4. En jeu : construire une maison à toit deux pans, !tourner, !go : les stairs du toit doivent suivre l'orientation du bâtiment.
5. En jeu : !go pendant une construction en cours → message de refus. !note sans argument → message d'aide. !help → liste des commandes.
