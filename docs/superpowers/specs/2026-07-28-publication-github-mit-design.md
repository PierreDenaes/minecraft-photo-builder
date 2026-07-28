# Publication GitHub MIT de `agentMinecraft` — design

Date : 2026-07-28. Objectif : rendre le projet publiable en open-source (licence MIT,
dépôt public GitHub) après l'audit complet du code (495 tests, tout commité).

## Décisions actées (brainstorming avec Pierre)

- **Licence** : MIT, « Copyright (c) 2026 Pierre-Jacques Denaes ».
- **Dépôt** : public, nom `agentMinecraft`, ouvert aux contributions.
- **Push final** : Pierre le fait lui-même. L'assistant prépare et commite en local,
  ne touche JAMAIS au remote (pas de `git remote add`, pas de `git push`, pas de `gh`).
- **Livrables** : pack complet (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, templates GitHub,
  package.json complété, README enrichi, tag v1.0.0).
- **`docs/`** : entièrement retiré du suivi git (contenu tiers sous copyright — Joconde,
  Bowser, Sonic, châteaux —, une photo perso, et les plans d'audit internes).
- **README** : sans images pour l'instant (Pierre ajoutera ses propres captures plus tard).
- **Historique** : NON réécrit. L'e-mail `photostudio13000@gmail.com` reste sur les
  239 commits (accepté). Une réécriture est possible plus tard si souhaité (hors périmètre).

## Périmètre

### 1. Retrait de `docs/` du suivi
- `git rm -r --cached docs/` (retire du suivi, conserve les fichiers locaux).
- Ajouter `docs/` au `.gitignore`.
- Conséquence fonctionnelle unique : `!schema` n'a plus la bibliothèque `docs/schem/*.schem`
  et bascule automatiquement sur `!photo` (repli déjà présent dans le code). Documenté au README.
- Aucun autre module ne lit `docs/` au runtime (vérifié : seul schemas.js via `docs/schem`).

### 2. Livrables à créer
- **`LICENSE`** : texte MIT standard, année 2026, titulaire Pierre-Jacques Denaes.
- **`CONTRIBUTING.md`** : prérequis (Node, serveur MC via Docker), installation, `.env`
  (ANTHROPIC_API_KEY, SERPAPI_KEY), lancement (`node src/index.js`), tests (`npm test`,
  495 passants), convention de commits, workflow PR (fork → branche → PR).
- **`CODE_OF_CONDUCT.md`** : Contributor Covenant v2.1, contact = e-mail Pierre.
- **`.github/ISSUE_TEMPLATE/bug_report.md`**, **`.github/ISSUE_TEMPLATE/feature_request.md`**,
  **`.github/pull_request_template.md`**.
- **`package.json`** : ajouter `description`, `"license": "MIT"`, `author`,
  `repository` (URL GitHub prévue), passer `version` de `0.1.0` à `1.0.0`.
- **`README.md`** : conserver le contenu existant (tableau des commandes, garde-fous,
  archi) ; ajouter Installation, Configuration (section `models` de config.json),
  note `!schema` sans schemas, badge licence, mention 495 tests, variables d'env requises.

### 3. Vérifications avant commit
- `npm test` vert (495 passants).
- `.env` absent du suivi (déjà gitignored — reconfirmer).
- Aucun secret dans le diff final (`git diff --cached` relu).
- `git status` propre après les `git rm --cached`.

### 4. Commits & tag (LOCAL uniquement)
- Commit 1 : `chore: retrait de docs/ du suivi (contenu tiers, plans d'audit internes)`.
- Commit 2 : `docs: livrables publication OSS (LICENSE MIT, CONTRIBUTING, CoC, templates, README)`.
- Tag annoté `v1.0.0`.
- STOP. Fournir à Pierre les commandes exactes pour créer le dépôt et pousser
  (`gh repo create` OU création manuelle + `git remote add` + `git push -u origin main --tags`).

## Hors périmètre
- Toute interaction avec le remote GitHub (création dépôt, push) — réservé à Pierre.
- Réécriture de l'historique git (anonymisation e-mail).
- Ajout de captures d'écran au README.
- Réintégration d'une bibliothèque de schemas libres de droits pour `!schema` (futur).

## Critères de succès
- Le dépôt local est prêt à être poussé : livrables complets, `docs/` non suivi,
  tests verts, tag v1.0.0 posé, aucun secret ni contenu tiers dans les fichiers suivis.
- Pierre dispose des commandes exactes pour publier en une étape.
