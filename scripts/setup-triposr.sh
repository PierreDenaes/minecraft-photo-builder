#!/usr/bin/env bash
# Setup TripoSR pour la commande !maison — Reconstruction 3D locale depuis une photo.
# Usage : bash scripts/setup-triposr.sh
#
# Ce que fait ce script :
# 1. Vérifie Python 3.10+ et git
# 2. Clone github.com/VAST-AI-Research/TripoSR dans vendor/TripoSR/
# 3. Crée un venv et installe les dépendances Python
# 4. Télécharge le modèle depuis HuggingFace (~2 Go la première fois)
# 5. Test rapide sur une image fixture
#
# Prérequis :
# - Python 3.10 ou 3.11 (3.14 n'est PAS supporté par PyTorch — bascule vers 3.11 avec pyenv/homebrew si besoin)
# - git, ~5 Go d'espace disque, ~10 min pour l'install initiale

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/TripoSR"
VENV="$VENDOR/venv"

echo "[setup-triposr] racine projet : $ROOT"

# 1. Python check
PYBIN="${PYTHON:-python3.11}"
if ! command -v "$PYBIN" >/dev/null 2>&1; then
  PYBIN="python3.10"
  command -v "$PYBIN" >/dev/null 2>&1 || {
    echo "[setup-triposr] ERREUR : Python 3.10 ou 3.11 requis (pas trouvé)."
    echo "  brew install python@3.11    # macOS"
    echo "  ou : pyenv install 3.11.10 && pyenv local 3.11.10"
    exit 1
  }
fi
echo "[setup-triposr] Python : $($PYBIN --version)"

# 2. git check
command -v git >/dev/null 2>&1 || { echo "[setup-triposr] ERREUR : git requis"; exit 1; }

# 3. Clone TripoSR
mkdir -p "$ROOT/vendor"
if [ ! -d "$VENDOR/.git" ]; then
  echo "[setup-triposr] clone TripoSR..."
  git clone https://github.com/VAST-AI-Research/TripoSR.git "$VENDOR"
else
  echo "[setup-triposr] TripoSR déjà cloné"
fi

# 4. Venv + deps
if [ ! -d "$VENV" ]; then
  echo "[setup-triposr] création venv..."
  "$PYBIN" -m venv "$VENV"
fi

echo "[setup-triposr] installation deps (peut prendre 5-10 min)..."
"$VENV/bin/pip" install --upgrade pip wheel setuptools
"$VENV/bin/pip" install torch torchvision --index-url https://download.pytorch.org/whl/cpu
"$VENV/bin/pip" install -r "$VENDOR/requirements.txt"

# 5. Test rapide (import seulement, pas d'inférence)
"$VENV/bin/python" -c "from tsr.system import TSR; print('[setup-triposr] TripoSR importable')" || {
  echo "[setup-triposr] ERREUR : import TSR échoué. Vérifie les logs pip ci-dessus."
  exit 1
}

echo ""
echo "[setup-triposr] ✓ Setup terminé."
echo "  Le premier appel !maison téléchargera le modèle (~2 Go) depuis HuggingFace."
echo "  Reconstruction : 30 s à 2 min par photo sur Mac Apple Silicon (CPU/MPS)."
