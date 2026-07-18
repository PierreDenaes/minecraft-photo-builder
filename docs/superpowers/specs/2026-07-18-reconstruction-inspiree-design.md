# Design : Itération 4 — Reconstruction inspirée et intégration harmonieuse

Date : 2026-07-18
Statut : validé
Base : itération 3 mergée (sous-sol procédural, remplissage géologique)

## Philosophie (demande de Pierre, verbatim résumé)

« Le plus naturel possible ; les modèles doivent servir de modèles ; l'IA doit compenser avec logique et s'en inspirer pour être au plus proche, tout en étant ancrée dans la réalité de Minecraft. » Le scan/la photo devient une RÉFÉRENCE : l'IA reconstruit en vocabulaire Minecraft natif (murs droits, créneaux, arches, proportions saines) au lieu de copier le bruit du mesh. Le terrain reste piloté par les données, mais raccordé au monde.

## Décisions

1. **Nettoyage des scans (mesh)** : suppression des composantes déconnectées mineures (< 3 % des triangles, éloignées du barycentre), puis cadrage de la boîte sur le 2-98e percentile des positions par axe → les débris flottants des modèles IA n'étirent plus la boîte (cause du château écrasé sur 120 de haut).
2. **Analyse structurelle** : depuis les voxels du modèle nettoyé, produire un résumé compact : dimensions, carte de hauteurs 16×12, masque d'emprise 16×12, tours détectées (colonnes hautes groupées : position/rayon/hauteur), thèmes dominants. JSON < 2 Ko.
3. **Reconstruction par l'IA (mode par défaut)** : le générateur LLM existant reçoit le résumé structurel (+ description vision pour les photos) avec un prompt « architecte Minecraft » : respecter les masses (emprise/hauteurs/tours), construire propre et jouable (murs pleins, créneaux, portes, fenêtres, intérieurs creux). Sortie = generateStructure() sandboxé, palette matériaux, validation existante.
4. **Terrain harmonieux** :
   - Ancrage au sol : origine y = niveau du sol devant le joueur (scan du premier bloc solide via bot.blockAt), plus jamais la position de vol.
   - Jupe de raccord : bande de 12 blocs autour de l'emprise, interpolation linéaire de la hauteur du bord du terrain généré vers le sol du monde, même thème de surface, strates dessous.
5. **Lisibilité** : après construction, annonce des coordonnées (coins + centre) dans le chat.
6. **Mode brut conservé** : `reconstruction: "inspire"` (défaut) | `"brut"` dans config.json — le mode brut garde l'ancien pipeline voxel intégral.

## Interfaces nouvelles

| Module | Interface |
|---|---|
| `src/meshclean.js` | `cleanTriangles(triangles) → { triangles, removed }` (composantes connexes par sommets partagés arrondis, retrait < 3 % éloignés, crop percentile 2-98) |
| `src/structure-analysis.js` | `analyzeStructure(blocks, { gridX = 16, gridZ = 12 }) → { dims, heightmap, footprint, towers, themes }` |
| `src/generator.js` (étendu) | `generateStructure(description, { …, structuralSummary })` — le résumé est injecté dans le prompt utilisateur |
| `src/builder.js` (étendu) | `groundLevelAt(pos) → y` (premier bloc solide sous pos via bot.blockAt) ; `computeOrigin` ancre y dessus ; `skirtCommands(origin, size, groundY, heightsAtEdge)` pour la jupe |
| `src/chat.js` (étendu) | après lancement : message coordonnées « Construction de (x1,z1) à (x2,z2), centre (cx,cz) » |
| `config.json` | `"reconstruction": "inspire"` |

## Flux modèle 3D (mode inspire)

```
GLB/OBJ/STL → parseModel → cleanTriangles → voxelizeMesh (solide géologique, thèmes)
     → analyzeStructure → LLM architecte (résumé + palette matériaux) → bâtiment propre
     → terrain : socle géologique du modèle nettoyé SOUS le bâtiment (jupe de raccord)
     → validation → build (ancré au sol, coordonnées annoncées)
```
Flux photo diorama : inchangé sauf jupe + ancrage + annonce ; le bâtiment incrusté profite du même prompt architecte (résumé issu de la zone bbox).

## Tests

meshclean : composant déconnecté retiré, crop percentile (débris flottant → boîte resserrée) ; analysis : heightmap/tours sur structures synthétiques (deux piliers → 2 tours) ; generator : résumé injecté dans le prompt (client fake) ; builder : groundLevelAt (fake blockAt), skirt (pente linéaire attendue) ; chat : message coordonnées ; e2e étendu.

## Hors périmètre

Biomes, végétation procédurale (arbres), intérieur meublé, cohérence de graine entre uploads.
