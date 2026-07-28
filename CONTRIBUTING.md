# Contribuer à Minecraft Photo Builder

Merci de votre intérêt ! Ce projet transforme une photo, un modèle 3D ou un texte
en construction Minecraft via l'API Claude. Voici comment participer.

## Prérequis

- **Node.js ≥ 20.12** (le projet utilise `process.loadEnvFile()` et le lanceur de tests natif `node:test`).
- **Un serveur Minecraft Java 1.20.4** — le plus simple via Docker (`docker compose up -d`).
- **Une clé API Anthropic** (`ANTHROPIC_API_KEY`), payante — indispensable au pipeline vision.
- Optionnel : une clé **SerpAPI** (`SERPAPI_KEY`) pour la commande `!build <texte>`.

## Installation

```bash
git clone https://github.com/PierreDenaes/minecraft-photo-builder.git
cd minecraft-photo-builder
npm install
```

Créez un fichier `.env` à la racine (il est gitignoré, ne le commitez jamais) :

```
ANTHROPIC_API_KEY=sk-ant-...
SERPAPI_KEY=...            # optionnel, seulement pour !build
```

Lancez le serveur Minecraft puis le bot :

```bash
docker compose up -d        # serveur MC (ou branchez le vôtre via config.json)
node src/index.js           # le bot se connecte et écoute le chat
```

## Lancer les tests

Le projet a une large couverture (près de 500 tests, tous en `node:test` natif, sans
dépendance externe) :

```bash
npm test
```

Toute contribution doit garder la suite verte.

## Configuration

Tout se règle dans `config.json` : connexion au serveur, limites de taille, et la
section `models` qui centralise les identifiants de modèles Claude utilisés par chaque
étape du pipeline (analyse vision, critique, génération, etc.). Voir le README.

## Workflow de contribution

1. **Forkez** le dépôt et créez une branche depuis `main` (`git checkout -b fix-...`).
2. Écrivez le code **avec ses tests** (approche TDD encouragée : test qui échoue d'abord).
3. Vérifiez que `npm test` passe intégralement.
4. Commitez avec un message clair au format `type: sujet` (ex : `fix: ...`, `feat: ...`, `docs: ...`).
5. Ouvrez une **Pull Request** vers `main` en décrivant le changement et en confirmant que les tests passent.

## Style & philosophie du code

- Architecture saine : le LLM choisit la sémantique (matériaux, style), le code
  calcule les positions et applique des garde-fous mécaniques testés.
- Replis systématiques quand le LLM est indisponible.
- Déterminisme soigné (k-means, hash, seeds) pour des tests reproductibles.
- Commentaires en français, comme le reste du projet.

## Signaler un bug

Ouvrez une *issue* avec le template « Bug report » : étapes de reproduction, comportement
attendu, et un extrait de `logs/app.log` si pertinent.
