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
