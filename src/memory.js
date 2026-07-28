const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

let _root = path.join(__dirname, '..', 'data', 'memoire');
let _casesDir = path.join(_root, 'cases');
let _indexPath = path.join(_root, 'index.json');

// Getters dynamiques utilisés par toutes les fonctions internes
function getCasesDir() { return _casesDir; }
function getIndexPath() { return _indexPath; }

// Pour les tests : rereoute tous les chemins vers un répertoire temporaire
function __setRootDir(dir) {
  _root = dir;
  _casesDir = path.join(dir, 'cases');
  _indexPath = path.join(dir, 'index.json');
}

let embedder = null;  // fonction (buffer) → Promise<Float32Array>

function __setEmbedder(fn) { embedder = fn; }
function __isReady() { return embedder !== null; }

async function __embed(buffer) {
  if (!embedder) throw new Error('embedder non disponible');
  return embedder(buffer);
}

let warmupPromise = null;
async function warmup() {
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    try {
      const { pipeline } = require('@xenova/transformers');
      const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
      embedder = async (buffer) => {
        const result = await extractor(buffer, { pooling: 'mean', normalize: true });
        return new Float32Array(result.data);
      };
      console.log('[memory] CLIP prêt');
    } catch (err) {
      warmupPromise = null;
      console.warn('[memory] CLIP indispo :', err.message);
    }
  })();
  return warmupPromise;
}

function __ensureDirs() {
  fs.mkdirSync(getCasesDir(), { recursive: true });
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
  const casesDir = getCasesDir();
  const indexPath = getIndexPath();
  // json d'abord : c'est la donnée maîtresse (un .jpg orphelin est bénin,
  // un .json orphelin ne l'est pas)
  const caseObj = {
    id,
    date: new Date().toISOString(),
    style: description.style || 'autre',
    type_batiment: description.type_batiment || 'inconnu',
    description,
    code,
    note: null
  };
  fs.writeFileSync(path.join(casesDir, `${id}.json`), JSON.stringify(caseObj, null, 2));
  // miniature 256px max côté long
  const thumbBuf = await sharp(photo).resize({ width: 256, height: 256, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  fs.writeFileSync(path.join(casesDir, `${id}.jpg`), thumbBuf);
  // embedding OPTIONNEL : sans CLIP (macOS ARM64, warmup désactivé), le cas est
  // quand même mémorisé — findSimilar utilise alors le fallback métadonnées,
  // et loadEmbedding retourne null pour ce cas en mode CLIP
  if (__isReady()) {
    const emb = await __embed(thumbBuf);
    fs.writeFileSync(path.join(casesDir, `${id}.emb`), Buffer.from(emb.buffer));
  }
  // index (créé si absent)
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
  index.push({ id, date: caseObj.date, style: caseObj.style, type_batiment: caseObj.type_batiment, note: null });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return id;
}

function updateNote(id, note) {
  if (!Number.isInteger(note) || note < 1 || note > 5) {
    console.warn(`[memory] note invalide (${note}), ignorée`);
    return false;
  }
  const casePath = path.join(getCasesDir(), `${id}.json`);
  if (!fs.existsSync(casePath)) {
    console.warn(`[memory] cas ${id} introuvable, note ignorée`);
    return false;
  }
  const caseObj = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  caseObj.note = note;
  fs.writeFileSync(casePath, JSON.stringify(caseObj, null, 2));
  const indexPath = getIndexPath();
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const entry = index.find((e) => e.id === id);
    if (entry) entry.note = note;
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }
  return true;
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
  const indexPath = getIndexPath();
  return fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
}

function loadCase(id) {
  const p = path.join(getCasesDir(), `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function loadEmbedding(id) {
  const p = path.join(getCasesDir(), `${id}.emb`);
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
    // style strict, type assoupli : égalité OU inclusion croisée des textes libres
    const typeMatch = (a, b) => {
      if (!a || !b) return false;
      const ta = String(a).toLowerCase();
      const tb = String(b).toLowerCase();
      return ta === tb || ta.includes(tb) || tb.includes(ta);
    };
    return eligible
      .filter((e) => e.style === description.style && typeMatch(e.type_batiment, description.type_batiment))
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

const _exports = { __ensureDirs, __generateId, __setRootDir, warmup, __setEmbedder, __isReady, __embed, saveCase, updateNote, findSimilar };
// CASES_DIR et INDEX_PATH exposés comme getters dynamiques pour que les tests
// qui reroutent via __setRootDir voient les nouveaux chemins sans réimporter
Object.defineProperty(_exports, 'CASES_DIR', { get: getCasesDir, enumerable: true });
Object.defineProperty(_exports, 'INDEX_PATH', { get: getIndexPath, enumerable: true });
module.exports = _exports;
