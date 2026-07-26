#!/usr/bin/env python3
"""TripoSR inference wrapper — appelé par src/triposr.js.

Args :
    sys.argv[1] = chemin vers l'image d'entrée (jpg/png/webp)
    sys.argv[2] = dossier de sortie ; le mesh est écrit à <output_dir>/0/mesh.glb

Le script suppose que TripoSR est installé dans vendor/TripoSR (voir
scripts/setup-triposr.sh). Il exécute un pipeline standard :
1. rembg pour retirer le fond de la photo
2. TripoSR pour reconstruire le mesh 3D
3. Export en GLB texturé
"""

import sys
import os
from pathlib import Path

# TripoSR n'a pas de setup.py ; le module `tsr` vit dans vendor/TripoSR/tsr.
# Ajoute ce chemin au sys.path pour que l'import fonctionne peu importe le cwd.
_ROOT = Path(__file__).resolve().parent.parent
_TRIPOSR_DIR = _ROOT / "vendor" / "TripoSR"
if _TRIPOSR_DIR.exists():
    sys.path.insert(0, str(_TRIPOSR_DIR))


def die(msg):
    print(f"[triposr_wrapper] {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) < 3:
        die("usage : triposr_wrapper.py <image_path> <output_dir>")
    image_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    if not image_path.exists():
        die(f"image introuvable : {image_path}")
    output_dir.mkdir(parents=True, exist_ok=True)

    # Import différés (permet à --help ou aux checks légers de passer sans deps)
    try:
        import numpy as np
        import rembg
        import torch
        from PIL import Image
        from tsr.system import TSR
        from tsr.utils import remove_background, resize_foreground
    except ImportError as e:
        die(f"dépendance manquante ({e}) — active le venv vendor/TripoSR/venv "
            "et vérifie que scripts/setup-triposr.sh a bien tourné")

    # MPS (Apple Silicon) ne supporte pas marching_cubes dans torchmcubes → CPU
    # sur Mac. CUDA reste préféré si dispo (Linux/Windows).
    device = "cuda" if torch.cuda.is_available() else "cpu"

    model = TSR.from_pretrained(
        "stabilityai/TripoSR",
        config_name="config.yaml",
        weight_name="model.ckpt"
    )
    model.renderer.set_chunk_size(8192)
    model.to(device)

    # Préparation image : détourage + redimensionnement
    rembg_session = rembg.new_session()
    image = Image.open(image_path).convert("RGB")
    image = remove_background(image, rembg_session)
    image = resize_foreground(image, 0.85)
    image = np.array(image).astype(np.float32) / 255.0
    image = image[:, :, :3] * image[:, :, 3:4] + (1 - image[:, :, 3:4]) * 0.5
    image = Image.fromarray((image * 255.0).astype(np.uint8))

    # Inférence
    with torch.no_grad():
        scene_codes = model([image], device=device)
    meshes = model.extract_mesh(scene_codes, has_vertex_color=True, resolution=256)

    sub = output_dir / "0"
    sub.mkdir(parents=True, exist_ok=True)
    meshes[0].export(str(sub / "mesh.glb"))
    print(f"[triposr_wrapper] mesh écrit : {sub / 'mesh.glb'}", file=sys.stderr)


if __name__ == "__main__":
    main()
