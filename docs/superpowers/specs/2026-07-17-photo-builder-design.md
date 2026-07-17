# Design : Minecraft Photo Builder (MVP mode code)

Date : 2026-07-17
Statut : validé

## Objectif

Bot Mineflayer qui construit en jeu une interprétation d'une photo envoyée par le joueur. Pipeline : upload photo → analyse vision (Claude) → génération de code JS sandboxé produisant une liste de blocs → validation/optimisation `/fill` → construction en jeu avec confirmation et undo.

## Décisions actées

- Projet démarré de zéro (aucun code existant).
- Serveur de test : Docker (`itzg/minecraft-server`), Paper 1.20.4, monde superflat, mode créatif, `online-mode=false`, bot OP.
- Périmètre : MVP complet en mode "code" (étapes 1-6 du CLAUDE.md). Mode voxel (phase 2) hors périmètre, mais `generation_mode` reste configurable.
- Clé API Anthropic pas encore disponible : le développement s'appuie sur des fixtures JSON ; la clé n'est requise que pour les tests vision réels.

## 1. Infrastructure de test

- `docker-compose.yml` : Paper 1.20.4, superflat, créatif, bot OP.
- Scripts npm : `npm run server` (démarrer), `npm run server:reset` (monde neuf).

## 2. Architecture logicielle

Structure du CLAUDE.md. Modules à interface claire, testables sans le jeu :

| Module | Interface |
|---|---|
| `src/index.js` | Point d'entrée : bot Mineflayer + serveur web |
| `src/webserver.js` | Express + multer, `POST /build-from-photo`, page HTML d'upload, limite 5 Mo (JPEG/PNG/WebP), association pseudo→position |
| `src/vision.js` | `analyzeImage(base64) → description JSON` (claude-sonnet-4-6, sortie JSON stricte, schéma du CLAUDE.md) |
| `src/generator.js` | `generateStructure(description) → [{x,y,z,block}]` — le LLM génère une fonction JS pure, exécutée dans `node:vm` (timeout 5 s, aucun accès réseau/fs) |
| `src/optimizer.js` | Validation liste blanche (`data/valid_blocks.json`), limites 64³ / 100 000 blocs, zone autorisée autour du joueur, fusion greedy en `/fill` |
| `src/builder.js` | File de commandes throttlée (max 10/tick), aplanissement du terrain (emprise + 1), construction par couches (y croissant), sauvegarde de l'état initial pour `!undo` |
| `src/chat.js` | Commandes `!photo` `!go` `!cancel` `!undo` `!status` |

Configuration dans `config.json` (hôte MC, port web, limites, `generation_mode`). `ANTHROPIC_API_KEY` uniquement en variable d'environnement.

## 3. Flux joueur

`!photo` → lien d'upload dans le chat → upload → analyse → proposition dans le chat ("Construction de [type] ([dimensions]) devant toi. Tape !go / !cancel") → structure placée à 5 blocs face au joueur → construction → `!undo`/`!status` disponibles.

## 4. Gestion d'erreurs, logs, tests

- Retry avec backoff sur l'API ; messages d'erreur clairs dans le chat ; si pas de bâtiment identifiable, `{"erreur": ...}` et information au joueur.
- Logs à chaque étape : image reçue, JSON vision, code généré, commandes exécutées.
- Tests unitaires (`node:test`) : optimizer (fusion `/fill`, validation), sandbox du generator, parsing vision — avec fixtures JSON dans `test/`.
- Test de bout en bout manuel en jeu.

## 5. Ordre d'implémentation

1. Docker + bot Mineflayer minimal connecté qui répond au chat
2. Serveur Express avec upload d'image
3. Appel vision Claude → JSON de description (fixtures d'abord, vraie clé ensuite)
4. Générateur mode "code" + sandbox + validation
5. Builder avec `/fill` optimisé + confirmation + undo
6. Tests de bout en bout, itération sur les prompts
