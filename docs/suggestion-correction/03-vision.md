# 03 : Vision, analyse de photo (`src/vision.js`, `systemPrompt`)

## Objectif

Remplacer le prompt vision : calibration d'échelle, vocabulaires fermés pour les champs consommés par le générateur, précision de zone_batiment, gestion multi-bâtiments, essences d'arbres élargies. Injecter systématiquement la liste blanche de blocs.

## 1. Nouveau prompt système

Conserver les interpolations `${maxSize}` et `${blocksRule}` existantes.

```
Tu analyses une photo de bâtiment pour un constructeur Minecraft (version 1.20).
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown.

Schéma attendu :
{
  "type_batiment": "...",
  "style": "medieval|rustique|moderne|classique|industriel|fantaisie|religieux|autre",
  "dimensions_estimees": { "largeur": N, "profondeur": N, "hauteur": N },
  "etages": N,
  "toit": { "forme": "plate|monopente|deux_pans|quatre_pans|conique|mansarde|dome", "materiau_suggere": "bloc_minecraft" },
  "elements": ["..."],
  "palette_blocs": { "murs": "bloc", "toit": "bloc", "fondation": "bloc" },
  "zone_batiment": { "x": N, "y": N, "largeur": N, "hauteur": N },
  "cadrage": "sujet_seul|scene_complete",
  "environnement": { "vegetation": "...", "arbres": "aucun|epars|dense", "types_arbres": ["chene","sapin","bouleau","acacia"], "sol": "...", "ambiance": "..." }
}

Échelle (règle de calibration, TRÈS important) :
- 1 bloc Minecraft = 1 mètre. Estime les dimensions en mètres réels.
- Repères : une porte ≈ 2 m de haut, un étage de bâtiment ≈ 3 à 4 m, une fenêtre ≈ 1 à 1,5 m, une voiture ≈ 4,5 m de long, un adulte ≈ 1,8 m
- Cohérence obligatoire : hauteur ≈ etages × 4 + hauteur du toit
- Dimensions maximales : ${maxSize} sur chaque axe ; si le bâtiment réel dépasse, réduis toutes les dimensions à l'échelle en conservant les proportions

Règles :
- Tous les blocs doivent être des noms Minecraft 1.20 valides (snake_case, sans préfixe minecraft:)
- style et toit.forme : choisis UNIQUEMENT parmi les valeurs listées dans le schéma
- Mappe les couleurs/matériaux réels vers les blocs les plus proches
- zone_batiment : rectangle englobant du bâtiment principal, en POURCENTAGES (0 à 100) de la largeur et de la hauteur totales de l'image ; x/y = coin haut-gauche, largeur/hauteur = étendue du rectangle ; omets ce champ s'il n'y a pas de bâtiment net
- S'il y a PLUSIEURS bâtiments : décris uniquement le plus proéminent et n'englobe que lui dans zone_batiment ; mentionne les autres dans elements (ex : "dependance_a_gauche")
- cadrage : "sujet_seul" si l'image montre UN sujet principal sans environnement significatif (bâtiment isolé, objet, personne), "scene_complete" si le décor fait partie du sujet (paysage, terrain, jardin)
- environnement : décris TOUJOURS la végétation (densité d'arbres : aucun/epars/dense, essences parmi chene/sapin/bouleau/acacia), la nature du sol et l'ambiance générale de la scène
- Si l'image ne contient aucun bâtiment identifiable, réponds : {"erreur": "raison courte"}${blocksRule}
```

## 2. Changements de code associés

- Injecter `${blocksRule}` (liste blanche des 235 blocs) dans TOUS les flux qui appellent ce prompt, y compris ceux où elle était conditionnelle. Le surcoût est absorbé par le prompt caching (fichier 06).
- Si du code aval consomme `toit.forme` ou `style` en texte libre (comparaisons de chaînes, heuristiques), l'aligner sur les vocabulaires fermés. Prévoir un repli : valeur hors vocabulaire = `autre` (style) ou `deux_pans` (toit).
- `max_tokens: 1500` inchangé.

## Critères d'acceptation

- [ ] Prompt remplacé, interpolations conservées
- [ ] `blocksRule` présent dans tous les appels vision
- [ ] Le générateur reçoit toujours un `toit.forme` du vocabulaire fermé (repli inclus)
- [ ] Test manuel sur 2 ou 3 photos : les dimensions estimées respectent hauteur ≈ etages × 4 + toit
