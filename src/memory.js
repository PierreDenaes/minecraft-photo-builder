const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

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

async function saveCase({ photo, description, code }) {
  __ensureDirs();
  const id = __generateId();
  // miniature 256px max côté long
  const thumbBuf = await sharp(photo).resize({ width: 256, height: 256, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  fs.writeFileSync(path.join(CASES_DIR, `${id}.jpg`), thumbBuf);
  // embedding (calculé sur la miniature pour cohérence et rapidité)
  const emb = await __embed(thumbBuf);
  fs.writeFileSync(path.join(CASES_DIR, `${id}.emb`), Buffer.from(emb.buffer));
  // json
  const caseObj = {
    id,
    date: new Date().toISOString(),
    style: description.style || 'autre',
    type_batiment: description.type_batiment || 'inconnu',
    description,
    code,
    note: null
  };
  fs.writeFileSync(path.join(CASES_DIR, `${id}.json`), JSON.stringify(caseObj, null, 2));
  // index (créé si absent)
  const index = fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : [];
  index.push({ id, date: caseObj.date, style: caseObj.style, type_batiment: caseObj.type_batiment, note: null });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  return id;
}

module.exports = { CASES_DIR, INDEX_PATH, __ensureDirs, __generateId, warmup, __setEmbedder, __isReady, __embed, saveCase };
