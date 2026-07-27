const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', 'data', 'memoire');
const CASES_DIR = path.join(ROOT, 'cases');
const INDEX_PATH = path.join(ROOT, 'index.json');

let embedder = null;  // fonction (buffer) → Promise<Float32Array>

function __setEmbedder(fn) { embedder = fn; }
function __isReady() { return embedder !== null; }

async function __embed(buffer) {
  if (!embedder) throw new Error('embedder non disponible');
  return embedder(buffer);
}

async function warmup() {
  try {
    const { pipeline } = require('@xenova/transformers');
    const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
    embedder = async (buffer) => {
      const result = await extractor(buffer, { pooling: 'mean', normalize: true });
      return new Float32Array(result.data);
    };
    console.log('[memory] CLIP prêt');
  } catch (err) {
    console.warn('[memory] CLIP indispo :', err.message);
  }
}

function __ensureDirs() {
  fs.mkdirSync(CASES_DIR, { recursive: true });
}

function __generateId() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(2).toString('hex');
  return `${date}-${rand}`;
}

module.exports = { CASES_DIR, INDEX_PATH, __ensureDirs, __generateId, warmup, __setEmbedder, __isReady, __embed };
