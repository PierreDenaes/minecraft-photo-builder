# 02 : Comparaison photo / rendu (`src/vision.js`, `compareToPhoto`)

## Objectif

1. Remplacer le prompt système de `compareToPhoto` (jusqu'à 5 écarts au lieu de 5 imposés, catégories, format constat -> correction, exclusion du bruit de voxelisation).
2. Court-circuiter la seconde passe de génération quand la réponse est `RAS`.

## 1. Nouveau prompt système

```
Tu compares une PHOTO de référence (première image) et le RENDU voxel Minecraft généré à partir d'elle (seconde image).

Ignore les différences inhérentes au format Minecraft : pixellisation, textures des blocs, absence de courbes lisses, simplification des petits détails. Ne compare que ce qui est corrigeable à l'échelle du bloc.

Liste AU PLUS 5 écarts, uniquement les plus visibles, ceux qui empêchent de reconnaître la photo dans le rendu. Si le rendu est globalement fidèle et sans défaut de construction, réponds uniquement : RAS

Format de chaque écart : une ligne "[CATEGORIE] constat -> correction concrète"
Catégories : [SILHOUETTE] [PROPORTIONS] [TOIT] [OUVERTURES] [COULEUR] [DEFAUT]
[DEFAUT] = défaut de construction visible dans le rendu : tour ou mur incomplet, face manquante, trou non voulu, toit inachevé.

Exemples :
[TOIT] le rendu a un toit plat alors que la photo montre deux pans -> remplacer par un toit deux pans en stairs, faîtage selon l'axe long
[PROPORTIONS] le bâtiment du rendu est trop trapu -> augmenter la hauteur des murs de 3 blocs, réduire la profondeur de 4
[DEFAUT] la tour nord-est est ouverte sur sa face arrière -> fermer le cylindre sur 360 degrés

Pas de compliments, pas d'introduction, uniquement les lignes d'écart ou RAS.
```

## 2. Court-circuit RAS dans le flux `!photo`

- Après `compareToPhoto`, si la réponse nettoyée (trim, insensible à la casse) est exactement `RAS`, sauter l'étape 4 (seconde génération) et passer directement à la décoration avec la structure v1.
- Attention : les défauts mesurés par `auditHabitability` sont indépendants du comparateur. Si l'audit remonte des défauts alors que le comparateur dit RAS, déclencher quand même la passe de correction avec uniquement les défauts d'audit comme critique.
- Conserver `max_tokens: 600`.

## Critères d'acceptation

- [ ] Prompt remplacé à l'identique
- [ ] Réponse `RAS` + audit propre : la seconde génération n'est pas appelée, le décorateur reçoit la v1
- [ ] Réponse `RAS` + audit avec défauts : seconde génération appelée avec les seuls défauts d'audit
- [ ] Les lignes d'écart sont transmises telles quelles à la passe de correction (interpolation `${critique}` du fichier 01)
- [ ] Test : parsing tolérant de `RAS`, `ras`, `RAS.`, avec espaces
