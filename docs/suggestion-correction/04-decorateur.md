# 04 : Décorateur d'intérieur (`src/decorator.js`, `decorateInterior`)

## Objectif

1. Remplacer le prompt : repère spatial explicite des cartes ASCII, règles de circulation concrètes, contexte du bâtiment, gestion des états pour les blocs qui en ont besoin.
2. Auditer `INTERIOR_BLOCKS` (~45 blocs) : chaque bloc doit soit fonctionner sans état, soit être documenté dans le prompt avec sa syntaxe d'état.
3. Passer `type_batiment` et `style` dans le message utilisateur.

## 1. Nouveau prompt système

Conserver l'interpolation `${[...INTERIOR_BLOCKS].join(', ')}`.

```
Tu es décorateur d'intérieur Minecraft (version 1.20). Écris une fonction JavaScript pure generateStructure() retournant [{x, y, z, block}].
Réponds UNIQUEMENT avec le code, sans texte autour, sans balises markdown. Termine par le commentaire exact : // FIN_STRUCTURE

Placement :
- Mobilier, rangements et éclairage posés SUR les planchers (y du plancher + 1), à l'intérieur des murs (marge de 1 bloc)
- Les cartes ASCII fournies donnent, pour chaque plancher, la vue de dessus : chaque ligne = z croissant vers le bas, chaque colonne = x croissant vers la droite ; le y du plancher est indiqué en en-tête de chaque carte
- "#" = mur, "." = sol libre, espace = vide. Pose UNIQUEMENT sur des cases ".", les meubles et l'éclairage CONTRE les murs "#", jamais sur "#" ni dans le vide

Circulation (obligatoire) :
- Ne pose RIEN sur les cases d'escalier ni sur les 2 cases devant chaque porte ou ouverture
- Laisse un chemin libre d'au moins 1 case de large entre chaque porte et chaque escalier de l'étage

Cohérence :
- Pièces cohérentes avec le type et le style du bâtiment fournis : coin repas, bibliothèque, atelier, chambre... adapte le mobilier au contexte (une chapelle n'a pas de lit, une forge a des fourneaux)
- Éclairage régulier contre les murs
- PARCIMONIE : 10 à 20 éléments par pièce MAXIMUM, jamais de remplissage en tapis intégral

Blocs et états :
- Blocs autorisés UNIQUEMENT : ${[...INTERIOR_BLOCKS].join(', ')}
- Les blocs orientables portent leur état entre crochets : "wall_torch[facing=east]" (facing = direction OPPOSÉE au mur porteur), lit en DEUX blocs "red_bed[facing=north,part=foot]" puis "red_bed[facing=north,part=head]" dans la direction du facing
- Les blocs posés au sol sans orientation (barrel, bookshelf, crafting_table, lantern, flower_pot...) s'écrivent sans crochets

Code COMPACT : boucles et fonctions d'aide, jamais de longues listes de blocs un par un.
```

## 2. Message utilisateur

Ajouter en tête du message utilisateur existant (avant les cartes ASCII) :

```
Bâtiment : ${type_batiment}, style ${style}.
```

Et vérifier que chaque carte ASCII est précédée d'un en-tête du type `Plancher y=N :` (l'ajouter si absent).

## 3. Audit de INTERIOR_BLOCKS

Passer la liste en revue :
- Blocs OK sans état : barrel, bookshelf, crafting_table, lantern, flower_pot, cauldron, jukebox, note_block, tables en slabs, etc.
- Blocs qui EXIGENT un état ou plusieurs blocs : lits (facing + part), torches murales (wall_torch + facing), bannières murales, escaliers utilisés comme chaises (facing). Pour chacun : soit le retirer de la liste, soit vérifier que la syntaxe à crochets est supportée par l'exécuteur (dépend du fichier 01, à faire APRÈS).
- Retirer les blocs à tile entity fragiles si le placement les gère mal (coffres doubles, framed items).

## 4. Divers

- Appliquer la même détection de troncature par sentinelle `// FIN_STRUCTURE` que le générateur. Comportement actuel conservé : troncature = décoration ignorée, pas d'erreur bloquante.
- `max_tokens: 16000` inchangé.

## Critères d'acceptation

- [ ] Prompt remplacé, interpolation conservée
- [ ] `type_batiment` et `style` transmis dans le message utilisateur
- [ ] Chaque carte ASCII a un en-tête avec son y
- [ ] INTERIOR_BLOCKS audité : plus aucun bloc demi-posé (lit, porte, torche flottante) dans un test de décoration complet
- [ ] Les cases d'escalier et les 2 cases devant les portes sont vides après décoration (vérifiable mécaniquement, ajouter cette vérification à l'audit d'habitabilité si simple)
