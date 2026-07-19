# Audit d'améliorations : outils et ressources

Date : 2026-07-19 — Demandé par Pierre après l'itération 7 (« fais un audit d'améliorations soit par le biais d'outils soit de ressources »). Deux recherches menées en parallèle : outillage de construction Minecraft, et modèles 3D/vision. Recommandations priorisées par valeur/effort, rapportées à nos points de douleur réels.

## Nos points de douleur (rappel)

| Douleur | Constat actuel |
|---|---|
| Vitesse de pose | /fill + /setblock via chat, throttle 16 cmd/50 ms ; un diorama de 2,5 M blocs prend plusieurs minutes |
| Undo | Snapshot maison rejoué en commandes — lent et volumineux |
| Reconstruction photo→3D | Depth Anything V2 **small** : profondeur seule, pas de face arrière, détails grossiers |
| Portraits/statues | Pas de détourage : le fond de la photo entre dans la fresque ; Pierre doit trouver ses GLB lui-même |
| Gros uploads | GLB de 100 Mo+ voxelisés bruts, sans simplification préalable |

---

## Volet 1 : outillage de construction

### Recommandation n°1 — FAWE 2.9.2 + prismarine-schematic (effort M, gain maximal)

**Ce que ça change :** pose d'un diorama de 2,5 M blocs en **quelques secondes** au lieu de plusieurs minutes, `//undo` natif, zéro spam serveur (le throttle et les exclusions anti-spam spigot deviennent secondaires).

**Chemin d'intégration :**
1. `SPIGET_RESOURCES` dans docker-compose → FAWE **2.9.2** (dernière version pour Paper 1.20.3–1.20.4 ; les 2.10+ ciblent 1.21). **Épingler la version**, ne pas laisser l'auto-upgrade.
2. `npm install prismarine-schematic` (PrismarineJS, maintenu, écrit le format **Sponge v2** — FAWE 2.9.x ne lit pas le v3, issue #2547).
3. builder.js : écrire le `.schem` depuis notre liste `[{x,y,z,block}]` dans `plugins/FastAsyncWorldEdit/schematics/` (volume Docker partagé), puis le bot en jeu (les commandes WorldEdit exigent un acteur positionné) envoie `//schem load nom` + `//paste -a`.

**Risques :** FAWE 2.9.2 figé (branche 1.20.x non maintenue) ; dépendance de prismarine-schematic sur prismarine-block/mc-data (déjà dans notre stack mineflayer).

### Recommandation n°2 — prismarine-schematic seul d'abord (effort S)

Étape intermédiaire sans risque : générer le `.schem` valide dès maintenant (vérifiable dans un visualiseur), et pouvoir **lire** des schematics tiers comme références. Si FAWE pose problème, rien n'est perdu.

### Recommandation n°3 — mineflayer-schem en réserve (effort S)

Fork actif (1.5.2, compatible 1.8–1.20+) : le bot pose bloc par bloc **en survie** avec pathfinding et récupération dans les coffres. Sans intérêt en créatif (plus lent que notre pipeline), mais c'est LA voie si un jour le serveur passe en survie.

### Écartés

- **Structure blocks vanilla** : limite 48×48×48 rédhibitoire pour nos dioramas ; à la rigueur pour des templates décoratifs fixes.
- **GrabCraft / minecraft-schematics / Litematica** : aucune API publique ; utiles comme banques de référence visuelle humaine, pas d'intégration automatisable.
- **mineflayer-builder** (PrismarineJS) : abandonné (« work in progress », 4 ans sans commit).

---

## Volet 2 : modèles 3D et vision

### Recommandation n°1 — BiRefNet_lite : détourage du sujet en Node pur (effort S)

**Ce que ça change :** le fond de la photo n'entre plus dans les fresques `!portrait` ni dans les statues/dioramas — le sujet est isolé avant tout le pipeline (depth, voxel, pixel-art). Modèle ONNX ~214 Mo via `@huggingface/transformers` (onnxruntime-node sous le capot, **aucun subprocess Python**). Nettement meilleur que rembg/u2net sur cheveux et bords fins (IoU 0,87). Variante `birefnet-portrait` spécialisée pour les visages. Sortie = masque sigmoid à appliquer côté sharp.

### Recommandation n°2 — gltf-transform + meshoptimizer : simplification des gros GLB (effort S)

**Ce que ça change :** un upload de 100 Mo descend à 1–5 Mo avant voxelisation, silhouette préservée. Packages npm purs (pas de binaire natif), CommonJS :

```js
const { NodeIO } = require('@gltf-transform/core');
const { KHRONOS_EXTENSIONS } = require('@gltf-transform/extensions');
const { weld, simplify, dedup, prune } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read('input.glb');
await doc.transform(dedup(), prune(), weld({ tolerance: 1e-4 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.05, error: 0.01 }));
await io.write('output.glb', doc);
```

`weld` avant `simplify` est obligatoire ; ratio 0,05 (5 % des triangles) suffit largement pour une voxelisation. Attention : à brancher AVANT notre parseGLB (les statues gardent leurs triangles bruts après parsing, ça ne change pas).

### Recommandation n°3 — TripoSR : image→GLB local (effort S, subprocess Python)

**Ce que ça change :** plus besoin que Pierre trouve ses GLB — une seule photo devient un vrai modèle 3D avec face arrière. MIT, ~30 s sur Apple Silicon (PyTorch MPS), sortie GLB texturée (~50k triangles). Intégration : `python run.py image.png --output-dir out/ --model-save-format glb` en subprocess, puis notre pipeline GLB existant. Réserve : la bake texture (nvdiffrast) veut CUDA — sur Mac, fallback CPU ou contournement communautaire ; qualité géométrique correcte mais pas exceptionnelle. À coupler avec BiRefNet en amont.

**Alternatives qualité (plus tard) :** SF3D (meilleure cohérence UV, mais 32 Go RAM recommandés, licence non commerciale <1 M$ CA) ; TRELLIS (meilleure géométrie, MIT, 24 Go+ RAM, ~5 min, port Mac communautaire — effort M) ; Hunyuan3D-2.1 (Apache 2.0, textures 4K, ~20-30 Go disque, forks Mac requis — effort M).

### Recommandation n°4 — Depth Anything V2 Base (effort S)

Remplacement direct du Small actuel : 97 M params (~350 Mo) vs 24 M, gain visible sur détails fins et contours, même API ONNX. Le Large (1,3 Go fp32, 3-5× plus lent sans CoreML EP) attendra. **Apple DepthPro** (profondeur métrique, contours de silhouette excellents) à tester spécifiquement pour `!portrait` si BiRefNet ne suffit pas — licence Apple ASCL à vérifier.

### Sources de modèles de personnages (pour statues)

| Source | Licence | Verdict |
|---|---|---|
| **Kenney.nl** | CC0 | Recommandé — pack characters modulaire GLTF, 75+ skins |
| **Quaternius** | CC0 | Recommandé — RPG/platformer/base characters GLTF |
| **Poly Pizza** | CC BY / CC0 selon auteur | OK, vérifier par modèle |
| **Sketchfab** (filtre CC0) | CC0 par tag | OK, vérifier individuellement |
| **The Models Resource** | Rips de jeux (copyright éditeurs) | **À éviter** |

---

## Synthèse : plan d'action priorisé

| # | Action | Effort | Douleur résolue |
|---|---|---|---|
| 1 | FAWE 2.9.2 (épinglé) + prismarine-schematic → pose par `//paste` | M | Vitesse de pose + undo natif |
| 2 | BiRefNet_lite : détourage avant portrait/statue/diorama photo | S | Fond parasite dans les fresques |
| 3 | gltf-transform : simplification des GLB > seuil avant voxelisation | S | Uploads 100 Mo+ |
| 4 | TripoSR en subprocess : photo → GLB complet (face arrière) | S | Reconstruction profondeur-seule |
| 5 | Depth Anything V2 Base à la place du Small | S | Détails du diorama photo |
| 6 | Kenney/Quaternius documentés comme sources CC0 de personnages | — | Où trouver des modèles |

Ordonnancement suggéré : 2 et 3 d'abord (purs npm, une journée chacun, zéro risque), puis 1 (change le cœur du builder — itération dédiée avec e2e), puis 4 et 5 (qualité de reconstruction). Le point 6 est de la documentation utilisateur.

Sources détaillées : rapports de recherche du 2026-07-19 (FAWE/Modrinth, PrismarineJS, IntellectualSites, HuggingFace onnx-community, gltf-transform, dépôts TripoSR/SF3D/TRELLIS/Hunyuan3D).

