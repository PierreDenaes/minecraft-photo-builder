# Design : Itération 18 — Schemas comme base de connaissances (RAG architectural)

Date : 2026-07-26 — Base : main après I17 (schemas comme fragments à coller)

## Origine

Pierre après I17 : « les schemas doivent servir de base de connaissance afin de reproduire une image ». Le mode I17 collait le schema tel quel → le résultat = le schema, pas la photo. Nouveau mode : les schemas nourrissent le LLM en exemples réels, il compose une construction fidèle à la photo en s'inspirant des schemas du même style.

## Changement de sémantique

- **Avant I18** : `!schema` = coller UN schema (fragment brut du catalogue)
- **Après I18** : `!schema` = générer avec primitives EN S'INSPIRANT de 2-3 schemas proches

L'ancien mode disparaît (fusion, pas de nouvelle commande) ; `!photo` reste comme fallback quand aucun schema du catalogue ne correspond.

## Nouveau pipeline

```
photo → analyzeImage (vision, comme avant)
      → chooseSchemas(description, n=3) → 3 schemas les plus proches
      → analyzeSchemas([...]) → agrégat de stats architecturales
      → generateStructure(description, { mode: 'primitives', inspiration: agrégat })
      → passes physiques et audit (comme avant)
      → decorateInterior
      → proposeStructure
```

## Modules

### `src/schemas.js` étendus
- `chooseSchemas(description, n=3)` — retourne un ARRAY (pas un seul) trié par pertinence
- `analyzeSchema(entry)` — extrait pour UN schema :
  - `proportions` : { largeur, profondeur, hauteur, ratio_h_l }
  - `materiaux_par_zone` : { fondation (tranche basse 0-2), murs (tranche 3-h*0.7), toit (tranche h*0.7-h) — top 3 matériaux par zone avec %
  - `ratios` : stairs, glass, torches (déjà extraits)
  - `signatures` : tags manuels du catalogue (colombages/vitrage/etc.)

### `src/generator.js`
- `generateStructure(description, { mode: 'primitives', inspiration })` — nouveau paramètre optionnel
- Si `inspiration` fourni : injecte dans le message utilisateur un bloc formaté "Exemples de vrais bâtiments à imiter" avec les 3 agrégats
- Prompt inchangé (les exemples sont juste des données de plus dans le user msg)

### `src/index.js`
- `onSchema` remplacé : analyzeImage → chooseSchemas(n=3) → analyzeSchemas → generateStructure(inspiration=...) → suite classique (décoration, audit, propose)
- Fallback : si `chooseSchemas` retourne [], on bascule sur `onPhoto` avec un message

## Format d'inspiration passé au LLM

```
Inspiration : 3 vrais bâtiments du même style :

[1] Manoir rustique (35×60×29)
  Fondation : granite (60%), stone_bricks (30%)
  Murs : jungle_planks (40%), stripped_jungle_wood (35%), granite (15%)
  Toit : brown_mushroom_block (55%), spruce_stairs (25%)
  Ratios : 8% stairs, 0% glass, présence de colombages verticaux
  
[2] ... 
[3] ...
```

## Tests attendus

- `chooseSchemas` : retourne 1-3 schemas triés par proximité (style exact > type exact > proche)
- `analyzeSchema` : découpe par tranches y (fondation/murs/toit) et retourne matériaux dominants par zone
- Intégration : `generateStructure({ mode:'primitives', inspiration })` injecte les exemples dans le user msg
- Régression : sans `inspiration`, comportement inchangé

## Ce qui NE change pas
- Le LLM continue à composer avec les primitives (boite, porte, baie, toit, escalier, piscine...)
- Aucun bloc du schema n'est copié
- Les passes physiques, l'audit, la décoration restent identiques

## Hors périmètre
- Extraction fine de sous-structures (« ce mur + ces colombages ») — voie B du brainstorming, trop lourd
- Statistiques agrégées inter-schemas — voie C, on prend les 3 individuellement
