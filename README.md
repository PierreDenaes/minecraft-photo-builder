# Minecraft Photo Builder

Bot Minecraft (Mineflayer) qui construit en jeu à partir d'une **photo**, d'un **modèle 3D** ou d'une simple envie de fresque. L'analyse visuelle et l'architecture sont confiées à Claude (`claude-sonnet-4-6`), la géométrie et la physique à des passes mécaniques testées.

## Capacités

| Commande en jeu | Ce que ça construit |
|---|---|
| `!photo` | Interprétation d'une photo de bâtiment : vision → architecte (qui **voit** la photo) → rendu comparé à la photo → régénération corrigée → audit d'habitabilité (hauteur sous plafond, entrée, escaliers) → décoration intérieure guidée par la carte des murs |
| `!diorama` | Copie conforme : photo de paysage (profondeur estimée localement par Depth Anything V2) **ou** modèle 3D `.obj`/`.stl`/`.glb` (textures, couleurs de sommets et STRIP/FAN lus). Mode « inspire » par défaut : le modèle sert de référence, l'IA reconstruit un bâtiment habitable posé sur un relief naturel avec sous-sol (strates, cavités, minerais) et végétation. Cadrage intelligent : une maison seule est posée seule, sans colline inventée |
| `!statue` | Statue voxelisée d'un modèle 3D de personnage, sur socle, palette couleurs vives. Le fichier fait foi pour l'orientation : `!tourner` (90° yaw) et `!redresser` (pitch) avant **ou** après construction |
| `!portrait` | Fresque murale pixel-art d'un bloc d'épaisseur avec cadre, mapping couleur sur toute la palette |
| `!maison` | Reconstruction 3D fidèle d'un bâtiment depuis une photo (TripoSR local, ~1-3 min). Prérequis : `bash scripts/setup-triposr.sh` (voir plus bas) |
| `!go` / `!cancel` | Confirme ou annule la proposition en attente |
| `!status` | Avancement de la construction |
| `!undo` | Restaure la zone d'avant la dernière construction |

Chaque commande affiche le lien d'upload (`http://localhost:3000/upload/<pseudo>`), la construction se fait face au joueur.

### Garde-fous mécaniques (pas des promesses de prompt)

- **Palettes sémantiques à deux niveaux** : k-means des couleurs → le LLM choisit un thème de matière par famille (roche, bois, maçonnerie...) → le rendu nuance avec tous les blocs du thème. Jamais de bloc fonctionnel dans un mur, jamais de fluide dans un rendu vertical, feuilles posées persistantes.
- **Gravité et attachements** : suppression des blocs flottants (BFS de support), torches converties en torches murales orientées selon le mur réel, fondations automatiques sous les bâtiments posés sur relief.
- **Audit d'habitabilité** : hauteur libre médiane par étage, entrée 1x2 dans les murs extérieurs, escaliers entre niveaux — mesurés sur les blocs et réinjectés dans la passe de correction ; les défauts persistants sont annoncés dans le chat.
- **Sandbox** : tout code généré par le LLM s'exécute dans `vm` avec timeout, blocs validés contre une liste blanche (états `[facing=...]` à charset strict), coordonnées bornées.
- **Robustesse** : voxelisation asynchrone (le bot répond au keep-alive pendant les gros calculs), reconnexion automatique en 5 s, commandes throttlées (16/tick), `!undo` par snapshot.

## Installation

Prérequis : Node.js ≥ 20.12, Docker (pour le serveur de test), une clé API Anthropic.

```bash
npm install

# Clé API (jamais dans le code ni config.json)
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Modèle de profondeur local (Depth Anything V2 small, ~50 Mo dans models/)
npm run setup:depth

# Table couleur→bloc extraite des textures du jar client 1.20.4 (data/block_colors.json)
npm run colors

# Serveur de test Paper 1.20.4 (créatif, superflat, offline, RCON, anti-spam patché)
npm run server        # attendre la ligne « Done » puis Ctrl-C sur les logs

# Lancer le bot + serveur web d'upload
npm start
```

Rejoindre `localhost:25565` avec un client 1.20.4, puis taper `!photo` (ou autre) dans le chat.

## Configuration (`config.json`)

- `limits.max_size` 96 / `max_blocks` 500 000 : bâtiments `!photo`
- `limits.diorama` : 160×120×120, 2 500 000 blocs
- `reconstruction` : `"inspire"` (défaut, reconstruction IA) ou `"brut"` (voxelisation directe du modèle)
- `throttle_cmds_per_tick` : 16 commandes / 50 ms

## Développement

```bash
npm test              # 200 tests (node:test)
npm run server:reset  # réinitialise le monde
```

Architecture dans `src/` (un module par responsabilité : vision, generator, voxelizer, meshvoxelizer, palette, terrain, subsurface, support, decorator, habitability, portrait, builder, optimizer, chat, webserver). Spécifications des itérations dans `docs/superpowers/specs/`, pistes d'amélioration dans `docs/audit-ameliorations-2026-07-19.md` (FAWE + schematics, détourage BiRefNet, simplification GLB, TripoSR).

## Reconstruction 3D locale (TripoSR) — commande `!maison`

`!maison` transforme une photo en vrai modèle 3D voxelisé, plus fidèle que le mode primitives quand tu veux la reproduction exacte d'un objet ou d'un petit bâtiment. Installation ponctuelle :

```bash
# Prérequis : Python 3.10 ou 3.11 (PAS 3.14+, incompatible PyTorch), ~5 Go d'espace disque, ~10 min
# macOS : brew install python@3.11

bash scripts/setup-triposr.sh
```

Le script clone TripoSR dans `vendor/TripoSR/`, crée un venv, installe torch + rembg + les dépendances, et vérifie l'import. Le modèle (~2 Go) sera téléchargé au premier `!maison` depuis HuggingFace.

**Durée** : 30 s à 3 min par photo sur Apple Silicon (CPU/MPS). CUDA détecté automatiquement si dispo.

**Si l'install échoue** : le bot répondra `TripoSR non installé (script Python introuvable...)` lors de `!maison`. Relance le setup ou reste sur `!photo` (mode primitives).
