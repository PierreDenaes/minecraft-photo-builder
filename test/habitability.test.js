const { test } = require('node:test');
const assert = require('node:assert');
const { auditHabitability } = require('../src/habitability');

function box(w, h, d, { doorAt, floors = [], stairsAt } = {}) {
  const blocks = [];
  const solid = new Set();
  const put = (x, y, z, block = 'stone_bricks') => {
    const k = `${x},${y},${z}`;
    if (!solid.has(k)) { solid.add(k); blocks.push({ x, y, z, block }); }
  };
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) { put(x, 0, z); put(x, h - 1, z); }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) { put(x, y, 0); put(x, y, d - 1); }
    for (let z = 0; z < d; z++) { put(0, y, z); put(w - 1, y, z); }
  }
  const out = blocks.filter((b) => !(doorAt && b.z === 0 && b.x === doorAt && (b.y === 1 || b.y === 2)));
  for (const fy of floors) {
    for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
      if (stairsAt && x === stairsAt.x && z === stairsAt.z) continue; // trémie
      out.push({ x, y: fy, z, block: 'oak_planks' });
    }
  }
  if (stairsAt) {
    for (let y = 1; y < (floors[0] || 1); y++) out.push({ x: stairsAt.x, y, z: stairsAt.z, block: 'oak_stairs' });
  }
  return out;
}

test('hauteur libre correcte et entrée présente → aucun défaut (hors façades monochromes du décor de test)', () => {
  const b = box(10, 7, 8, { doorAt: 4 });
  assert.deepStrictEqual(auditHabitability(b).filter((d) => !/façade/.test(d)), []);
});

test('boîte scellée → défaut « aucune entrée »', () => {
  const b = box(10, 7, 8);
  const defects = auditHabitability(b);
  assert.ok(defects.some((d) => /entrée/i.test(d)), defects.join(' | '));
});

test('plancher à 2 blocs du plafond → défaut de hauteur libre', () => {
  const b = box(10, 8, 8, { doorAt: 4, floors: [5] }); // plafond y=7, plancher y=5 → 1 de libre
  const defects = auditHabitability(b);
  assert.ok(defects.some((d) => /hauteur libre/i.test(d)), defects.join(' | '));
});

test('étage sans escalier → défaut d\'accès ; avec trémie + escaliers → aucun', () => {
  const sans = box(12, 10, 10, { doorAt: 4, floors: [4] });
  assert.ok(auditHabitability(sans).some((d) => /escalier|accès/i.test(d)));
  const avec = box(12, 10, 10, { doorAt: 4, floors: [4], stairsAt: { x: 5, z: 5 } });
  assert.deepStrictEqual(avec.length > 0 && auditHabitability(avec).filter((d) => /escalier|accès/i.test(d)), []);
});

test('un puits intérieur ne compte pas comme entrée (bande périmétrique)', () => {
  // grande boîte scellée 20x16 avec un « puits » central surmonté d'une poutre à y=3
  const b = box(20, 8, 16);
  b.push({ x: 10, y: 3, z: 8, block: 'stone_bricks' }); // poutre au-dessus d'une colonne d'air intérieure
  const defects = auditHabitability(b);
  assert.ok(defects.some((d) => /entrée/i.test(d)), `entrée manquante attendue : ${defects.join(' | ')}`);
});

test('un escalier avec état [facing=...] compte comme accès entre étages', () => {
  const avec = box(12, 10, 10, { doorAt: 4, floors: [4], stairsAt: { x: 5, z: 5 } })
    .map((b) => (b.block === 'oak_stairs' ? { ...b, block: 'oak_stairs[facing=north,half=bottom]' } : b));
  assert.deepStrictEqual(auditHabitability(avec).filter((d) => /escalier|accès/i.test(d)), []);
});

test('façade uniforme (1 seul matériau) → défaut ; façade variée → rien', () => {
  const uni = box(14, 8, 10, { doorAt: 4 });
  const defUni = auditHabitability(uni);
  assert.ok(defUni.some((d) => /façade/.test(d)), defUni.join(' | '));
  const varie = box(14, 8, 10, { doorAt: 4 }).map((b, i) => ({
    ...b, block: b.z === 0 ? ['stone_bricks', 'oak_log', 'glass_pane'][i % 3] : b.block
  }));
  const defVar = auditHabitability(varie);
  assert.ok(!defVar.some((d) => /façade z=0/.test(d)), defVar.join(' | '));
});

test('fenêtres désalignées entre étages → défaut ; alignées → rien', () => {
  const withWin = (x1, x2) => {
    const b = box(14, 12, 10, { doorAt: 4, floors: [5], stairsAt: { x: 6, z: 5 } });
    for (const bb of b) {
      if (bb.z === 0 && bb.y >= 2 && bb.y <= 3 && bb.x === x1) bb.block = 'glass_pane';
      if (bb.z === 0 && bb.y >= 7 && bb.y <= 8 && bb.x === x2) bb.block = 'glass_pane';
    }
    return b;
  };
  const aligned = auditHabitability(withWin(8, 8));
  assert.ok(!aligned.some((d) => /fenêtres/.test(d)), aligned.join(' | '));
  const misaligned = auditHabitability(withWin(8, 11));
  assert.ok(misaligned.some((d) => /fenêtres/.test(d)), misaligned.join(' | '));
});

// ---- Itération 11 ----
test('eau non contenue (sans fond) → défaut ; bassin correct → rien', () => {
  const base = box(14, 8, 10, { doorAt: 4 });
  const bassin = [...base];
  for (let x = 3; x <= 5; x++) for (let z = 3; z <= 5; z++) bassin.push({ x, y: 1, z, block: 'water' });
  // le fond y=0 existe (dalle de la boîte) → contenu
  assert.ok(!auditHabitability(bassin).some((d) => /eau/.test(d)));
  const flottante = [...base, { x: 6, y: 4, z: 6, block: 'water' }];
  assert.ok(auditHabitability(flottante).some((d) => /eau/.test(d)));
});

test('vision a vu des baies mais aucune vitre posée → défaut fenêtres absentes', () => {
  const opaque = box(14, 8, 10, { doorAt: 4 });
  const defects = auditHabitability(opaque, { elements: ['baies_vitrees_coulissantes', 'piscine'] });
  assert.ok(defects.some((d) => /fenêtre|vitre/i.test(d)), defects.join(' | '));
  const sans = auditHabitability(opaque, { elements: ['cheminee'] });
  assert.ok(!sans.some((d) => /fenêtre|vitre/i.test(d)));
});

// ---- masque bâtiment (scènes avec piscine/terrasse) ----
function scenePool(withDoor = true) {
  const out = [];
  const put = (x, y, z, block = 'white_concrete') => out.push({ x, y, z, block });
  for (let x = 0; x < 12; x++) for (let z = 0; z < 9; z++) {
    put(x, 0, z, 'smooth_stone'); put(x, 4, z, 'oak_planks'); put(x, 8, z, 'light_gray_concrete');
  }
  for (let y = 1; y < 8; y++) {
    for (let x = 0; x < 12; x++) { put(x, y, 0); put(x, y, 8); }
    for (let z = 0; z < 9; z++) { put(0, y, z); put(11, y, z); }
  }
  for (let x = 14; x < 40; x++) for (let z = 0; z < 23; z++) put(x, 0, z, 'smooth_stone');
  return withDoor ? out.filter((b) => !(b.z === 0 && b.x === 5 && (b.y === 1 || b.y === 2))) : out;
}

test('scène avec piscine : la porte de la MAISON est reconnue (frontière du masque, pas bord de bbox)', () => {
  const avec = auditHabitability(scenePool(true));
  assert.ok(!avec.some((d) => /entrée/.test(d)), avec.join(' | '));
  const sans = auditHabitability(scenePool(false));
  assert.ok(sans.some((d) => /entrée/.test(d)));
});

test('scène : l\'accès entre étages de la maison est audité malgré la piscine', () => {
  const defects = auditHabitability(scenePool(true));
  assert.ok(defects.some((d) => /escalier/.test(d)), defects.join(' | '));
});

test('baies promises : des vitres de balcon éparses ne suffisent pas', () => {
  const scene = scenePool(true);
  scene.push({ x: 3, y: 5, z: 0, block: 'glass_pane' }); // 1 seule vitre
  const defects = auditHabitability(scene, { elements: ['grandes_baies_vitrees'], etages: 2 });
  assert.ok(defects.some((d) => /vitre|baie/i.test(d)), defects.join(' | '));
});

test('porte 1x3 (haute) reconnue comme entrée', () => {
  const out = [];
  const put = (x, y, z, block = 'stone') => out.push({ x, y, z, block });
  for (let x = 0; x < 10; x++) for (let z = 0; z < 8; z++) { put(x, 0, z, 'oak_planks'); put(x, 6, z); put(x, 4, z, 'oak_planks'); }
  for (let y = 1; y < 6; y++) {
    for (let x = 0; x < 10; x++) { put(x, y, 0); put(x, y, 7); }
    for (let z = 0; z < 8; z++) { put(0, y, z); put(9, y, z); }
  }
  // porte 1×3 : air à y=1,2,3, linteau à y=4
  const withDoor = out.filter((b) => !(b.z === 0 && b.x === 4 && (b.y === 1 || b.y === 2 || b.y === 3)));
  const defects = auditHabitability(withDoor);
  assert.ok(!defects.some((d) => /entrée/.test(d)), defects.join(' | '));
});

test('audit + porte primitive : maison boite+porte reconnue comme habitable', () => {
  const { boite, porte } = require('../src/primitives');
  const b1 = boite({ x1: 0, z1: 0, x2: 7, z2: 5, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'cobblestone', plancher: 'oak_planks' });
  const p = porte({ facade: 'sud', x: 3, z: 0, y0: 0, hauteur: 2, materiau: 'stone_bricks' });
  const defects = auditHabitability([...b1, ...p]);
  assert.ok(!defects.some((d) => /entrée/.test(d)), `porte primitive non reconnue : ${defects.join(' | ')}`);
});

// ---- Itération 15 (vague 1) : liste des checks (passés + échoués) ----
const { auditChecks } = require('../src/habitability');

test('auditChecks : bâtiment habitable → tous les checks à ✓', () => {
  const { boite, porte } = require('../src/primitives');
  const b1 = boite({ x1: 0, z1: 0, x2: 8, z2: 6, y0: 0, y1: 5, murs: 'stone_bricks', fondation: 'cobblestone', plancher: 'oak_planks' });
  const p = porte({ facade: 'sud', x: 4, z: 0, y0: 0, hauteur: 2, materiau: 'stone_bricks' });
  const checks = auditChecks([...b1, ...p]);
  assert.ok(Array.isArray(checks));
  // 5 checks au minimum : hauteur, entrée, escaliers, façades, fenêtres/eau
  assert.ok(checks.length >= 5);
  const names = checks.map((c) => c.name);
  assert.ok(names.some((n) => /hauteur/i.test(n)));
  assert.ok(names.some((n) => /entrée|acc[eè]s/i.test(n)));
  // hauteur et entrée doivent passer
  assert.ok(checks.find((c) => /hauteur/i.test(c.name)).passed);
  assert.ok(checks.find((c) => /entrée|acc[eè]s/i.test(c.name)).passed);
});

test('auditChecks : boîte scellée → check entrée à ✗', () => {
  const { boite } = require('../src/primitives');
  const b1 = boite({ x1: 0, z1: 0, x2: 8, z2: 6, y0: 0, y1: 5, murs: 'stone_bricks', fondation: 'stone' });
  const checks = auditChecks(b1);
  const entree = checks.find((c) => /entrée|acc[eè]s/i.test(c.name));
  assert.strictEqual(entree.passed, false);
});

test('auditChecks : un défaut de fenêtre ne fait PAS échouer le check "Murs cohérents"', () => {
  const { boite, porte } = require('../src/primitives');
  const b1 = boite({ x1: 0, z1: 0, x2: 10, z2: 8, y0: 0, y1: 5, murs: 'stone_bricks', fondation: 'cobblestone', plancher: 'oak_planks' });
  const p = porte({ facade: 'sud', x: 5, z: 0, y0: 0, hauteur: 2, materiau: 'stone_bricks' });
  // description avec baie promise mais aucune vitre posée → defect fenêtre
  const checks = auditChecks([...b1, ...p], { elements: ['grandes_baies_vitrees'] });
  const habitable = checks.find((c) => /habitable/i.test(c.name));
  const murs = checks.find((c) => /murs/i.test(c.name));
  assert.strictEqual(habitable.passed, false, 'bâtiment habitable doit ÉCHOUER');
  assert.strictEqual(murs.passed, true, 'murs cohérents doit passer (le defect fenêtre ne matche pas ce check)');
});

test('audit : cellules dalle-sur-dalle (plancher+plafond superposés, sans air entre) sont ignorées', () => {
  // situation : rdc + étage empilés SANS écart intermédiaire — le plancher du rdc
  // et la fondation de l'étage occupent la même case, la case adjacente contient
  // du mur d'étage → l'audit voyait "hauteur libre médiane 0", faux positif
  const out = [];
  const put = (x, y, z, block = 'white_concrete') => out.push({ x, y, z, block });
  // rdc plein (y=0 à y=4) : dalle basse + plancher haut + murs
  for (let x = 0; x < 10; x++) for (let z = 0; z < 8; z++) {
    put(x, 0, z, 'stone'); put(x, 4, z, 'oak_planks');
  }
  for (let y = 1; y < 4; y++) {
    for (let x = 0; x < 10; x++) { put(x, y, 0); put(x, y, 7); }
    for (let z = 0; z < 8; z++) { put(0, y, z); put(9, y, z); }
  }
  // étage plein (y=4 à y=8) — DALLE À y=4 (superposée au plancher rdc) + plafond y=8
  for (let x = 0; x < 10; x++) for (let z = 0; z < 8; z++) {
    put(x, 4, z, 'white_concrete'); put(x, 8, z, 'light_gray_concrete');
  }
  for (let y = 5; y < 8; y++) {
    for (let x = 0; x < 10; x++) { put(x, y, 0); put(x, y, 7); }
    for (let z = 0; z < 8; z++) { put(0, y, z); put(9, y, z); }
  }
  // porte au sud
  const withDoor = out.filter((b) => !(b.z === 0 && b.x === 5 && (b.y === 1 || b.y === 2)));
  const defects = auditHabitability(withDoor);
  // Le plancher y=4 est doublé (dalle rdc + fondation étage sur même case), mais
  // au-dessus l'espace est bien libre 3 blocs jusqu'au plafond y=8. Ne PAS remonter
  // "hauteur libre médiane 0".
  assert.ok(!defects.some((d) => /médiane 0/.test(d)), defects.join(' | '));
});

// Monuments : aucune règle d'habitabilité ne s'applique (silhouette prime).
// Bug Tour Eiffel : la boucle de correction appelait auditHabitability sur un
// monument → « façades avec 2 matériaux » → colombages/bandeaux absurdes ajoutés.
const { isMonument } = require('../src/habitability');

test('auditHabitability : monument → aucun défaut, même sans porte ni étages', () => {
  const b = box(10, 6, 8); // pas de porte → défauts garantis en mode bâtiment
  assert.ok(auditHabitability(b, { type_batiment: 'maison' }).length > 0,
    'le décor de test doit produire des défauts pour un bâtiment habitable');
  assert.deepStrictEqual(auditHabitability(b, { type_batiment: 'tour_eiffel' }), []);
  assert.deepStrictEqual(auditHabitability(b, { type_batiment: 'tour_isolee' }), []);
  assert.deepStrictEqual(auditHabitability(b, { type_batiment: 'arc de triomphe' }), []);
});

test('isMonument : reconnaît les monuments, pas les bâtiments habitables', () => {
  assert.strictEqual(isMonument({ type_batiment: 'tour_eiffel' }), true);
  assert.strictEqual(isMonument({ type_batiment: 'pyramide_egypte' }), true);
  assert.strictEqual(isMonument({ type_batiment: 'maison à colombages' }), false);
  assert.strictEqual(isMonument({ type_batiment: 'villa' }), false);
  assert.strictEqual(isMonument({}), false);
});
