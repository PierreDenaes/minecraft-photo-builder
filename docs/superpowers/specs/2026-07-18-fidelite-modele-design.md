# Design : Itération 5 — Fidélité au modèle et environnement vivant

Date : 2026-07-18
Statut : validé
Base : itération 4 mergée (reconstruction inspirée)

## Constat (captures de Pierre)

La reconstruction de Butron est « anarchique » : agencement inventé (le résumé 16×12 ne transmet pas la composition réelle), gris au lieu de pierre claire (l'IA ne voit jamais le modèle), porte-à-faux impossibles, et l'environnement (arbres, chemin, ambiance) est absent.

## Décisions

1. **L'IA voit la référence ET son environnement** : rendu image ¾ isométrique du scan voxelisé complet (`src/render.js`, projection peintre, couleurs de la table réelle, PNG via sharp) → passé à la vision Claude.
2. **Vision étendue** : le schéma gagne `environnement { vegetation, arbres: aucun|epars|dense, types_arbres[], sol, ambiance }` — décrit pour toute image (photo ou rendu).
3. **Résumé lisible** : `analyzeStructure` ajoute `carte` (heightmap en lignes ASCII 0-9) ; le prompt architecte lit la carte.
4. **Lois de la physique** : règle prompt (tout bloc porte jusqu'au sol) + post-traitement `enforceSupport(blocks)` (BFS 6-adjacence depuis la couche y=0 ; amas non connectés supprimés).
5. **Végétation procédurale** : `plantVegetation(terrain, { seed, densite, exclude, types })` — arbres simples (chêne : tronc oak_log 4-5 + houppier feuilles ; sapin : spruce_log 5-7 + cône) plantés déterministiquement sur l'herbe hors emprise du bâtiment, densité pilotée par la description d'environnement.
6. **Chat** : une ligne « Ambiance : … » avant la proposition.
7. Flux photo diorama : profite de l'extension vision (environnement) sans autre changement.

## Interfaces

| Module | Interface |
|---|---|
| `src/render.js` | `renderVoxels(blocks, colors, { scale = 2 }) → Promise<Buffer PNG>` — projection iso (u=(x−z), v=(x+z)/2−y), tri peintre, faces top claire/side sombre |
| `src/vision.js` | schéma + `environnement` (règle : décris aussi arbres/sol/ambiance) |
| `src/structure-analysis.js` | + `carte: string[]` (lignes gridZ, chiffres 0-9 = h/hMax) |
| `src/support.js` | `enforceSupport(blocks) → { blocks, removed }` |
| `src/vegetation.js` | `plantVegetation(terrainBlocks, { seed, densite, exclude: {x1,x2,z1,z2}, types }) → blocks` |
| `src/generator.js` | règle physique dans le rôle architecte |
| `src/index.js` | onModel inspire : render → vision → architecte → enforceSupport → terrain → végétation → placement |

## Tests

render : PNG non vide, déterministe, 2 couleurs distinctes présentes ; vision : schéma contient environnement ; carte ASCII : valeurs attendues ; support : amas flottant supprimé, arche connectée conservée ; végétation : arbres sur herbe uniquement, hors zone exclue, déterministes, formes tronc+houppier ; e2e comparatif Butron.

## Hors périmètre

Rivières/eau, animaux, intérieurs, biomes multiples.
