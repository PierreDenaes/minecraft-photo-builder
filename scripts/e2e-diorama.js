// Bot-joueur automatisé : déroule le protocole e2e diorama + modèle 3D (Task 13)
// Adapté de scripts/e2e-driver.js — mêmes conventions exactes
const fs = require('node:fs');
const path = require('node:path');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');

const USERNAME = 'Pierre_Test';
const results = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const record = (name, ok, detail = '') => { results.push({ name, ok }); log(ok ? 'PASS' : 'FAIL', '—', name, detail); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bot = mineflayer.createBot({ host: 'localhost', port: 25565, username: USERNAME, version: '1.20.4', auth: 'offline' });

const listeners = [];
bot.on('chat', (u, m) => {
  if (u === USERNAME) return;
  log(`  <${u}> ${m}`);
  for (const l of [...listeners]) {
    if (l.rx.test(m)) {
      listeners.splice(listeners.indexOf(l), 1);
      clearTimeout(l.timer);
      l.resolve(m);
    }
  }
});

function waitMsg(rx, ms, label) {
  return new Promise((resolve, reject) => {
    const l = { rx, resolve };
    l.timer = setTimeout(() => {
      listeners.splice(listeners.indexOf(l), 1);
      reject(new Error(`timeout (${ms} ms) en attendant : ${label || rx}`));
    }, ms);
    listeners.push(l);
  });
}

function send(m) { log(`  > ${m}`); bot.chat(m); }

async function upload(file, mime, fields = {}) {
  const fd = new FormData();
  fd.append('username', USERNAME);
  // Extra fields (e.g. mode=diorama) appended before the file
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('photo', new Blob([fs.readFileSync(file)], { type: mime }), path.basename(file));
  const res = await fetch('http://localhost:3000/build-from-photo', { method: 'POST', body: fd });
  const body = await res.json().catch(() => ({}));
  log('  HTTP', res.status, JSON.stringify(body).slice(0, 160));
  return { status: res.status, body };
}

function scanRegion(x1, x2, y1, y2, z1, z2) {
  let solid = 0, unloaded = 0;
  const samples = new Set();
  for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (!b) { unloaded++; continue; }
    if (b.name !== 'air') { solid++; if (samples.size < 8) samples.add(b.name); }
  }
  return { solid, unloaded, samples: [...samples] };
}

async function pollStatusUntilDone(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    send('!status');
    const m = await waitMsg(/Avancement|Aucune construction/, 8000, 'réponse !status');
    if (/\(terminé\)|Aucune construction/.test(m)) return m;
    await sleep(5000);
  }
  throw new Error('timeout construction');
}

async function main() {
  await new Promise((r) => bot.once('spawn', r));
  await sleep(2000);

  const p0 = bot.entity.position.clone();
  const px = Math.floor(p0.x), py = Math.floor(p0.y), pz = Math.floor(p0.z);
  log(`  position joueur : ${px} ${py} ${pz}`);

  // ── Étape (a) : !diorama → lien avec ?mode=diorama ──────────────────────────
  const linkP = waitMsg(/upload\/Pierre_Test\?mode=diorama/, 10000, 'lien !diorama');
  send('!diorama');
  const linkMsg = await linkP;
  record('!diorama renvoie le lien ?mode=diorama', /upload\/Pierre_Test\?mode=diorama/.test(linkMsg), linkMsg);

  // ── Étape (b) : upload cube.obj → proposition "modèle 3D (obj)" ─────────────
  // CRITIQUE : enregistrer l'écouteur AVANT l'upload (la proposition arrive pendant la requête HTTP)
  const modelP = waitMsg(/Tape !go|erreur est survenue|structure invalide|analyse impossible/, 120000, 'proposition modèle 3D');
  const upModel = await upload(path.join(__dirname, '../test/fixtures/cube.obj'), 'application/octet-stream');
  const propM = await modelP;
  record('HTTP upload modèle OK', upModel.status === 200, `status=${upModel.status}`);
  record('proposition modèle 3D (obj)', /modèle 3D \(obj\)/.test(propM), propM);

  if (!/Tape !go/.test(propM)) {
    record('!go lance la construction modèle', false, 'pas de proposition modèle — arrêt');
    throw new Error('pas de proposition modèle, arrêt');
  }

  // Scanne la région AVANT construction pour avoir une baseline
  // On scanne à partir de py+1 pour exclure le sol naturel et mesurer uniquement
  // les blocs construits en hauteur (au-dessus du niveau du joueur)
  const SCAN = { x1: px - 30, x2: px + 30, y1: py + 1, y2: py + 100, z1: pz - 50, z2: pz + 50 };
  const baseline = scanRegion(SCAN.x1, SCAN.x2, SCAN.y1, SCAN.y2, SCAN.z1, SCAN.z2);
  log(`  baseline avant construction : ${baseline.solid} blocs au-dessus du sol (${baseline.samples.join(', ')})`);

  // ── Étape (c) : !go → construction → scan devant > 20 blocs ─────────────────
  await sleep(1000);
  const goP = waitMsg(/lancée|erreur est survenue/, 15000, 'lancement construction modèle');
  send('!go');
  const goMsg = await goP;
  record('!go lance la construction modèle', /lancée/.test(goMsg), goMsg);
  if (!/lancée/.test(goMsg)) throw new Error('construction modèle non lancée, arrêt');

  const statusEndModel = await pollStatusUntilDone(600000);
  record('!status suit la construction modèle jusqu\'à la fin', /\(terminé\)|Aucune construction/.test(statusEndModel), statusEndModel);
  await sleep(2000);

  // Scan après construction : doit montrer > 20 blocs de plus que la baseline
  const front = scanRegion(SCAN.x1, SCAN.x2, SCAN.y1, SCAN.y2, SCAN.z1, SCAN.z2);
  const addedBlocks = front.solid - baseline.solid;
  log(`  après construction modèle : ${front.solid} blocs (baseline=${baseline.solid}, ajoutés=${addedBlocks}) (${front.samples.join(', ')})`);
  record('structure modèle 3D construite (> 20 blocs ajoutés)', addedBlocks > 20, `ajoutés=${addedBlocks} (${front.samples.join(', ')})`);

  // ── Étape (d) : !undo → restauration → zone retourne proche de la baseline ────
  const undoP = waitMsg(/Restauration|Aucune construction à annuler/, 10000, 'réponse !undo');
  send('!undo');
  const undoMsg = await undoP;
  record('!undo répond Restauration', /Restauration/.test(undoMsg), undoMsg);
  await pollStatusUntilDone(600000);
  await sleep(2000);

  const afterUndo = scanRegion(SCAN.x1, SCAN.x2, SCAN.y1, SCAN.y2, SCAN.z1, SCAN.z2);
  const remainingExtra = afterUndo.solid - baseline.solid;
  log(`  après !undo modèle : ${afterUndo.solid} blocs (baseline=${baseline.solid}, excédent=${remainingExtra}) (${afterUndo.samples.join(', ')})`);
  // Après undo, le nombre de blocs au-dessus du sol doit revenir proche de la baseline (≤ 2 blocs d'écart)
  record('zone restaurée après !undo modèle (excédent ≤ 2)', remainingExtra <= 2,
    `excédent=${remainingExtra} sur baseline=${baseline.solid} (${afterUndo.samples.join(', ')})`);

  // ── Étape (e) : upload maison.png avec mode=diorama → proposition "diorama : ..."
  // CRITIQUE : enregistrer l'écouteur AVANT l'upload
  const dioramaP = waitMsg(/Tape !go|erreur est survenue|structure invalide|analyse impossible/, 240000, 'proposition diorama');
  const upDiorama = await upload(
    path.join(__dirname, '../test/fixtures/maison.png'),
    'image/png',
    { mode: 'diorama' }   // champ extra FormData
  );
  const propD = await dioramaP;
  record('HTTP upload diorama OK', upDiorama.status === 200, `status=${upDiorama.status}`);
  record('proposition diorama reçue', /Tape !go/.test(propD), propD);
  record('proposition contient "diorama :"', /diorama\s*:/.test(propD), propD);

  // ── Étape (f) : !cancel → /annulée/ (on ne construit pas le diorama, trop long)
  const cancelP = waitMsg(/annulée|rien à annuler/, 10000, 'annulation diorama');
  send('!cancel');
  const cancelMsg = await cancelP;
  record('!cancel annule la proposition diorama', /annulée/.test(cancelMsg), cancelMsg);

  // ── Bilan ────────────────────────────────────────────────────────────────────
  const fails = results.filter((r) => !r.ok);
  log('');
  log(`=== BILAN E2E DIORAMA : ${results.length - fails.length}/${results.length} PASS ===`);
  for (const r of results) log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`);
  bot.quit();
  setTimeout(() => process.exit(fails.length ? 1 : 0), 1500);
}

main().catch((err) => {
  log('ERREUR E2E :', err.message);
  const fails = results.filter((r) => !r.ok);
  log(`=== BILAN PARTIEL : ${results.length - fails.length}/${results.length} PASS ===`);
  for (const r of results) log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`);
  bot.quit();
  setTimeout(() => process.exit(1), 1500);
});
