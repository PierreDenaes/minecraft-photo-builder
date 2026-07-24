# 07 : Intégration de l'almanach de construction

Fichier compagnon de `almanach-construction-minecraft.md`. Objectif : brancher l'almanach dans le pipeline du bot sans exploser le budget de tokens.

## Principe : injection sélective, jamais intégrale

L'almanach fait ~1500 tokens complet. Ne JAMAIS l'injecter en entier dans un prompt. Chaque appel reçoit uniquement les sections pertinentes, choisies mécaniquement à partir de la sortie de la vision.

## Découpage en modules injectables

Créer `src/almanach.js` qui charge le fichier .md, le découpe par sections `## N` et expose :

```javascript
getSections(ids)            // ex: getSections([1, 3, 4]) -> texte concaténé
getFicheStyle(style)        // extrait la fiche du style depuis la section 5
getFicheToit(forme)         // extrait la ligne de la forme depuis la section 3
```

## Routage par appel

| Appel | Sections injectées | Déclencheur |
|---|---|---|
| Générateur (passe 1 et correction) | 1 (échelle) + fiche toit (3) + 4 (façades) + fiche style (5) + 10 (anti-patterns) | toujours ; + section 6 si "tour" dans elements ou résumé structurel |
| Vision | 1 (échelle) uniquement, déjà intégrée au prompt du fichier 03 : ne rien ajouter | jamais |
| Décorateur | 7 (intérieurs) | toujours |
| Palette assignThemes | 8 (palettes par thème), en remplacement partiel du prompt : garder la consigne JSON, injecter la section comme référentiel | toujours |
| Diorama scene_complete | 9 (terrain et abords), ajoutée au générateur | cadrage == "scene_complete" |

L'injection se fait dans le message UTILISATEUR (après la description JSON), pas dans le system : le system reste stable pour le prompt caching. Préfixer par : `Référentiel de construction (applique ces règles) :`.

## La checklist (section 11) alimente l'audit mécanique

Ne pas l'injecter dans les prompts. L'utiliser comme spécification pour étendre `auditHabitability` :
- point 2 (enveloppe) : détection de trous dans le toit déjà couverte ; ajouter la détection de pignons ouverts (colonne d'air entre deux versants).
- point 4 (ouvertures) : vérifier l'alignement vertical des colonnes de glass_pane entre étages ; écart -> défaut remonté à la passe de correction.
- point 7 (palette) : compter les matériaux distincts par façade ; < 3 -> défaut "façade trop uniforme" remonté à la passe de correction.

## Maintenance

- L'almanach est la source de vérité éditoriale : pour changer une règle de style ou de toit, modifier le .md, pas les prompts.
- Toute nouvelle fiche de style ajoutée à la section 5 doit avoir sa valeur dans le vocabulaire fermé `style` du prompt vision (fichier 03), et réciproquement. La section 5 couvre les époques de l'antiquité au futuriste (23 fiches) ; `getFicheStyle(style)` doit retourner la fiche Repli pour `autre` ou toute valeur inconnue. Ajouter un test de synchronisation : chaque valeur de l'enum du prompt vision (sauf `autre`) a une fiche dans l'almanach, et chaque fiche a sa valeur dans l'enum.
- Les blocs cités dans l'almanach doivent tous appartenir à la liste blanche des 235 blocs ; ajouter un test qui parse l'almanach et vérifie chaque nom snake_case contre la liste.

## Critères d'acceptation

- [ ] `src/almanach.js` avec découpage par sections et les 3 accesseurs
- [ ] Routage appliqué : le générateur reçoit fiche style + fiche toit + sections 1, 4, 10 (et 6/9 selon contexte)
- [ ] System prompts inchangés (cache préservé), injection côté message utilisateur
- [ ] Test : tous les blocs mentionnés dans l'almanach passent la liste blanche
- [ ] Test visuel : générer le même bâtiment avec et sans almanach, comparer la richesse des façades
