const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Wrapper subprocess autour de TripoSR : photo → GLB texturé.
// TripoSR est installé sous vendor/TripoSR/ par scripts/setup-triposr.sh.
// Le wrapper Python est scripts/triposr_wrapper.py — il charge le modèle,
// fait l'inférence et écrit <output_dir>/0/mesh.glb.

const DEFAULT_SCRIPT = path.join(__dirname, '..', 'scripts', 'triposr_wrapper.py');
const DEFAULT_PYTHON = path.join(__dirname, '..', 'vendor', 'TripoSR', 'venv', 'bin', 'python3');
const DEFAULT_TIMEOUT_MS = 300000; // 5 min

function ensureTmp() {
  const dir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function reconstruct3D(imageBuffer, imageExt, {
  scriptPath = DEFAULT_SCRIPT,
  pythonBin = DEFAULT_PYTHON,
  pythonArgs,
  outputDir,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  skipScriptCheck = false
} = {}) {
  if (!skipScriptCheck && !fs.existsSync(scriptPath)) {
    throw new Error(`TripoSR non installé (script Python introuvable : ${scriptPath}). Lance : bash scripts/setup-triposr.sh`);
  }
  const tmp = ensureTmp();
  const stamp = `${process.pid}-${Date.now()}`;
  const imagePath = path.join(tmp, `triposr-in-${stamp}.${imageExt}`);
  const outDir = outputDir || path.join(tmp, `triposr-out-${stamp}`);
  fs.writeFileSync(imagePath, imageBuffer);
  fs.mkdirSync(outDir, { recursive: true });

  const args = pythonArgs || [scriptPath, imagePath, outDir];
  const proc = spawn(pythonBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const done = new Promise((resolve, reject) => {
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`TripoSR : timeout expiré (${timeoutMs}ms)`));
      }, timeoutMs);
    }
    proc.on('error', (err) => { if (timer) clearTimeout(timer); reject(new Error(`TripoSR : échec de spawn (${err.message})`)); });
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) return reject(new Error(`TripoSR : subprocess Python échoué (code ${code}) — ${stderr.slice(0, 300)}`));
      resolve();
    });
  });

  try {
    await done;
    const glbPath = path.join(outDir, '0', 'mesh.glb');
    if (!fs.existsSync(glbPath)) {
      throw new Error(`TripoSR : subprocess terminé mais mesh.glb absent (${glbPath})`);
    }
    return fs.readFileSync(glbPath);
  } finally {
    // nettoyage best-effort
    try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
    if (!outputDir) {
      try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

module.exports = { reconstruct3D };
