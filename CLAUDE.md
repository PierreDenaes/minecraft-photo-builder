# Agent Minecraft : Construction à partir d'une photo

## Objectif du projet

Développer un module permettant à un bot Minecraft (basé sur Mineflayer) de construire une structure dans le jeu à partir d'une photo envoyée par le joueur. Le joueur envoie une image (via une interface web ou un lien dans le chat du jeu), le système l'analyse et le bot construit une interprétation de la structure en jeu.

## Contexte technique existant

Le projet repose sur un bot Mineflayer déjà connecté au serveur, capable de :
- Lire le chat du jeu et répondre
- Se déplacer dans le monde
- Placer des blocs (via placement bloc par bloc ou commandes `/setblock` et `/fill` en mode créatif)

Ce module ajoute la capacité "photo vers construction".

## Architecture du pipeline photo

```
Photo du joueur
     │
     ▼
[1] Réception de l'image (serveur web local Express + upload)
     │
     ▼
[2] Analyse vision par LLM (API Claude, modèle claude-sonnet-4-6)
     │   → description structurée : type de bâtiment, dimensions,
     │     matériaux, éléments notables (toit, fenêtres, cheminée...)
     ▼
[3] Génération de la structure
     │   → sortie JSON : grille voxel ou liste de blocs
     │     [{x, y, z, block: "oak_planks"}, ...]
     ▼
[4] Validation et optimisation
     │   → fusion des zones homogènes en commandes /fill
     │   → vérification des limites (taille max, blocs valides)
     ▼
[5] Exécution en jeu par le bot
         → aplanissement du terrain si nécessaire
         → placement des blocs par couches (y croissant)
```

## Étape 1 : Réception de l'image

- Créer un petit serveur Express avec un endpoint `POST /build-from-photo`
- Accepter les formats JPEG, PNG, WebP (limite 5 Mo)
- Convertir l'image en base64 pour l'appel API
- Associer la requête au joueur (pseudo) et à sa position en jeu

## Étape 2 : Analyse vision

Appeler l'API Claude avec l'image en entrée. Le prompt système doit demander une sortie JSON stricte, sans texte autour.

Schéma de sortie attendu :

```json
{
  "type_batiment": "maison à colombages",
  "style": "médiéval européen",
  "dimensions_estimees": { "largeur": 12, "profondeur": 9, "hauteur": 10 },
  "etages": 2,
  "toit": { "forme": "deux pans", "materiau_suggere": "dark_oak_stairs" },
  "elements": ["cheminée à droite", "fenêtres à croisillons", "porte centrale"],
  "palette_blocs": {
    "murs": "white_concrete",
    "colombages": "dark_oak_log",
    "toit": "dark_oak_stairs",
    "fondation": "cobblestone"
  }
}
```

Règles :
- Toujours mapper les couleurs et matériaux réels vers des blocs Minecraft valides (version 1.20+)
- Limiter les dimensions à 64x64x64 maximum par défaut (configurable)
- Si l'image ne contient pas de bâtiment identifiable, retourner `{"erreur": "..."}` et informer le joueur dans le chat

## Étape 3 : Génération de la structure

Deuxième appel LLM qui prend la description JSON et génère la liste des blocs. Deux stratégies au choix (paramètre de config `generation_mode`) :

### Mode "code" (recommandé pour démarrer)
Le LLM génère une fonction JavaScript pure qui retourne la liste des blocs :

```javascript
function generateStructure() {
  const blocks = [];
  // murs, toit, etc. calculés paramétriquement
  return blocks; // [{x, y, z, block}]
}
```

Exécuter ce code dans un sandbox (`vm` de Node.js avec timeout 5 s, aucun accès réseau ou filesystem). Ne jamais exécuter le code généré directement dans le processus principal.

### Mode "voxel" (pour fidélité maximale, phase 2)
Pipeline photo → modèle 3D → voxelisation :
- Reconstruction 3D avec TripoSR (ou équivalent) à partir de l'image
- Conversion du mesh en grille voxel avec ObjToSchematic ou un voxeliseur custom
- Mapping couleur RGB → bloc Minecraft le plus proche (table de correspondance à créer dans `data/block_colors.json`)

## Étape 4 : Validation et optimisation

- Vérifier que chaque nom de bloc existe (liste blanche dans `data/valid_blocks.json`)
- Rejeter toute coordonnée hors de la zone autorisée autour du joueur
- Optimisation : regrouper les volumes homogènes contigus en commandes `/fill` (algorithme greedy par tranches) pour réduire le nombre de commandes de plusieurs milliers à quelques dizaines
- Estimer le temps de construction et l'annoncer au joueur dans le chat avant de commencer

## Étape 5 : Exécution en jeu

- Demander confirmation au joueur dans le chat : "Construction de [type] ([dimensions]) devant toi. Tape !go pour confirmer, !cancel pour annuler"
- Positionner la structure face au joueur, à 5 blocs de distance, orientée vers lui
- Aplanir le terrain sur l'emprise + 1 bloc de marge (remplacer par de l'air au-dessus du sol, combler les trous avec de la terre)
- Construire par couches horizontales de bas en haut
- En mode créatif : utiliser `/fill` et `/setblock` via `bot.chat()`
- Prévoir une commande `!undo` qui restaure la zone (sauvegarder l'état initial des blocs avant construction)

## Structure du projet

```
minecraft-photo-builder/
├── CLAUDE.md                  (ce fichier)
├── package.json
├── config.json                (serveur MC, clé API, limites)
├── src/
│   ├── index.js               (point d'entrée, bot Mineflayer)
│   ├── webserver.js           (Express, upload photo)
│   ├── vision.js              (appel API Claude vision)
│   ├── generator.js           (génération structure, sandbox)
│   ├── optimizer.js           (fusion /fill, validation)
│   ├── builder.js             (exécution en jeu, undo)
│   └── chat.js                (commandes joueur !go !cancel !undo)
├── data/
│   ├── valid_blocks.json
│   └── block_colors.json
└── test/
    └── fixtures/              (photos de test)
```

## Dépendances

```json
{
  "mineflayer": "^4.x",
  "@anthropic-ai/sdk": "latest",
  "express": "^4.x",
  "multer": "^1.x"
}
```

## Configuration (config.json)

```json
{
  "minecraft": { "host": "localhost", "port": 25565, "username": "BuilderBot", "version": "1.20.4" },
  "web": { "port": 3000 },
  "limits": { "max_size": 64, "max_blocks": 100000, "sandbox_timeout_ms": 5000 },
  "generation_mode": "code"
}
```

La clé API Anthropic doit être lue depuis la variable d'environnement `ANTHROPIC_API_KEY`, jamais stockée dans le code ni dans config.json.

## Ordre d'implémentation recommandé

1. Bot Mineflayer minimal qui se connecte et répond au chat
2. Serveur Express avec upload d'image
3. Appel vision Claude → JSON de description (tester avec 3 ou 4 photos variées)
4. Génération mode "code" + sandbox + validation
5. Builder avec /fill optimisé + confirmation + undo
6. Tests de bout en bout, puis itération sur la qualité des prompts
7. (Phase 2) Mode voxel avec reconstruction 3D

## Points de vigilance

- La cohérence spatiale est le point faible des LLM : commencer par des bâtiments simples et paramétriques, itérer sur les prompts avec des exemples few-shot
- Toujours sandboxer le code généré par le LLM
- Throttler les commandes envoyées au serveur (max 10 commandes/tick) pour éviter le kick
- Logger chaque étape (image reçue, JSON vision, code généré, blocs placés) pour faciliter le debug
- Gérer proprement les erreurs API (retry avec backoff, message clair au joueur)

## Commandes joueur en jeu

| Commande | Action |
|----------|--------|
| `!photo` | Affiche le lien d'upload dans le chat |
| `!go` | Confirme la construction proposée |
| `!cancel` | Annule la proposition en cours |
| `!undo` | Restaure la zone avant la dernière construction |
| `!status` | Affiche l'avancement de la construction |
