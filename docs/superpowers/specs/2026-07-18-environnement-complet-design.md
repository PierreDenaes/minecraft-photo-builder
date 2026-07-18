# Design : Itération « environnement complet » (delta phase 2)

Date : 2026-07-18
Statut : validé
Base : phase 2 mergée (diorama + modèles 3D + palettes par thèmes)

## Demandes de Pierre (verbatim résumé)

Plus de détail ; limites relevées (erreur `102001 > 100000`) ; gravier interdit dans le bâti ; formes 3D pleines (pas seulement la surface) ; logique de terrain naturel codée (pas seulement la texture) ; sous la surface : cavités aléatoires et minerais ; objectif : « recréer un environnement complet respectant la simulation ».

## Décisions

- Résolution diorama : **160×120×120** (option A), `limits.diorama.max_blocks` 1 200 000, mode code `max_blocks` 300 000, throttle **16 cmd/tick** (~320 cmd/s, ~3-5 min pour 500 k blocs fusionnés).
- `gravel` retiré du thème `roche` (reste dans `terre`) → jamais dans les murs.
- Meshes : remplissage **plein** par colonne (y=0 → surface la plus haute, vides internes comblés).
- Stratification codée (les deux voxeliseurs) : surface = bloc du thème ; profondeur 1-2 = terre (`dirt`) si surface végétale/terreuse, sinon roche ; profondeur ≥ 3 = roche (`stone`) ; **quart inférieur** = `deepslate`.
- Sous-sol procédural déterministe (graine par construction, hachage coordonnées) :
  - **Cavités** : poches par bruit de cellules (~8-12 % du volume profond), jamais à moins de 4 blocs sous la surface ni sous y=2.
  - **Minerais** : probabilité par bloc selon la profondeur — charbon/cuivre (haut), fer (milieu), or/redstone/lapis (profond), diamant/émeraude (fond) ; variantes `deepslate_*_ore` dans la zone deepslate.
- 16 blocs de minerai + variantes ajoutés à `data/valid_blocks.json` (placés par règle, hors tables de couleurs filtrées).
- `undoFlat` : couches 162×122 = 19 764 < 32 768 ✓ inchangé dans son principe.

## Interfaces nouvelles

| Module | Interface |
|---|---|
| `src/subsurface.js` | `createUnderground({ seed, maxY }) → fill(x, y, z, depth, surfaceTheme) → string \| null` (null = cavité/air) ; exporte aussi `hash01(seed, x, y, z)` pour les tests |
| `src/voxelizer.js` | `voxelizeScene(..., { ..., underground })` — le comblement sous la surface passe par `underground.fill` (profondeur croissante vers le bas) |
| `src/meshvoxelizer.js` | `voxelizeMesh(..., { ..., solid: true, underground })` — remplissage plein par colonne + sous-sol |
| `src/index.js` | graine aléatoire par upload, annoncée dans les logs ; thème de surface transmis (végétation → dirt dessous) |

## Tests

Propriétés déterministes (graine fixe) : même graine ⇒ même résultat ; fraction de cavités dans [4 %, 18 %] sur un volume profond ; aucun creux à depth < 4 ; minerais ∈ liste autorisée et fraction < 5 % ; deepslate et variantes uniquement dans le quart inférieur ; remplissage plein : colonne du cube test sans trou entre 0 et la surface.

## Hors périmètre

Grottes connectées façon vraies caves Minecraft (tunnels), biomes, arbres procéduraux, villages.
