# Mission : refonte des prompts système du bot Minecraft

## Contexte

Le bot construit des structures Minecraft 1.20 à partir de photos et de modèles 3D, via 6 prompts système envoyés à l'API Anthropic (`claude-sonnet-4-6`). Un audit a identifié des corrections à appliquer. Ce dossier contient les nouveaux prompts et les changements de code associés.

Fichiers concernés dans le repo : `src/vision.js`, `src/generator.js`, `src/palette.js`, `src/decorator.js`, plus l'exécuteur de placement de blocs et la couche d'appel API.

## Ordre d'exécution recommandé

1. `01-generateur.md` : nouveau prompt du générateur, syntaxe d'états de blocs, sentinelle de troncature, passe de correction basée sur le code v1. C'est le chantier principal.
2. `02-comparaison.md` : nouveau prompt de comparaison, court-circuit RAS.
3. `03-vision.md` : nouveau prompt vision, calibration d'échelle, vocabulaires fermés.
4. `04-decorateur.md` : nouveau prompt décorateur, contexte du bâtiment, règles de circulation.
5. `05-palette.md` : contexte de scène pour assignThemes, passage à Haiku, dépréciation de assignBlocks.
6. `06-reglages-api.md` : température, prompt caching, prefill JSON. Transversal, à appliquer en dernier.

## Règles générales

- Les prompts fournis dans ces fichiers sont à reprendre TELS QUELS, à l'exception des interpolations `${...}` existantes qu'il faut conserver.
- Ne pas modifier les passes mécaniques existantes (sandbox, liste blanche, gravité, audit d'habitabilité) sauf là où un fichier le demande explicitement.
- Chaque fichier contient une section "Critères d'acceptation". Vérifier chacun avant de passer au fichier suivant.
- Si une hypothèse sur le code existant s'avère fausse (nom de fonction, structure), adapter le changement à la réalité du code plutôt que forcer, et le signaler dans le résumé final.

## Critères d'acceptation globaux

- [ ] Le flux `!photo` complet fonctionne de bout en bout (vision, génération, comparaison, correction éventuelle, décoration)
- [ ] Un rendu jugé fidèle (réponse RAS) saute la seconde passe de génération
- [ ] Les escaliers et portes générés sont orientés (états de blocs présents et exécutés)
- [ ] Aucune régression sur `!diorama` et `!statue` / `!portrait`
- [ ] Les tests existants passent ; ajouter les tests demandés dans chaque fichier
