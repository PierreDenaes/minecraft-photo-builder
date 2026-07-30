# Landing page — Minecraft Photo Builder

**Date :** 2026-07-30
**Objectif :** page vitrine hébergée sur GitHub Pages qui donne envie aux joueurs de tester et d'en parler, tout en montrant le sérieux technique. Ton : fun ET premium.

## Contexte

Le repo `minecraft-photo-builder` (bot Mineflayer construisant en jeu depuis photo/3D/texte via Claude) est public sous licence MIT mais n'a pas de page de présentation. Un post Reddit a été supprimé (règle « IA générative interdite » du sous-reddit) : une landing page propre donne un point d'entrée neutre et crédible pour partager le projet ailleurs.

## Audience

Double, équilibrée :
- **Joueurs / curieux** : le « wow » visuel (vidéo, rendus), l'histoire humaine → donnent envie de tester et partager.
- **Développeurs** : architecture, garde-fous mécaniques, tests → crédibilité, contributions, portfolio.

## Direction visuelle

**Minecraft-tech premium.**
- Fond sombre profond (près du noir bleuté).
- Accents : **émeraude** (vert bloc emerald) en couleur primaire + **or/ambre** en secondaire (côté « trésor / premium »).
- Touches voxel *discrètes* : grille de blocs subtile en arrière-plan, coins légèrement crantés sur les cartes, effet « élévation de bloc » au survol.
- Typographie : moderne et lisible pour le corps ; le pixel/monospace reste un **accent** (titres courts, labels de commandes), jamais le corps de texte.
- Micro-animations : révélation au scroll (fade/translate), survols réactifs. Respecte `prefers-reduced-motion`.
- Thème sombre par défaut, cohérent avec l'univers ; pas de bascule clair/sombre nécessaire (thème unique assumé).

## Structure (single page, scroll vertical)

1. **Nav sticky** — nom du projet (logo texte) · toggle langue 🇫🇷/🇬🇧 · lien « Démo » (ancre) · bouton « ⭐ GitHub ».
2. **Hero** — titre accrocheur (« Donne-lui une image. Il la construit. »), sous-titre une phrase, 2 CTA (« ▶ Voir la démo » ancre vidéo / « Tester sur GitHub » lien repo). Fond : `presentation.png` traité (overlay sombre) ou grille voxel animée légère.
3. **Démo vidéo** — embed YouTube (https://youtu.be/Y9XlU_OFA9M) en grand, ratio 16:9 responsive. Élément « wow » central.
4. **Comment ça marche** — 4 étapes illustrées d'icônes : 📷 Tu envoies (photo/3D/texte) → 🧠 Claude analyse (vision + architecture) → ⚙️ Géométrie & physique (passes mécaniques testées) → 🏗️ Construction en jeu.
5. **Ce que tu peux construire** — cartes des commandes : `!photo`, `!diorama`, `!statue`, `!portrait`, `!build <texte>`. Chaque carte : titre, une phrase, hover « bloc ».
6. **Galerie de rendus** — les 6 images d'`assets/` en grille responsive avec légendes (Tour Eiffel, Gratte-ciel, Villa moderne, Le Cri de Munch, Statue, Statues). Hover zoom léger.
7. **Sous le capot** (devs) — garde-fous mécaniques présentés en cartes courtes : gravité (BFS de support), habitabilité (hauteur/entrée/escaliers), palettes sémantiques 2 niveaux, sandbox `vm`, ~495 tests. Ton factuel, section un peu plus sobre pour ne pas casser le fun.
8. **L'histoire** — encart « Né d'une conversation avec Thomas, 9 ans ». Court, sincère : l'enfant s'intéressait au travail « création d'agent IA » de son père, qui lui a dit « imagine un agent dans le jeu à qui tu donnes une image et il la construit ». C'est l'étincelle du projet.
9. **CTA final** — « Teste-le » + boutons GitHub / Vidéo / Licence MIT.
10. **Footer** — MIT · © 2026 Pierre-Jacques Denaes · liens (GitHub, vidéo).

## Bilingue FR / EN

- Toggle 🇫🇷/🇬🇧 dans la nav.
- Tout le texte visible porte un attribut `data-i18n="clé"` ; deux dictionnaires JS `{ fr: {...}, en: {...} }`.
- Le toggle réécrit le contenu selon la langue et met à jour `document.documentElement.lang`.
- Défaut : **FR**. Choix mémorisé en `localStorage` (clé `mpb-lang`).
- L'embed vidéo et les images sont language-agnostic (seules les légendes/alt changent).

## Technique

- **Un seul fichier autonome** `docs/index.html` : CSS et JS inline, **zéro dépendance externe** (aucun CDN, aucune police web distante — polices système + éventuelle @font-face en data-uri si vraiment nécessaire, sinon stack système). Garantit chargement instantané et zéro souci CSP/offline.
- Images : chemins relatifs. Les 6 rendus + presentation.png sont copiés dans `docs/assets/` (GitHub Pages sert depuis `/docs`, les chemins doivent être relatifs à `docs/`).
- Vidéo : `<iframe>` YouTube nocookie (`youtube-nocookie.com/embed/Y9XlU_OFA9M`), lazy.
- Responsive mobile-first (grilles en `minmax`/`auto-fit`, media queries).
- Accessibilité : contrastes AA, `alt` sur images, focus visibles, `prefers-reduced-motion`.

## Hébergement

- **GitHub Pages depuis `/docs` sur la branche `main`.**
- `docs/` est actuellement dans `.gitignore` (y avait été mis car il contenait du contenu tiers, depuis supprimé). Action : retirer `docs/` du `.gitignore` de sorte que `docs/index.html` et `docs/assets/` soient suivis. Vérifier qu'aucun contenu tiers ne réapparaît.
- Activer Pages via `gh api` (source = branch `main`, path `/docs`) une fois le fichier poussé.
- Mettre l'URL de la page dans le champ `homepage` du repo (`gh repo edit --homepage`) et en tête du README.

## YAGNI (hors périmètre)

- Pas de framework JS (React/Vue) — page statique.
- Pas de backend, pas de formulaire, pas d'analytics tiers.
- Pas de bascule thème clair/sombre.
- Pas de police pixel pour le corps de texte.

## Critères de succès

- La page se charge seule sur GitHub Pages sans erreur console ni requête externe bloquée.
- Vidéo lisible, 6 rendus affichés, toggle FR/EN fonctionnel et persistant.
- Rendu correct mobile + desktop.
- Lien GitHub et licence MIT présents ; histoire père-fils présente.
- Aucun contenu tiers (copyright) réintroduit dans le repo.
