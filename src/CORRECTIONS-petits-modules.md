# Plan de correction : petits modules (render, support, staircase, almanach)

Contexte : audit du 27/07/2026 (dernier lot). Modules audités SAINS, aucune modification : composite.js, voxelizer.js, depth.js, subsurface.js (hors annexe), terrain.js, vegetation.js, structure-analysis.js, portrait.js, llm.js (déjà corrigé via CORRECTIONS-generator.md point 11).

Règle générale : ne change aucun comportement fonctionnel non listé ici.

---

## 1. render.js : ignorer les états de blocs au lookup couleur (toits gris)

Problème : `colors.get(b.block)` échoue pour tout bloc à états (`oak_stairs[facing=...]`) → gris 128. Les toits, entièrement en stairs, sont rendus gris dans l'image envoyée au critic compareToPhoto, qui signale de faux défauts de couleur → tours de correction inutiles.

Dans `renderVoxels`, remplacer :
```js
const c = colors.get(b.block) || [128, 128, 128];
```
par :
```js
// lookup sur le nom de base : les états ([facing=...]) ne changent pas la couleur
const c = colors.get(b.block.replace(/\[[^\]]*\]$/, '')) || [128, 128, 128];
```

## 2. support.js : enforceSupport ne doit pas traiter l'air comme porteur

Problème : le flood-fill de connectivité inclut les blocs `'air'` explicites (tunnels d'arche, trémies) : de l'air peut « soutenir » des blocs réels, et des blocs air peuvent être élagués (la sculpture d'ouvertures disparaît).

Remplacer le début d'`enforceSupport` :
```js
function enforceSupport(blocks) {
  if (blocks.length === 0) return { blocks: [], removed: 0 };
  const key = (x, y, z) => `${x},${y},${z}`;
  const all = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
  let minY = Infinity;
  for (const b of blocks) if (b.y < minY) minY = b.y;
  const kept = new Set();
  const queue = [];
  for (const b of blocks) {
    if (b.y === minY) {
```
par :
```js
function enforceSupport(blocks) {
  if (blocks.length === 0) return { blocks: [], removed: 0 };
  const key = (x, y, z) => `${x},${y},${z}`;
  // Les blocs 'air' explicites (tunnels d'arche, trémies) ne sont NI porteurs
  // NI élagables : ils sont exclus du graphe et toujours conservés en sortie
  const solids = blocks.filter((b) => b.block !== 'air');
  const airs = blocks.filter((b) => b.block === 'air');
  const all = new Set(solids.map((b) => key(b.x, b.y, b.z)));
  let minY = Infinity;
  for (const b of solids) if (b.y < minY) minY = b.y;
  const kept = new Set();
  const queue = [];
  for (const b of solids) {
    if (b.y === minY) {
```
Puis adapter la fin de la fonction :
```js
const out = solids.filter((b) => kept.has(key(b.x, b.y, b.z)));
if (out.length < solids.length * 0.25) {
  console.warn('[support] couche de base anormale — structure conservée telle quelle');
  return { blocks, removed: 0, guard: true };
}
return { blocks: out.concat(airs), removed: solids.length - out.length, guard: false };
```
(Cas limite : si `solids` est vide (structure 100% air, improbable), retourner `{ blocks, removed: 0, guard: true }` avant le flood-fill : ajouter `if (solids.length === 0) return { blocks, removed: 0, guard: true };` après le filtre.)

## 3. staircase.js : supprimer le reliquat add/delete de la trémie

Remplacer :
```js
const tremie = new Set();
for (let i = 1; i < gap; i++) tremie.add(`${x0 + i},${f2},${z}`);
tremie.add(`${x0 + gap},${f2},${z}`); // palier d'arrivée dégagé ? non : le palier est SUR f2
tremie.delete(`${x0 + gap},${f2},${z}`);
```
par :
```js
// Trémie : cases i=1..gap-1 uniquement — le palier d'arrivée (x0+gap) reste
// plein, le joueur débouche DESSUS
const tremie = new Set();
for (let i = 1; i < gap; i++) tremie.add(`${x0 + i},${f2},${z}`);
```

## 4. staircase.js : documenter la limitation des soutiens orphelins

Au-dessus du bloc « 1. Retirer les escaliers intérieurs du LLM », ajouter :
```js
// Limitation connue : seuls les blocs _stairs du LLM sont retirés, pas leurs
// masses de soutien (colonnes de planks posées par la primitive escalier) —
// impossible de les distinguer d'un mur porteur. Des piliers orphelins peuvent
// subsister là où une volée LLM a été supprimée.
```

## 5. almanach.js : lecture gardée avec message explicite

Problème : `fs.readFileSync` au niveau module : si data/almanach-construction.md manque, tout require de la chaîne (generator → almanach) crashe au boot avec une ENOENT brute.

Remplacer :
```js
const md = fs.readFileSync(path.join(__dirname, '../data/almanach-construction.md'), 'utf8');
```
par :
```js
let md;
try {
  md = fs.readFileSync(path.join(__dirname, '../data/almanach-construction.md'), 'utf8');
} catch (err) {
  throw new Error(`data/almanach-construction.md manquant ou illisible (${err.message}) — l'almanach est requis par les prompts du générateur, restaure-le depuis le dépôt`);
}
```
(Échec au boot conservé : c'est voulu, seul le message change.)

---

## Annexe : nettoyage cosmétique (optionnel)

- subsurface.js : la 4e colonne d'`ORE_TABLE` (`y max (option)`) n'est jamais lue par `oreAt`. Soit supprimer la colonne et son commentaire, soit l'implémenter un jour. Ne pas trancher ici.

---

## Vérification finale

1. `node -e "['render','support','staircase','almanach'].forEach((m) => require('./src/' + m))"` charge sans erreur.
2. render.js : rendre une structure avec toit en stairs et vérifier visuellement (ou par échantillon de pixels) que le toit n'est plus gris :
```js
const { renderVoxels } = require('./src/render');
const { loadBlockColors } = require('./src/blockcolors');
const blocks = [{ x: 0, y: 0, z: 0, block: 'dark_oak_stairs[facing=north,half=bottom]' }];
renderVoxels(blocks, loadBlockColors()).then((png) => require('node:fs').writeFileSync('/tmp/test-render.png', png));
// le pixel doit être brun sombre (couleur dark_oak), pas gris 128
```
3. support.js : `enforceSupport([{x:0,y:0,z:0,block:'stone'},{x:5,y:5,z:5,block:'air'}])` → le bloc air est conservé, le stone aussi, removed=0.
4. staircase.js : sortie inchangée sur un cas nominal (le add/delete était neutre) : comparer carveStaircase avant/après sur un même jeu de blocs.
5. En jeu : !photo complet : la boucle de correction ne signale plus de faux défauts de couleur de toit (observer le log [vision] critic).
