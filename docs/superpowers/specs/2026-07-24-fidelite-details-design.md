# Design : Itération 14 — Fidélité et détails (A+B+C+D + schemas de référence)

Date : 2026-07-24 — Base : `main` après I13

## Origine

Pierre a partagé `docs/presentation.png` (visuel marketing du bot) : un manoir avec **lampadaires-lanternes**, **lierre**, **ponton bois sur l'eau**, **végétation en bordure**, **marches d'entrée**, **garde-corps de balcon en iron_bars**, **matériaux répartis par zone** (blanc/noir/bois). Le rendu actuel produit une villa générique, pas ce niveau de détail. Pierre a aussi ajouté `docs/schem/` (schematics Sponge de constructions réelles) comme références.

## Périmètre

Une seule itération, quatre volets (A+B+C+D) + intégration des schemas.

### A. Primitives d'extérieur

Nouvelles primitives dans `src/primitives.js` :

- `lampadaire({x, z, y0, hauteur=5, materiau='dark_oak_fence'})` — poteau vertical (fences empilées) + lanterne au sommet, base optionnelle en bloc plein.
- `terrasse({x1, z1, x2, z2, y, materiau, bordure?})` — dalle horizontale au sol (ou légèrement surélevée) avec optionnellement une bordure d'un bloc.
- `pontonBois({x1, z1, x2, z2, y, materiau='oak_planks', pilotis=true})` — planches sur pilotis en dark_oak_fence descendant jusqu'à y=0 ou l'eau.
- `haie({x1, z1, x2, z2, y, essence='oak_leaves', hauteur=2})` — rangée de feuilles persistantes (persistent=true géré à l'émission).
- `bordurePlantes({x1, z1, x2, z2, y, materiau='azalea_leaves'})` — variante basse (hauteur 1) pour bordures de terrasse/piscine.

### C. Détails structurels

- `perron({x, z, y0, largeur=3, marches=2, materiau, facing})` — marches d'escalier ascendantes devant une porte.
- `gardeCorps({x1, z1, x2, z2, y, materiau='iron_bars'})` — rangée de barres au bord d'une terrasse/balcon.

### B. Palette par zone

Aujourd'hui : `palette_blocs = { murs, toit, fondation }` global. Le LLM répartit ensuite « à sa main ». On garde ces trois clés (compat) et on **ajoute** dans la description issue de la vision :

- `palette_blocs.accents` (optionnel) — matière secondaire pour bandeaux, allèges, débords
- `palette_blocs.menuiseries` (optionnel) — matière des encadrements de baies et portes
- `palette_blocs.exterieur` (optionnel) — matière des bordures/pontons/terrasses

Le prompt vision demande à Claude d'identifier ces zones sur la photo (« si tu vois des allèges noires distinctes des murs blancs, mets `accents: "black_concrete"` »). Le prompt primitives incite à utiliser ces variables plutôt qu'un seul matériau global.

### D. Fidélité des travées

Aujourd'hui : `elements: ["grandes_baies_vitrees"]` — le LLM devine le nombre. Ajout dans la vision :

- `travees` (optionnel) — `{ facade_principale: N, autres_facades: N }` : nombre de fenêtres visibles.
- `etages_hauteur` (déjà présent via `dimensions_estimees.hauteur / etages`) — le prompt en profite pour placer les baies alignées verticalement.

Le prompt primitives dit explicitement : « si `travees.facade_principale = 3`, appelle `baie` 3 fois sur la façade sud, régulièrement espacées ».

### Schemas de référence

Ne PAS les décoder à chaque appel (trop cher). À l'installation :

- Script `scripts/extract-schem-stats.js` qui lit les schemas dans `docs/schem/`, extrait pour chacun : nom, dims, top 10 matériaux dominants avec pourcentages, nombre de stairs/doors/glass/torches, forme dominante du toit devinée. Sortie JSON dans `data/schem-refs.json`.
- Le prompt primitives inclut ce JSON en 1 phrase par schema (« Manoir organique bois : granite + jungle_planks + stripped_jungle_wood, ratio stairs/blocs ~5%, pas de vitre — ouvertures nues ; typique du style rustique fantasy »).

Signal empirique tiré des 3 schemas de Pierre : **beaucoup de stairs** (5-10 % des blocs), **3-4 matériaux bois mélangés** (jungle + stripped + oak + packed_mud + brown_mushroom_block), **granite/cobblestone en base**, **torches abondantes**, **jamais de glass ni oak_door** — c'est le vocabulaire rustique organique de qualité. Cette leçon entre dans le prompt : « varie 3-5 matériaux, ratio stairs élevé, torches en éclairage régulier ».

## Ce qui ne bouge pas

- Les 9 primitives existantes.
- Le sandbox null-prototype.
- La boucle de correction, l'audit d'habitabilité, la décoration inversée.

## Tests attendus

- Chacune des 7 nouvelles primitives testée isolément.
- Vision : nouveaux champs optionnels acceptés, replis quand absents.
- Prompt : les schemas indexés apparaissent en 1 ligne condensée.
- Régression : villa Trecobat et Butron continuent de fonctionner.

## Hors périmètre

- Chargement dynamique de schemas complets comme primitives.
- Reconstruction fidèle bloc-à-bloc à partir d'un schema (option 1/2 des schemas).
- Migration Minecraft 26.1.2.
