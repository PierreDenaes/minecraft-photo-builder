# Design : Itération 6 — Intérieurs habitables, décorateur, statues

Date : 2026-07-18
Statut : validé
Base : itération 5 mergée

## Demandes de Pierre

Toit incomplet et étages manquants sur le château (!photo) ; « l'IA peut-elle faire la décoration intérieure et l'agencement de pièces de manière instinctive ? » ; « créer des statues à partir de personnages genre Sonic ».

## Décisions

1. **Bâtiments habitables (prompt architecte)** : suppression de la règle « intérieurs creux » (héritée du MVP) ; nouvelles règles : toit COMPLET et fermé (couvre toute l'emprise, pignons fermés), plancher tous les 5-6 blocs, escalier reliant chaque étage, 2-4 pièces par étage cloisonnées.
2. **Palette intérieure** : `INTERIOR_BLOCKS` (bibliothèques, four/fumoir, coffres/tonneaux, table de craft, lanternes/torches/glowstone, échelles, portes/trappes, barrières et escaliers/dalles pour le mobilier, tapis en laine, pots, foin, chaînes, vitres) — autorisée UNIQUEMENT pour la décoration intérieure, jamais pour le décor extérieur.
3. **Décorateur** : second passage LLM (`src/decorator.js`) — `detectFloors(building)` repère les niveaux de plancher (couches où ≥ 30 % de l'emprise est pleine) ; `decorateInterior(building, description, { client, timeoutMs })` demande du mobilier par étage (code sandboxé, blocs ∈ INTERIOR ∪ air) ; post-filtre : seules les positions LIBRES à l'intérieur de la boîte du bâtiment sont conservées (jamais d'écrasement de structure). Repli silencieux (0 meuble) si l'appel échoue.
4. **Statues (`!statue`)** : lien `?mode=statue` ; fichiers 3D uniquement ; pipeline BRUT sans IA : nettoyage → voxelisation coquille (boîte 48×48×72, zUp stl) → palette fidèle `couleurs_vives` + noir/blanc/gris → garde-fou gravité → socle `smooth_stone` 2 couches sous l'emprise ; ni terrain, ni sous-sol, ni vision, ni LLM (rapide, gratuit).
5. Câblage : décorateur appliqué au bâtiment de `onPhoto` et de `onModel` (mode inspire) ; message « Décoration : N éléments » ; statue : « Statue voxelisée : LxPxH sur socle ».

## Interfaces

| Module | Interface |
|---|---|
| `src/blockcolors.js` | + `INTERIOR_BLOCKS: Set` |
| `src/decorator.js` | `detectFloors(building) → number[]` ; `decorateInterior(building, description, { client, timeoutMs }) → Promise<blocks>` (déjà filtrés) |
| `src/generator.js` | règles habitables/toit dans le SYSTEM_PROMPT |
| `src/chat.js` | `!statue` → lien `?mode=statue` |
| `src/webserver.js` | mode ∈ {diorama, statue} ; `onModel(username, buffer, ext, mode)` |
| `src/index.js` | route statue (brut couleurs fidèles + socle) ; décorateur branché |

## Tests

Prompt (planchers/escaliers/toit complet, plus de « creux ») ; INTERIOR contient bookshelf/lantern, exclut water/grass ; detectFloors sur bâtiment synthétique 2 dalles → [0, 6] ; decorateInterior : client fake, collision filtrée, hors-boîte filtré, échec API → [] ; chat !statue ; webserver mode statue routé avec ext ; statue : socle sous l'emprise (vérif câblage live).

## Hors périmètre

Peinture/skins précis des statues (textures GLB déjà gérées), agencement multi-bâtiments, PNJ.
