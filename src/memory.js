const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', 'data', 'memoire');
const CASES_DIR = path.join(ROOT, 'cases');
const INDEX_PATH = path.join(ROOT, 'index.json');

function __ensureDirs() {
  fs.mkdirSync(CASES_DIR, { recursive: true });
}

function __generateId() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(2).toString('hex');
  return `${date}-${rand}`;
}

module.exports = { CASES_DIR, INDEX_PATH, __ensureDirs, __generateId };
