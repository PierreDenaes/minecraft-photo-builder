# Design : Itération 7 — Lois de la physique et fidélité des modèles

Date : 2026-07-18 — Statut : validé — Base : branche interieurs-statues (I6, non mergée — merge commun I6+I7)

## Bugs constatés (captures Pierre)

Bibliothèques sur les remparts et torches flottantes (décor hors intérieur, non attaché) ; toits-dalles géants en débord flottant ; Yoshi blanc (COLOR_0 non lu) et demi-visage manquant (TRIANGLE_STRIP ignoré) ; bétons/laines utilisés en toiture de châteaux réalistes ; coins de bâtiments au-dessus du vide.

## Décisions (passes mécaniques testées, pas des suppliques au prompt)

1. **Décor sous toit** : un élément de mobilier n'est conservé que si un bloc de structure existe au-dessus (même colonne, y supérieur).
2. **Décor attaché** : chaque élément doit toucher la structure en 6-adjacence OU reposer sur un élément déjà conservé (tri par y croissant, deux passes).
3. **GLB complet** : primitives mode 5 (STRIP) et 6 (FAN) triangulées ; couleurs par sommet `COLOR_0` (float, u8, u16 normalisés) lues — priorité texture > COLOR_0 > baseColorFactor.
4. **Fondations automatiques** : `buildFoundations(baseCells, topY, heightAt, block)` (terrain.js) — chaque colonne de base du bâtiment posé est prolongée du sommet du terrain local jusqu'à la base ; bloc `stone_bricks`.
5. **Garde-fou visible** : `enforceSupport` retourne `{ blocks, removed, guard }` ; si `guard`, le chat avertit « structure majoritairement flottante conservée — sortie IA à revoir ».
6. **Matériaux réalistes** : `realisticMaterials(materiaux, description)` (palette.js) — bétons/laines/terracottas vives exclus SAUF si le style décrit est cartoon/moderne/jeu vidéo/coloré ; exceptions conservées : terracotta, brown_terracotta, white_wool.
7. **Prompt toit** : débord ≤ 1 bloc, aucune dalle horizontale plus large que l'emprise des murs.

## Tests

Décor : torche en l'air supprimée, torche murale conservée, meuble sans toit supprimé, chaîne mobilier-sur-mobilier conservée. GLB : strip/fan → triangles attendus ; COLOR_0 float et u8 → couleurs. Fondations : deux colonnes de hauteurs différentes comblées exactement. Guard : flag exposé. Matériaux : médiéval sans béton, cartoon inchangé. Prompt : /déborde/.

## Hors périmètre
Pathfinding d'accessibilité complet ; audit outils/ressources (livrable séparé post-merge).
