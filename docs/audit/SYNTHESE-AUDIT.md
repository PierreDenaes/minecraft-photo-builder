# Synthèse de l'audit complet : agentMinecraft/src

Audit du 27/07/2026, 34 fichiers lus, 14 fichiers de correction livrés dans src/. Environ 70 points relevés. Ce document est la feuille de route d'application.

## Les fichiers de correction

| Fichier | Portée | Points saillants |
|---|---|---|
| CORRECTIONS-generator.md | generator.js, llm.js | validation stricte des blocs, dedup aligné optimizer, budget spatial, retry ciblé |
| CORRECTIONS-index.md | index.js | monuments dans la boucle de correction, !build sécurisé, factorisation onPhoto/onSchema |
| CORRECTIONS-primitives.md | primitives.js | acrotère oak_wall (bloc inexistant), voûte d'arche à 90°, lierre qui disparaît, portes assorties |
| CORRECTIONS-vision.md | vision.js | schéma JSON complété (travees, palette), extraction robuste, chemin {erreur} |
| CORRECTIONS-chat.md | chat.js, support.js | rotation des états de blocs (!tourner), gardes !go/!note, !help |
| CORRECTIONS-builder.md | builder.js | file suspendue à la déconnexion, garde startBuild, curseur O(n) |
| CORRECTIONS-schemas.md | schemas.js | Math.min spread (crash gros schémas), code mort chooseSchema |
| CORRECTIONS-habitability.md | habitability.js, index.js | défauts structurés {code, message}, isMonument centralisé |
| CORRECTIONS-memory.md | memory.js, chat.js | mémoire fonctionnelle sans CLIP (bug critique), rappel assoupli |
| CORRECTIONS-mesh.md | mesh.js | transforms GLB complets (TRS), byteStride, gardes STL/OBJ |
| CORRECTIONS-decorator.md | decorator.js | écrémage avant ancrage (demi-lits), rôles dérivés des layouts |
| CORRECTIONS-palette.md | palette.js, blockcolors.js | code mort assignBlocks/buildPaletteMap, erreur explicite |
| CORRECTIONS-webserver.md | webserver.js, websearch.js | INJECTION DE COMMANDE via username (sécurité), gardes pickBest |
| CORRECTIONS-petits-modules.md | render, support, staircase, almanach | toits gris dans le critic, air porteur, trémie, almanach gardé |

Modules audités sains, sans correction : optimizer.js, rooms.js, roomlayouts.js, meshvoxelizer.js, meshclean.js, composite.js, voxelizer.js, depth.js, subsurface.js, terrain.js, vegetation.js, structure-analysis.js, portrait.js.

## Priorités

**P0 : à appliquer en premier (sécurité + fonctionnalités mortes + faux signaux)**
1. webserver.js : assainir username du POST (exécution de commandes op par le bot via un POST forgé). CORRECTIONS-webserver point 1.
2. memory.js : saveCase sans CLIP (toute la mémoire I19 est actuellement inopérante sur macOS). CORRECTIONS-memory point 1.
3. render.js : lookup couleur sur le nom de base (tous les toits sont gris dans le rendu envoyé au critic → faux défauts → tours de correction gaspillés). CORRECTIONS-petits-modules point 1.

**P1 : bugs à effet visible en jeu**
- primitives.js : acrotère `oak_wall` (brûle des tentatives de génération), voûte d'arche, lierre, portes toujours oak.
- support.js/chat.js : !tourner casse l'orientation de tous les stairs/portes.
- index.js : monuments audités habitabilité dans la boucle de correction (consignes contradictoires au LLM), isMonument absent d'onSchema, téléchargement !build non contrôlé.
- generator.js : garde bloc texte, validation stricte, dedup air-priority, budget spatial.
- builder.js : construction trouée en cas de kick mi-parcours.
- schemas.js : RangeError sur gros schémas.
- mesh.js : GLB multi-pièces superposées à l'origine, gardes STL/OBJ.

**P2 : robustesse et qualité**
- vision.js (schéma complété, extraction, stop_reason), habitability.js (refactor codes), decorator.js (écrémage avant ancrage), memory.js (updateNote, rappel assoupli), websearch.js (gardes), support.js (air porteur).

**P3 : nettoyage**
- Code mort : chooseSchema, assignBlocks, buildPaletteMap, imports morts decorator, reliquat trémie staircase.
- Messages d'erreur explicites : blockcolors, almanach.
- ORE_TABLE 4e colonne (annexe).

## Ordre d'application conseillé (dépendances entre fichiers)

1. **CORRECTIONS-generator.md** : autonome (attention : le point 4 dedup a été mis à jour, version « priorité air/portes »).
2. **CORRECTIONS-index.md** PUIS **CORRECTIONS-habitability.md** dans cet ordre : la factorisation corrigerEtFinaliser d'index doit exister avant que le refactor {code, message} adapte ses consommateurs.
3. **CORRECTIONS-chat.md** et **CORRECTIONS-builder.md** ensemble : leurs gardes !go/startBuild sont complémentaires.
4. **CORRECTIONS-memory.md** après chat (le wrapper !note utilise le retour booléen d'updateNote).
5. Les autres dans n'importe quel ordre : primitives, vision, schemas, mesh, decorator, palette, webserver, petits-modules sont indépendants.
6. Après chaque fichier : exécuter sa section « Vérification finale ».

## Chantier transverse : centraliser les identifiants de modèles

7 identifiants de modèles sont en dur dans 5 fichiers : generator.js (MODEL), vision.js (MODEL_ANALYSE, MODEL_CRITIQUE), decorator.js (MODEL_SETS), palette.js (MODEL_THEMES), websearch.js (REFINE_MODEL, PICK_MODEL).

Proposition : une section dans config.json :
```json
"models": {
  "generator": "claude-sonnet-4-6",
  "vision_analyse": "claude-fable-5",
  "vision_critique": "claude-opus-4-7",
  "decorateur_roles": "claude-haiku-4-5-20251001",
  "palette_themes": "claude-haiku-4-5-20251001",
  "websearch_refine": "claude-haiku-4-5-20251001",
  "websearch_pick": "claude-haiku-4-5-20251001"
}
```
Et dans chaque module, remplacer la constante par un chargement avec repli sur la valeur actuelle :
```js
let MODELS = {};
try { MODELS = require('../config.json').models || {}; } catch { /* défauts */ }
const MODEL = process.env.GENERATOR_MODEL || MODELS.generator || 'claude-sonnet-4-6';
```
(garder la priorité env > config > défaut pour generator, conformément à CORRECTIONS-generator point 10 ; pour les autres, config > défaut suffit). Un seul endroit à éditer pour changer de modèle ou suivre une montée de version.

## Observations générales

- Le projet est de bonne facture : conventions documentées en commentaires, replis systématiques quand le LLM est indisponible, déterminisme soigné (k-means, hash, seeds), architecture LLM-choisit-la-sémantique / code-calcule-les-positions très saine.
- Le motif récurrent n°1 était `response.content.find((b) => b.type === 'text').text` sans garde (5 fichiers) : corrigé partout.
- Le motif récurrent n°2 était la duplication (isMonument ×2, typeKeywords ×2, structureSize/sizeOf/dimsOf ×3, boucle de correction ×2) : résorbée sauf structureSize/dimsOf, laissée en l'état (3 implémentations locales triviales, un utils commun serait du confort).
- Trois chargements data/*.json sur quatre étaient gardés : harmonisé.
- La limitation vanilla /fill (32768 blocs) laisse de la marge jusqu'à ~180×180 d'emprise : documentée dans builder.
