# 05 : Palette (`src/palette.js`)

## Objectif

1. Donner du contexte de scène à `assignThemes` (le RGB seul est ambigu : un brun peut être bois, terre ou brique).
2. Passer cet appel sur un modèle plus léger (Haiku) : tâche de classification, qualité quasi identique, latence et coût réduits.
3. Déprécier proprement `assignBlocks`.

## 1. assignThemes : prompt système

Remplacer par :

```
Tu es un maître bâtisseur Minecraft. Pour chaque couleur dominante RGB d'une scène, identifie LA MATIÈRE représentée et choisis son thème : roche (falaises, pierre brute), terre (sols, chemins), vegetation (herbe, feuillages), bois (charpentes, troncs), maconnerie (murs bâtis, briques), sable, neige_glace, eau, couleurs_vives (enduits, toits colorés, objets peints), metal.
Utilise le contexte de scène fourni pour lever les ambiguïtés : un brun peut être du bois, de la terre ou de la brique selon la scène ; la position verticale aide (le haut d'une image est plutôt toit/ciel/feuillage, le bas plutôt sol).
Réponds UNIQUEMENT en JSON strict : [{"rgb":[r,g,b],"theme":"nom"}], dans le même ordre que les couleurs fournies.
```

## 2. assignThemes : message utilisateur

Enrichir le message utilisateur avec, quand disponibles :

- Le contexte de scène issu de la vision : `type_batiment`, `environnement.vegetation`, `environnement.sol`, `environnement.ambiance`. Format simple : `Scène : ${type_batiment}, sol ${sol}, végétation ${vegetation}, ambiance ${ambiance}.`
- Pour chaque couleur, si l'extraction de palette peut le fournir à faible coût, la zone verticale dominante : `[r,g,b] (zone: haut|milieu|bas)`. Si l'info n'est pas disponible dans le pipeline actuel, ne pas la fabriquer : envoyer les RGB nus, le contexte de scène apporte déjà l'essentiel.

Dans le flux `!diorama` modèle 3D (pas de vision en amont de la palette), envoyer `Scène : modèle 3D scanné, contexte inconnu.`

## 3. Modèle

- Passer l'appel `assignThemes` sur `claude-haiku-4-5-20251001`. `max_tokens: 600` inchangé. Température 0 (fichier 06).
- Conserver le repli déterministe plus-proche-voisin existant en cas d'échec ou de JSON invalide.

## 4. Dépréciation de assignBlocks

- Marquer la fonction `@deprecated` avec un commentaire renvoyant vers `assignThemes`.
- Vérifier qu'aucun chemin de code ne l'appelle encore. Si c'est le cas : la retirer de l'export. Sinon, la laisser en place mais logguer un warning si elle est appelée.

## Critères d'acceptation

- [ ] Prompt et message utilisateur enrichis
- [ ] Appel sur Haiku, repli plus-proche-voisin intact
- [ ] `assignBlocks` dépréciée, aucun appel restant dans le pipeline
- [ ] Test manuel : sur une photo de maison en briques, les bruns des murs partent en maconnerie et non en terre
