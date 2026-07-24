# Design : Itération 13 — Diorama sous primitives + fix crash

Date : 2026-07-24 — Base : `main` après I12 (primitives sur !photo)

## Origine

Pierre : « il faut revoir diorama ». Test live : upload photo Tour Eiffel en `!diorama` → crash `coordonnées invalides : entiers >= 0 requis`. Cause identifiée dans `composite` : le générateur d'architecte (mode code hérité) produit des blocs à coordonnées négatives quand le composite décale la structure. Au-delà du crash, le mode `!diorama` inspire souffre des mêmes défauts spatiaux que `!photo` avant I12 : LLM en mode code, escaliers douteux, entrées manquantes.

## Périmètre

Deux étapes séquentielles :

1. **Étape rapide (fix crash)** : `composite.js` filtre les blocs à coordonnées négatives avec warning, `zAnchor` clampé à `>= 0`. Le mode diorama redevient utilisable.
2. **Étape principale (primitives)** : le mode `!diorama` inspire (photo avec zone_batiment ET modèle 3D inspire) bascule sur `mode: 'primitives'` du générateur. Ajout d'une 9ᵉ primitive `tour` — nécessaire pour reproduire les scans de châteaux (Butron, Rocca).

`!statue` et `!portrait` inchangés. Mode `!diorama` brut (photo sans zone_batiment, ou reconstruction=brut) inchangé — il utilise le voxeliseur direct sans LLM.

## Étape 1 : fix crash `composite`

`src/composite.js:composite(scene, building, {x1, x2, zAnchor})` place le bâtiment dans la scène. Aujourd'hui : si `building` a des blocs à y<0 (arrivés là par un `place(x, -1, z, ...)` du LLM) ou si `zAnchor` est négatif, l'output part en négatif → `validateStructure` rejette.

Fix : dans `composite`, translater vers y>=0 si des blocs sont négatifs (comme `normalizeOrigin`), clamper `zAnchor` à `>= 0`, filtrer les blocs restés hors zone avec un warning.

## Étape 2 : primitive `tour` + prompt diorama

### Nouvelle primitive

```js
tour({ x, z, rayon, y_bas, y_haut, materiau, toit_conique = true, creneaux = false })
```

- Cylindre plein aux extrémités (dalle basse en `materiau`, dalle haute en `materiau_planks` si materiau est un préfixe bois, sinon en `materiau`) et **paroi** cylindrique 1 bloc épaisseur entre `y_bas+1` et `y_haut-1` : bloc présent si `r*r-r < dx*dx+dz*dz <= r*r`.
- Si `toit_conique` : anneaux rétrécissants au-dessus, pointe en `fence + slab` du materiau.
- Si `creneaux` : merlon/créneau alterné au sommet (avant le toit s'il y en a un).
- Percée d'une porte d'accès pas nécessaire (le LLM appelle `porte` séparément si besoin).

### Prompt diorama

Le mode `!diorama` inspire reçoit un « résumé structurel » extrait du scan (dims globales, tours détectées, palette). Le prompt existant utilise ce résumé pour guider le mode code. On adapte : le prompt reste `PRIMITIVES_PROMPT` (car sandbox primitives + Math), mais l'exemple 2 devient « château médiéval avec tours d'angle » — appelant `boite`, `tour` (4 fois), `porte`, `escalier`, `toitDeuxPans`.

Le message utilisateur porte : dims du scan, liste des tours (`{x, z, rayon, hauteur}`), palette dominante. Plus de carte ASCII (utile en mode code, obsolète en primitives).

### Câblage

`src/index.js` : `onDiorama` (photo avec zone_batiment) et `onModel` (inspire) passent `mode: 'primitives'` à `generateStructure`. La suite (enforceSupport, décoration, terrain, végétation) reste identique.

## Tests attendus

- `tour` isolée : cylindre creux entre y_bas+1 et y_haut-1, dalles pleines aux extrémités, toit conique correct, créneaux alternés si demandé.
- `composite` : blocs à y<0 filtrés/translatés avec warning, zAnchor négatif clampé à 0.
- Intégration : `boite + tour x4 + porte + escalier + toit` passe `auditHabitability` sans défaut.
- Régression : `!photo` villa inchangé, `!statue`/`!portrait` intacts, `!diorama` brut (voxelisation directe) inchangé.

## Test live

Butron castle GLB (déjà validé en I5). Attendu : le LLM appelle `tour` pour les 4 tours d'angle, `boite` pour le corps, `escalier` pour l'accès chemin de ronde. Pas de blocs flottants, pas de crash.

## Hors périmètre

- Primitives d'ornement (créneaux ouvragés, mâchicoulis, arcs-boutants).
- Monuments singuliers (Tour Eiffel, Sagrada) — accepté hors périmètre en I12.
- Migration Minecraft 26.1.2 (attend la fin de I13).
