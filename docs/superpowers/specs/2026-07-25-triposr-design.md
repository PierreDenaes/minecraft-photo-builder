# Design : Itération 16 — Commande !maison via TripoSR

Date : 2026-07-25 — Base : main après I15 (primitives, layouts, convention MC)

## Origine

Pierre : « on part sur TripoSR ». Après 5 itérations de correctifs sur le mode primitives (bâtiments cohérents mais fidélité photo médiocre), le plafond est structurel : un LLM ne raisonne pas dans l'espace 3D. La voie TripoSR sort de ce plafond en transformant la photo en vrai modèle 3D voxelisé.

## Choix validés par Pierre

1. **Nouvelle commande `!maison`** (pas de remplacement de `!photo`). Le mode primitives reste pour les scènes complexes ; `!maison` sert quand on veut la reproduction fidèle d'un objet ou d'un petit bâtiment.
2. **Setup TripoSR documenté** dans `scripts/setup-triposr.sh` + README. Vérifications automatiques (Python, pip, GPU dispo, modèle téléchargé). Pas d'auto-install pour ne pas polluer.
3. **Fallback explicite** : si TripoSR n'est pas trouvé, message d'erreur clair (« TripoSR non installé — voir scripts/setup-triposr.sh »), pas de bascule silencieuse.

## Architecture

```
!maison → upload photo
       ↓
       src/triposr.js
         → spawn python3 -m tsr.run photo.png --output-dir tmp/
         → attend le fichier tmp/0/mesh.glb (timeout 5 min)
         → renvoie le buffer GLB
       ↓
       parseModel (existant, src/mesh.js)
       ↓
       vision LLM sur la photo pour palette/style (facultatif — améliore rendu)
       ↓
       voxelizeMesh (existant, avec palette de la vision)
       ↓
       enforceSupport (gravité)
       ↓
       decorateInterior (layouts existants)
       ↓
       proposeStructure
```

## Composants

### `src/triposr.js` (nouveau)
- `async function reconstruct3D(imageBuffer, imageExt) → GLB buffer`
- Écrit l'image dans `tmp/triposr-<pid>-<ts>.png`
- Spawn `python3 <PYTHON_SCRIPT> <image_path> <output_dir>` avec timeout 300 s
- Attend `<output_dir>/0/mesh.glb`, le lit, le retourne
- Nettoie les fichiers temporaires
- Lève une erreur explicite si Python absent, TripoSR absent, ou timeout

### `scripts/setup-triposr.sh` (nouveau)
- Vérifie Python 3.10+
- Clone `github.com/VAST-AI-Research/TripoSR` dans `vendor/TripoSR/`
- Crée un venv `vendor/TripoSR/venv`
- `pip install -r requirements.txt` + torch
- Télécharge le modèle depuis HuggingFace
- Test rapide sur une image fixture

### `scripts/triposr_wrapper.py` (nouveau)
- Petit script CLI qui charge TripoSR et fait l'inférence
- Args : `<image_path> <output_dir>`
- Sortie : GLB écrit dans `<output_dir>/0/mesh.glb`

### `src/webserver.js` (modif)
- Nouveau mode allowlist : `['diorama', 'statue', 'portrait', 'maison']`
- Routage : mode maison → `onMaison(username, buffer, mimeType)`

### `src/index.js` (modif)
- Nouvelle fonction `onMaison` qui enchaîne : reconstruct3D → parseModel → vision (palette) → voxelizeMesh → enforceSupport → decorateInterior → proposeStructure
- Timeout global 6 min (5 min TripoSR + 1 min pipeline)
- Erreur TripoSR remontée dans le chat avec le message d'installation

### `src/chat.js` (modif)
- Nouvelle commande `!maison` → affiche le lien d'upload avec mode=maison

### `README.md` (modif)
- Section « Reconstruction 3D locale (TripoSR) » — prérequis + `bash scripts/setup-triposr.sh`

## Tests attendus

- `src/triposr.js` : mock du subprocess retournant un GLB fixture ; test du timeout ; test de l'erreur « TripoSR non installé » ; test du nettoyage tmp
- `src/webserver.js` : mode `maison` accepté, mode `xxx` refusé
- `src/chat.js` : `!maison` déclenche l'affichage du lien avec mode=maison
- Régression : `!photo`, `!diorama`, `!statue`, `!portrait` intacts

## Hors périmètre

- Fine-tuning TripoSR (on prend le modèle stock)
- Reconstruction multi-vues (une seule photo par appel)
- Automatique fallback vers primitives (choix Pierre : erreur explicite)

## Livrable

Sur Pierre : lance `bash scripts/setup-triposr.sh`, patiente ~10 min (téléchargement modèle + install torch), puis teste `!maison` sur une photo — 30 s à 2 min de reconstruction, résultat fidèle à la photo.
