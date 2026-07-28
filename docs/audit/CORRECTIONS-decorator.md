# Plan de correction : src/decorator.js (trio décoration)

Contexte : audit du 27/07/2026 (fichier 11/13, couvre decorator.js + rooms.js + roomlayouts.js). rooms.js et roomlayouts.js sont sains : AUCUNE modification dedans. Tout se joue dans decorator.js.

Règle générale : ne change aucun comportement fonctionnel non listé ici.

---

## 1. Écrémer AVANT fixAttachments (lits entiers, attachements garantis)

Problème : le plafonnement de densité échantillonne APRÈS `fixAttachments` : il peut garder un `part=foot` en jetant son `part=head` (demi-lit qui pop en jeu), ou garder une wall_torch dont le support (bookshelf écrémé) a disparu.

Dans `decorateInterior`, remplacer la fin de la fonction :
```js
const covered = raw.filter((b) => underRoof(b) && !occupied.has(`${b.x},${b.y},${b.z}`));
const anchored = fixAttachments(covered, (x, y, z) => occupied.has(`${x},${y},${z}`));
const cap = Math.ceil(d.x * d.z * Math.max(1, detectFloors(building).length) * 0.10);
if (anchored.length > cap) {
  const step = anchored.length / cap;
  const thinned = [];
  for (let i = 0; i < anchored.length; i += step) thinned.push(anchored[Math.floor(i)]);
  console.warn(`[decorateur] densité plafonnée : ${anchored.length} → ${thinned.length}`);
  return thinned.slice(0, cap);
}
return anchored;
```
par :
```js
let covered = raw.filter((b) => underRoof(b) && !occupied.has(`${b.x},${b.y},${b.z}`));
// Écrémage AVANT l'ancrage : fixAttachments re-garantit ensuite la physique
// sur l'ensemble FINAL (pas de demi-lit ni de torche au support écrémé)
const cap = Math.ceil(d.x * d.z * Math.max(1, detectFloors(building).length) * 0.10);
if (covered.length > cap) {
  const step = covered.length / cap;
  const thinned = [];
  for (let i = 0; i < covered.length; i += step) thinned.push(covered[Math.floor(i)]);
  console.warn(`[decorateur] densité plafonnée : ${covered.length} → ${thinned.length}`);
  covered = thinned.slice(0, cap);
}
return fixAttachments(covered, (x, y, z) => occupied.has(`${x},${y},${z}`));
```
Note : fixAttachments peut encore retirer quelques éléments (supports absents), le résultat final peut donc être < cap : c'est voulu.

## 2. Supprimer les imports morts

En tête de decorator.js, supprimer :
```js
const { INTERIOR_BLOCKS } = require('./blockcolors');
const { getSections } = require('./almanach');
```
(vérifier avant par grep dans le fichier que ni `INTERIOR_BLOCKS` ni `getSections` n'y sont utilisés ailleurs).

## 3. Dériver ROLES_VALIDES des layouts

Problème : `ROLES_VALIDES` (decorator.js) duplique à la main les clés de `ROLE_LAYOUTS` (roomlayouts.js) : divergence silencieuse au premier rôle ajouté d'un seul côté.

Dans decorator.js, remplacer :
```js
const ROLES_VALIDES = ['chambre', 'cuisine', 'bibliotheque', 'salon', 'salle_a_manger', 'chapelle', 'forge', 'atelier', 'entree'];
```
par :
```js
const { ROLE_LAYOUTS } = require('./roomlayouts');
// Source unique : les rôles proposés au LLM sont exactement ceux qui ont un layout
const ROLES_VALIDES = Object.keys(ROLE_LAYOUTS);
```
(ROLE_LAYOUTS est déjà exporté par roomlayouts.js. Placer le require en tête de fichier avec les autres. Pas de cycle : roomlayouts ne require pas decorator.)

---

## Annexe : notes sans correctif

- `decorateInterior` reçoit `timeoutMs` de ses appelants (index.js) mais l'ignore (seul `client` est destructuré). Sans effet. Si on veut clarifier : retirer `timeoutMs` des appels dans index.js, OU ajouter un commentaire. Ne pas trancher ici.
- `roomCtx.dims = { w: 0, d: 0 }` dans furnishRooms (rooms.js) est un champ factice qu'aucun layout ne lit. Nettoyage possible plus tard, hors périmètre (rooms.js déclaré sain).
- `chooseFurnitureSets` a le motif non gardé `response.content.find(...).text`, mais son try/catch global replie sur « salon » : acceptable, pas de correctif.

---

## Vérification finale

1. `node -e "require('./src/decorator.js')"` charge sans erreur.
2. Cohérence des rôles :
```js
const { chooseFurnitureSets } = require('./src/decorator');
const { ROLE_LAYOUTS } = require('./src/roomlayouts');
console.log(Object.keys(ROLE_LAYOUTS)); // les 9 rôles, inchangés
```
3. Test écrémage : construire mentalement ou par script une grande pièce dont la décoration dépasse le cap, et vérifier que le résultat final ne contient JAMAIS un `part=foot` sans son `part=head` à la case adjacente :
```js
// après decorateInterior, pour chaque bloc part=foot, vérifier la présence du head
const feet = decor.filter((b) => /part=foot/.test(b.block));
for (const f of feet) {
  const facing = /facing=(\w+)/.exec(f.block)[1];
  const d = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[facing];
  const head = decor.find((b) => b.x === f.x + d[0] && b.z === f.z + d[1] && b.y === f.y && /part=head/.test(b.block));
  if (!head) throw new Error('demi-lit détecté');
}
```
4. Test manuel !photo sur une villa : la décoration apparaît comme avant (lits complets, torches accrochées, lanternes au plafond).
