// Bot-joueur automatisé : déroule le protocole e2e du plan (Task 11) contre l'app en cours d'exécution
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

async function upload(file, mime) {
  const fd = new FormData();
  fd.append('username', USERNAME);
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

  // Étape 0 : vérifier la convention yaw de mineflayer (lookAt un point plein nord)
  const p0 = bot.entity.position.clone();
  await bot.lookAt(p0.offset(0, 1.6, -10));
  await sleep(500);
  const yawNorth = bot.entity.yaw;
  const yawOk = Math.abs(Math.atan2(Math.sin(yawNorth), Math.cos(yawNorth))) < 0.3;
  record('convention yaw (0 = nord/-z, formule -sin/-cos)', yawOk, `yaw mesuré face au nord : ${yawNorth.toFixed(3)}`);

  const px = Math.floor(p0.x), py = Math.floor(p0.y), pz = Math.floor(p0.z);
  log(`  position joueur : ${px} ${py} ${pz}, regard : nord (-z)`);

  // Étape 1 : !photo → lien
  send('!photo');
  const linkMsg = await waitMsg(/upload\/Pierre_Test/, 10000, 'lien !photo');
  record('!photo renvoie le lien d\'upload', /http:\/\/localhost:3000\/upload\/Pierre_Test/.test(linkMsg));

  // Étape 2 : upload maison → proposition (écouteur enregistré AVANT l'upload : la
  // proposition part pendant que la requête HTTP est encore en cours)
  const proposalP = waitMsg(/Tape !go|analyse impossible|erreur est survenue|structure invalide/, 150000, 'proposition de construction');
  const up1 = await upload(path.join(__dirname, '../test/fixtures/maison.png'), 'image/png');
  const proposal = await proposalP;
  if (!/Tape !go/.test(proposal)) {
    record('proposition après photo maison', false, proposal);
    throw new Error('pas de proposition, arrêt');
  }
  record('proposition après photo maison', up1.status === 200, proposal);

  // Étape 3 : !go → construction
  await sleep(1000);
  const goP = waitMsg(/lancée|erreur est survenue/, 15000, 'lancement construction');
  send('!go');
  const goMsg = await goP;
  record('!go lance la construction', /lancée/.test(goMsg), goMsg);
  if (!/lancée/.test(goMsg)) throw new Error('construction non lancée, arrêt');

  // Étape 4 : !status pendant / jusqu'à la fin
  const statusEnd = await pollStatusUntilDone(240000);
  record('!status suit et signale la fin', /\(terminé\)/.test(statusEnd), statusEnd);
  await sleep(2000);

  // Étape 5 : la structure est-elle DEVANT (nord) et pas derrière ?
  const front = scanRegion(px - 24, px + 24, py, py + 24, pz - 40, pz - 5);
  const behind = scanRegion(px - 24, px + 24, py, py + 24, pz + 5, pz + 40);
  log(`  devant : ${front.solid} blocs (${front.samples.join(', ')}) ; derrière : ${behind.solid} ; non chargés : ${front.unloaded}/${behind.unloaded}`);
  record('structure construite devant le joueur', front.solid > 50 && behind.solid < front.solid / 10,
    `devant=${front.solid} derrière=${behind.solid}`);

  // Étape 6 : !undo → zone restaurée
  const undoP = waitMsg(/Restauration|Aucune construction à annuler/, 10000, 'réponse !undo');
  send('!undo');
  const undoMsg = await undoP;
  record('!undo répond', /Restauration/.test(undoMsg), undoMsg);
  await pollStatusUntilDone(240000);
  await sleep(2000);
  const afterUndo = scanRegion(px - 24, px + 24, py, py + 24, pz - 40, pz - 5);
  record('zone restaurée après !undo', afterUndo.solid <= 2, `blocs restants au-dessus du sol : ${afterUndo.solid} (${afterUndo.samples.join(', ')})`);

  // Étape 7 : photo sans bâtiment → erreur propre
  const errP = waitMsg(/analyse impossible|Tape !go/, 150000, 'réponse photo paysage');
  const up2 = await upload(path.join(__dirname, '../test/fixtures/paysage.png'), 'image/png');
  const errMsg = await errP;
  if (/Tape !go/.test(errMsg)) {
    record('photo sans bâtiment → erreur propre', false, 'la vision a proposé une construction pour un paysage — à noter pour l\'itération prompt');
    send('!cancel');
    await waitMsg(/annulée/, 10000, 'annulation');
  } else {
    record('photo sans bâtiment → erreur propre', true, errMsg);
  }
  void up2;

  // Bilan
  const fails = results.filter((r) => !r.ok);
  log('');
  log(`=== BILAN E2E : ${results.length - fails.length}/${results.length} PASS ===`);
  for (const r of results) log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`);
  bot.quit();
  setTimeout(() => process.exit(fails.length ? 1 : 0), 1500);
}

main().catch((err) => {
  log('ERREUR E2E :', err.message);
  const fails = results.filter((r) => !r.ok);
  log(`=== BILAN PARTIEL : ${results.length - fails.length}/${results.length} PASS ===`);
  bot.quit();
  setTimeout(() => process.exit(1), 1500);
});
