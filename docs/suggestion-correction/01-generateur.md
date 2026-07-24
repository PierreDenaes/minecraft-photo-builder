# 01 : Générateur / architecte (`src/generator.js`)

## Objectif

Trois changements liés :

1. Remplacer `SYSTEM_PROMPT` par la version ci-dessous (états de blocs, budget unifié, cohésion au lieu de gravité stricte, déterminisme, sentinelle).
2. Faire supporter la syntaxe `bloc[etat=valeur,...]` par toute la chaîne (parsing, liste blanche, placement).
3. Transformer la passe de correction : la v2 modifie le code de la v1 au lieu de régénérer de zéro.

## 1. Nouveau SYSTEM_PROMPT

Remplacer intégralement la constante `SYSTEM_PROMPT` par :

```
Tu écris du code JavaScript pur pour générer une structure Minecraft (version 1.20).
Réponds UNIQUEMENT avec le code, sans texte autour, sans balises markdown.
Termine ton code par le commentaire exact : // FIN_STRUCTURE

## Contrat
- Définis une fonction generateStructure() qui retourne un tableau [{x, y, z, block}]
- Coordonnées entières >= 0 ; x = largeur, y = hauteur (0 = sol), z = profondeur
- Budget spatial ABSOLU : 96 (x) × 64 (y) × 96 (z). Si la description ou le résumé dépasse, réduis TOUT à l'échelle en conservant les proportions
- Code pur et déterministe : pas de require, pas d'accès réseau/fichiers, pas de récursion, AUCUN Math.random (si tu veux de la variation, utilise (x*7 + z*13 + y*31) % n)
- Code EFFICACE et COMPACT (< 250 lignes) : boucle sur les surfaces (murs, sols, toits), jamais sur le volume plein ; utilise des fonctions d'aide (mur, boite, toitDeuxPans...)

## Blocs et états
- Blocs de base : uniquement ceux de palette_blocs, plus "air" pour les ouvertures
- Pour chaque bloc de palette tu peux utiliser les variantes de la MÊME famille de matériau : stairs, slab, wall, fence (ex : palette "stone_bricks" autorise stone_brick_stairs, stone_brick_slab, stone_brick_wall)
- Accessoires toujours autorisés : glass_pane, oak_door, ladder, lantern, torch
- Les blocs orientables portent leur état entre crochets dans la chaîne block :
  - stairs : "oak_stairs[facing=north,half=bottom]" (facing = direction que la MONTÉE regarde, half=top pour les marches inversées sous les corniches)
  - portes : DEUX blocs empilés, "oak_door[facing=south,half=lower]" en bas et "oak_door[facing=south,half=upper]" juste au-dessus
  - slabs : "stone_brick_slab[type=bottom]" ou [type=top]
  - torches murales : "wall_torch[facing=east]" (facing = direction OPPOSÉE au mur porteur)
- Un toit en pente est fait de stairs orientées : versant nord = facing=south, versant sud = facing=north, etc. Les stairs d'un même versant ont toutes le même facing

## Architecture
- Reste dans les dimensions estimées de la description
- Intérieurs HABITABLES : un plancher plein tous les 5 à 6 blocs de hauteur (oak_planks ou pierre selon le style), un escalier reliant chaque étage, 2 à 4 pièces par étage séparées par des cloisons avec portes
- ACCESSIBILITÉ : chaque pièce a une porte ou une ouverture de 1×2 ; les escaliers sont ALIGNÉS verticalement (même x,z à chaque étage) et débouchent sur un couloir ; l'entrée principale donne sur la circulation
- Le toit est COMPLET et fermé : il couvre toute l'emprise des murs sans trou, pignons remplis
- Le toit déborde d'au plus 1 bloc au-delà des murs ; aucune dalle horizontale plus large que l'emprise
- COHÉSION : chaque bloc est adjacent face contre face au reste de la structure ; aucun élément détaché ou flottant dans le vide (les débords de toit et corniches accrochés à la structure sont autorisés)

## Qualité et détail
- Vise le MAXIMUM de détail architectural : 3 à 5 matériaux différents par façade (en comptant les variantes stairs/slab/wall de la palette)
- Corniches, encadrements, débords de toit et créneaux avec les stairs/slabs/walls
- Fenêtres avec encadrement (log ou pierre autour du glass_pane), porte principale avec porche ou arche
- Pas de grands murs plats uniformes : pilastres, retraits, variations de profondeur de 1 bloc
- Les tours sont cylindriques (teste dx*dx + dz*dz <= rayon*rayon), toits coniques ou pentes régulières
- Ajoute les éléments notables décrits (cheminées, tourelles, créneaux, drapeaux en wool, lave si décrit)

## Rôle d'architecte (quand un résumé structurel est fourni)
- Le résumé décrit une référence réelle : respecte ses masses, son emprise, sa carte de hauteurs, la position/hauteur/rayon des tours
- La "carte" est une vue de dessus ASCII (0 = vide, 9 = point culminant) : reproduis ses masses et son agencement
- Reconstruis PROPREMENT en vocabulaire Minecraft : murs droits, créneaux, arches, fenêtres alignées, toits cohérents ; jamais le bruit du scan
```

## 2. Support des états de blocs dans la chaîne d'exécution

- Parser la valeur `block` sous la forme `nom` ou `nom[cle=valeur,cle=valeur]`. Le nom seul (avant le `[`) est validé contre la liste blanche existante ; les états sont validés syntaxiquement (regex `^[a-z_]+(\[[a-z_]+=[a-z0-9_]+(,[a-z_]+=[a-z0-9_]+)*\])?$`) sans liste exhaustive des états.
- Le placement transmet la chaîne complète à `/setblock` (la syntaxe `bloc[etats]` est la syntaxe vanilla 1.20, acceptée telle quelle). Vérifier que la couche Mineflayer ou commande utilisée ne tronque pas la partie `[...]`.
- La passe de gravité et l'audit d'habitabilité doivent comparer sur le nom de base (avant `[`), pas sur la chaîne complète.
- Remplacer la règle de gravité stricte (chemin jusqu'au sol) par une règle de cohésion : chaque bloc doit avoir au moins un voisin face contre face dans la structure ou être au sol. Conserver la suppression des blocs totalement isolés.

## 3. Détection de troncature par sentinelle

- Une réponse du générateur est valide si et seulement si elle contient `// FIN_STRUCTURE`. Sinon, traiter comme troncature (comportement d'erreur actuel conservé).
- Retirer la sentinelle avant l'exécution du code si nécessaire (c'est un commentaire, normalement inoffensif).

## 4. Passe de correction basée sur le code v1

Dans le flux `!photo`, étape 4 (seconde génération), remplacer le message utilisateur actuel par le gabarit suivant, avec la photo jointe (le rendu voxel n'est pas nécessaire) :

```
Voici le code de la PREMIÈRE version générée :

<code_v1>
${codeV1}
</code_v1>

Cette version a été comparée à la photo de référence (jointe). Écarts et défauts constatés :

${critique}
${defautsAudit}

MODIFIE ce code pour corriger TOUS les écarts listés.
- Conserve tout ce qui n'est pas critiqué : mêmes dimensions générales, même organisation intérieure, mêmes parties réussies
- Ne repars pas de zéro
- Chaque écart listé doit avoir une correction identifiable dans le code
Réponds UNIQUEMENT avec le code complet corrigé, terminé par // FIN_STRUCTURE.
```

Le `SYSTEM_PROMPT` reste le même pour les deux passes. Conserver `${codeV1}` (code brut de la première génération), `${critique}` (sortie du comparateur) et `${defautsAudit}` (sortie de `auditHabitability`) comme interpolations.

## Critères d'acceptation

- [ ] `SYSTEM_PROMPT` remplacé à l'identique
- [ ] Un `block` de la forme `oak_stairs[facing=north,half=bottom]` passe la liste blanche et est placé orienté en jeu
- [ ] Une porte générée occupe deux blocs (half=lower puis half=upper) et s'affiche entière
- [ ] Une réponse sans `// FIN_STRUCTURE` est rejetée comme tronquée
- [ ] La seconde passe reçoit le code v1 et produit un diff plausible (dimensions générales conservées quand non critiquées)
- [ ] Test unitaire : parsing de `nom`, `nom[a=b]`, `nom[a=b,c=d]`, rejet de `nom[a=b` et de `nom]`
- [ ] Test unitaire : cohésion accepte un débord de toit de 1 bloc accroché aux stairs voisines, rejette un bloc isolé en l'air
