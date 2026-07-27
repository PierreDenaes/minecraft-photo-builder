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

function updateNote(id, note) {
  if (!Number.isInteger(note) || note < 1 || note > 5) {
    console.warn(`[memory] note invalide (${note}), ignorée`);
    return;
  }
  const casePath = path.join(CASES_DIR, `${id}.json`);
  if (!fs.existsSync(casePath)) {
    console.warn(`[memory] cas ${id} introuvable, note ignorée`);
    return;
  }
  const caseObj = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  caseObj.note = note;
  fs.writeFileSync(casePath, JSON.stringify(caseObj, null, 2));
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const entry = index.find((e) => e.id === id);
  if (entry) entry.note = note;
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function loadIndex() {
  return fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : [];
}

function loadCase(id) {
  const p = path.join(CASES_DIR, `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function loadEmbedding(id) {
  const p = path.join(CASES_DIR, `${id}.emb`);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

async function findSimilar(photo, description, opts = {}) {
  const { n = 3, minNote = 3, minSimilarity = 0.5 } = opts;
  const index = loadIndex();
  const eligible = index.filter((e) => e.note != null && e.note >= minNote);
  if (eligible.length === 0) return [];
  if (!__isReady()) {
    // fallback métadonnées : filtre style+type, tri note desc
    return eligible
      .filter((e) => e.style === description.style && e.type_batiment === description.type_batiment)
      .sort((a, b) => b.note - a.note)
      .slice(0, n)
      .map((e) => {
        const c = loadCase(e.id);
        return { id: e.id, similarity: 0, note: e.note, description: c.description, code: c.code };
      });
  }
  // mode CLIP : embed la nouvelle photo (miniature pour cohérence)
  const thumb = await sharp(photo).resize({ width: 256, height: 256, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  const targetEmb = await __embed(thumb);
  const scored = [];
  for (const e of eligible) {
    const emb = loadEmbedding(e.id);
    if (!emb) continue;
    const sim = cosineSimilarity(targetEmb, emb);
    if (sim < minSimilarity) continue;
    const c = loadCase(e.id);
    if (!c) continue;
    scored.push({ id: e.id, similarity: sim, note: e.note, description: c.description, code: c.code });
  }
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, n);
}

module.exports = { CASES_DIR, INDEX_PATH, __ensureDirs, __generateId, warmup, __setEmbedder, __isReady, __embed, saveCase, updateNote, findSimilar };
