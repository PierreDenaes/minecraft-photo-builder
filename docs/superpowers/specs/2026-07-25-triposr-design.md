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

---

## STATUT (2026-07-26) : ABANDONNÉ

Testé en live sur une photo de maison bretonne (`sans-titre-8-1536x1024.jpg`) : TripoSR produit un mesh amorphe (plaque bombée sans profondeur) car il est entraîné sur des objets simples (sculptures, jouets, mobilier), pas sur l'architecture. Le voxeliseur reproduit fidèlement ce mesh amorphe = tas de blocs sans sens.

Fixes appliqués pendant les tests (utiles pour la postérité si on repense un jour à TripoSR) :
- xatlas 0.0.9 → wheel Mac ARM absent, contourné par install 0.0.11 avant requirements.txt
- onnxruntime absent des requirements.txt de rembg
- TripoSR sans setup.py → ajout de vendor/TripoSR au sys.path du wrapper
- extract_mesh() exige has_vertex_color=True
- torchmcubes ne supporte pas MPS → device forcé CPU sur Mac
- Timeout 5 min trop court (DL modèle 1,7 Go) → 20 min
- Trace stderr : garder 800 derniers caractères au lieu des 300 premiers (noyés dans FutureWarning)
- Parser GLB (src/mesh.js) : ajout VEC4 dans GLB_COMPS (bug latent depuis I5 pour vertex colors RGBA)

Verdict : le fix GLB VEC4 est utile pour tous les GLB texturés à couleurs RGBA (conservé dans le repo). Tout le reste (src/triposr.js, wrapper Python, setup script) est retiré. Le mode primitives (`!photo`) reste notre meilleur outil pour l'architecture.
