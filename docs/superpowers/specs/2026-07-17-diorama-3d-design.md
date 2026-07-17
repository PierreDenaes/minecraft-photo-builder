# Design : Phase 2 — Mode diorama (copie conforme) + import de modèles 3D

Date : 2026-07-17
Statut : validé
Prérequis : MVP mode "code" mergé et validé e2e (spec du 2026-07-17)

## Objectif

Reproduire fidèlement une photo COMPLÈTE (bâtiment + décor) en voxels Minecraft, avec des bâtiments 3D détaillés, et permettre au joueur de fournir directement ses propres modèles 3D. Trois voies d'entrée, un seul moteur de construction (optimizer/builder existants).

## Décisions actées

- Approche diorama : profondeur estimée localement (pas de reconstruction 3D lourde), scène entière copiée.
- Bâtiments 3D : hybride — le décor vient du diorama, le bâtiment est généré détaillé par le pipeline LLM existant puis incrusté à sa place (bbox fournie par la vision).
- Déclenchement : nouvelle commande `!diorama` ; `!photo` (mode code) inchangé.
- Emprise : 128×96, hauteur ≤ 96 → nouveaux `limits.diorama` (max_blocks 500 000).
- Formats modèles 3D : OBJ (+MTL), STL, GLB/GLTF (parsing via `three`) ; limite 20 Mo.
- Profondeur : Depth Anything V2 small en ONNX via `onnxruntime-node` (CPU Mac, ~3 s), modèle ~50 Mo téléchargé hors git par `npm run setup:depth`.
- Couleur→bloc : `data/block_colors.json` généré par script depuis les textures du jar client 1.20.4 local (`~/Library/Application Support/minecraft/versions/1.20.4/1.20.4.jar`).
- Throttle monté à 8 commandes / 50 ms (l'exclusion anti-spam `/fill`/`/setblock` de spigot.yml le permet).
- Undo diorama : le volume dépasse la limite de snapshot → restauration « terrain plat » calculée (remise en superflat : air au-dessus du sol, grass_block au niveau du sol) quand le snapshot est indisponible.

## Pipeline

```
photo → depth.js (carte de profondeur) ─┐
photo → vision.js étendu ───────────────┤ description + zone_batiment {x,y,l,h en % image}
                                        ▼
                    voxelizer.js : colonne (x,z) par pixel, ciel exclu,
                    sol comblé, couleur → bloc (blockcolors.js)
                                        ▼
        generator.js (existant) : bâtiment LLM détaillé à l'échelle de la bbox
                                        ▼
        composite.js : zone bâtiment évidée du diorama, bâtiment incrusté au sol
                                        ▼
        validateStructure → optimizeToCommands → Builder (existants)

modèle 3D (.obj/.stl/.glb) → mesh.js (parsing) → meshvoxelizer.js
        (normalisation dans 128×96×96, rasterisation triangles, couleurs matériaux)
        → même chemin validation/build
```

## Modules et interfaces

| Module | Interface | Dépend de |
|---|---|---|
| `src/depth.js` | `estimateDepth(imageBuffer) → { width, height, data: Float32Array }` (0=proche, 1=loin) | onnxruntime-node, sharp, `models/depth_anything_v2_small.onnx` |
| `src/blockcolors.js` | `loadBlockColors() → Map<block, [r,g,b]>` ; `nearestBlock(r, g, b, colors) → string` | `data/block_colors.json` |
| `scripts/extract-block-colors.js` | jar client → moyenne RGB par texture de bloc pleine → `data/block_colors.json` | jar 1.20.4 local |
| `src/voxelizer.js` | `voxelizeScene(pixels, depthMap, { sizeX, sizeZ, maxY, blockColors }) → blocks` — classification ciel (profondeur lointaine + haut d'image), extrusion sol | blockcolors |
| `src/composite.js` | `composite(sceneBlocks, buildingBlocks, bbox3d) → blocks` — évide la bbox 3D, insère le bâtiment posé au sol du diorama | — |
| `src/mesh.js` | `parseModel(buffer, ext) → { triangles: [{v1,v2,v3, color}] }` (OBJ+MTL, STL binaire/ascii, GLB via three) | three |
| `src/meshvoxelizer.js` | `voxelizeMesh(triangles, { maxX, maxY, maxZ, defaultBlock, blockColors }) → blocks` — normalisation échelle/orientation (STL z-up → y-up), test triangle-AABB, shell | blockcolors |
| `src/vision.js` (étendu) | schéma + `"zone_batiment": { "x": %, "y": %, "largeur": %, "hauteur": % }` (optionnel : absent si pas de bâtiment net) | — |
| `src/chat.js` (étendu) | `!diorama` → lien `http://host:port/upload/<pseudo>?mode=diorama` | — |
| `src/webserver.js` (étendu) | accepte `.obj/.mtl/.stl/.glb` (20 Mo) + champ `mode` ; route : image+mode=diorama → pipeline diorama ; fichier 3D → pipeline mesh ; image sans mode → pipeline code actuel | — |
| `src/builder.js` (étendu) | throttle 8 cmd/50 ms ; `undoFlat(region, groundY)` : restauration superflat sans snapshot | — |
| `config.json` | `limits.diorama: { size_x: 128, size_z: 96, max_y: 96, max_blocks: 500000 }`, `throttle_cmds_per_tick: 8` | — |

## Gestion d'erreurs

- Modèle ONNX absent → message chat : « mode diorama non installé, lance npm run setup:depth » (HTTP 503 côté web).
- Pas de `zone_batiment` détectée → diorama pur sans incrustation (comportement normal, pas une erreur).
- Modèle 3D illisible/corrompu → message clair avec le format détecté.
- MTL manquant pour un OBJ → blocs `defaultBlock` (stone) + avertissement.
- Les erreurs existantes (retry API, validation) restent inchangées.

## Tests

- `depth` : mocké en unit (gradient synthétique) ; test d'intégration réel derrière une condition « modèle présent ».
- `voxelizer` : image 4×4 + profondeur connue → colonnes/blocs attendus ; classification ciel.
- `blockcolors` : rouge pur → bloc rouge (red_concrete/red_wool), extraction testée sur 2-3 PNG fixtures.
- `composite` : bbox remplacée, décor intact autour.
- `mesh` : cube OBJ 8 sommets → 12 triangles ; STL binaire synthétique ; couleurs MTL.
- `meshvoxelizer` : cube unité → shell de voxels attendu ; pyramide → étages décroissants.
- e2e : `scripts/e2e-driver.js` étendu (upload photo en mode diorama + upload d'un cube OBJ fixture).

## Hors périmètre

- Reconstruction 3D par IA (TripoSR) ; textures GLB complexes (on prend la couleur de base des matériaux) ; intérieurs meublés ; mode survival.
