# Design : Itération 12 — Primitives de construction (voie B)

Date : 2026-07-23 — Statut : validé — Base : `main` après I11 (masque du bâtiment principal)

## Origine

Trois runs de la villa Trecobat (photo `construction-maison-design-constructeur-maison-trecobat-1024x682.jpg`) : baies vitrées absentes, entrée absente, escalier sur le toit. Diagnostic — le LLM raisonne spatialement à l'aveugle en écrivant `place(x, y, z, bloc)`. Chaque passe mécanique corrige un symptôme, un autre défaut apparaît ailleurs. Pierre : « on part sur la voie B ». Choix : le LLM appelle des primitives haut-niveau, il ne pose plus aucun bloc directement.

## Périmètre

`!photo` uniquement. `!diorama` inspire, `!statue`, `!portrait` inchangés cette itération.

## Les 8 primitives (`src/primitives.js`)

Chacune retourne `[{x, y, z, block}]` et se compose sans effet de bord global.

- `boite({x1, z1, x2, z2, y0, y1, murs, fondation, plancher, epaisseur=1})` — 4 murs pleins d'épaisseur donnée entre y0+1 et y1-1, dalle basse en `fondation` à y0 sur toute l'emprise, dalle haute en `plancher` à y1 si fournie.
- `porte({facade, x, z, y0, hauteur=2, materiau})` — perce une ouverture 1×hauteur dans le mur de la façade indiquée à la coordonnée donnée (air), pose un linteau du materiau au-dessus. La porte battante `oak_door[facing,half]` est posée dans les deux blocs d'air.
- `baie({facade, x1, z1, x2, z2, y1, y2, encadrement})` — glass_pane sur toute la rangée, encadrement du materiau autour (bas, haut, côtés). Perce le mur existant.
- `toitPlat({x1, z1, x2, z2, y, materiau, acrotere=true, debord=1})` — dalle horizontale sur toute l'emprise + acrotère facultatif en `wall` d'un bloc sur le pourtour + débord.
- `toitDeuxPans({x1, z1, x2, z2, y_base, faitage, materiau, debord=1})` — versants en stairs orientées, pignons remplis, débord 1 par défaut, jamais plus.
- `toitQuatrePans({x1, z1, x2, z2, y_base, materiau, debord=1})` — croupe : rangées rétrécissant de 1 sur les 4 côtés à chaque niveau.
- `escalier({x, z, y_bas, y_haut, facing, materiau, tremie=true, largeur=1})` — marches ascendantes alignées, masse de soutien pleine, trémie percée dans le plancher supérieur si présent. Facing indique la direction que la montée regarde.
- `piscine({x1, z1, x2, z2, y_surface, profondeur=2, bordure})` — bassin étanche : fond plein en `bordure`, parois pleines, eau à `y_surface`.

Toutes valident leurs arguments (dimensions positives, coordonnées entières, materiau string dans la whitelist). Erreur claire sinon.

## Sandbox contrôlé (`src/generator.js`)

Le contexte VM ne contient plus que : les 8 primitives, `Math` (sin/cos pour modulations paramétriques), et rien d'autre. Pas de `require`, pas de `globalThis`, pas de `place`. Un `generateStructure()` qui tente `place(...)` lève `ReferenceError` — remontée dans la boucle de re-prompt existante (le LLM se corrige).

Le concaténateur de blocs est trivial : `generateStructure()` retourne un tableau de blocs. Le LLM le compose lui-même en appelant les primitives et en concaténant leurs résultats.

## Nouveau `SYSTEM_PROMPT` du générateur

Environ 40 lignes structurées :
1. Contrat (fonction generateStructure, retour tableau, sentinelle FIN_STRUCTURE — conservée pour la troncature).
2. Signature complète des 8 primitives.
3. Règles de composition (une baie dans un mur existant, une porte perce un mur, un escalier relie deux planchers, un toit couvre une emprise).
4. Deux exemples courts : maison à un étage (boite + porte + 2 baies + toitDeuxPans) et villa avec piscine (boite + porte + 3 baies + escalier + toitPlat + piscine).
5. Interdiction stricte : ne cite aucun nom de bloc individuel hors des paramètres `materiau`/`murs`/`fondation`/etc.

Les fiches de style de l'almanach passent dans le message utilisateur comme **inspiration de composition** (« un manoir médiéval : boite en cobblestone avec colombages, toit deux pans en dark_oak, cheminée hors-œuvre »), pas dans le system.

## Ce qui disparaît

- Toutes les règles « stairs facing », « portes en 2 blocs », « toit COMPLET », « intérieurs habitables » du prompt — mécaniquement garanties par les primitives.
- `carveStaircase` : la primitive `escalier` fait mieux d'entrée. Si le LLM oublie d'appeler `escalier`, l'audit remonte le défaut à la passe de correction. Suppression complète du fichier et du câblage.
- `completeDoors` : la primitive `porte` pose les deux moitiés d'entrée. Suppression.

## Ce qui reste

- Vision, comparaison photo/rendu, boucle de correction sur code v1 (2 tentatives), boucle de re-prompt sur erreur d'exécution (3 tentatives).
- Masque du bâtiment principal, audit d'habitabilité (hauteur libre, entrée, escaliers, façades, fenêtres, eau, baies promises).
- Décoration inversée (chooseFurnitureSets Haiku + furnishRooms déterministe).
- Passes physique (gravité BFS, attachements, fluides).
- `!diorama` inspire, `!statue`, `!portrait` : générateur inchangé (variable de config `generator_mode: 'primitives' | 'code'`, primitives par défaut sur `!photo`).

## Tests attendus

- Chaque primitive isolément : boite étanche, porte réellement traversable (l'audit d'habitabilité passe), baie alignée avec vitres et encadrement, chaque toit couvre l'emprise sans trou, escalier réellement monté (audit passe), piscine étanche.
- Sandbox : `place(1,2,3,'stone')` lève ReferenceError, `require('fs')` lève ReferenceError, un appel valide passe.
- Intégration : un `generateStructure()` composé de boite+porte+baie+toit+escalier passe `auditHabitability` sans défaut.
- Régression : `!diorama`, `!statue`, `!portrait` inchangés.

## Hors périmètre

- `!diorama` inspire (itération suivante).
- Primitives d'ornement (colombages, corniches, créneaux, tourelles) : reportées, le LLM les composera avec `boite`+`escalier` cette itération.
- Migration Minecraft 26.1.2 (attend la fin de cette itération).
