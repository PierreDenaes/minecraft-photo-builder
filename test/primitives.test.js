const { test } = require('node:test');
const assert = require('node:assert');
const {
  boite, porte, baie, toitPlat, toitDeuxPans, toitQuatrePans, escalier, piscine
} = require('../src/primitives');

const at = (blocks, x, y, z) => blocks.find((b) => b.x === x && b.y === y && b.z === z);
const only = (blocks) => new Set(blocks.map((b) => b.block));

// ---- boite ----
test('boite : dalle + 4 murs + plancher supérieur, intérieur creux', () => {
  const b = boite({ x1: 0, z1: 0, x2: 5, z2: 4, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'cobblestone', plancher: 'oak_planks' });
  // dalle basse pleine 6x5
  for (let x = 0; x <= 5; x++) for (let z = 0; z <= 4; z++) assert.strictEqual(at(b, x, 0, z)?.block, 'cobblestone');
  // murs pleins 4 côtés y=1..3
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x <= 5; x++) { assert.strictEqual(at(b, x, y, 0)?.block, 'stone_bricks'); assert.strictEqual(at(b, x, y, 4)?.block, 'stone_bricks'); }
    for (let z = 0; z <= 4; z++) { assert.strictEqual(at(b, 0, y, z)?.block, 'stone_bricks'); assert.strictEqual(at(b, 5, y, z)?.block, 'stone_bricks'); }
  }
  // intérieur creux à y=2
  assert.strictEqual(at(b, 2, 2, 2), undefined);
  // plancher haut plein
  for (let x = 0; x <= 5; x++) for (let z = 0; z <= 4; z++) assert.strictEqual(at(b, x, 4, z)?.block, 'oak_planks');
});

test('boite : dimensions invalides → erreur claire', () => {
  assert.throws(() => boite({ x1: 5, z1: 0, x2: 2, z2: 4, y0: 0, y1: 3, murs: 'stone' }), /dimensions/i);
  assert.throws(() => boite({ x1: 0, z1: 0, x2: 5, z2: 4, y0: 3, y1: 0, murs: 'stone' }), /dimensions/i);
});

// ---- porte ----
test('porte : ouverture 1×2 dans le mur sud, linteau, oak_door orientée', () => {
  const murs = boite({ x1: 0, z1: 0, x2: 6, z2: 4, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'stone' });
  const p = porte({ facade: 'sud', x: 3, z: 0, y0: 0, hauteur: 2, materiau: 'oak_log' });
  // sud = z minimum du bâtiment (z=0)
  assert.strictEqual(at(p, 3, 1, 0)?.block, 'air');
  assert.strictEqual(at(p, 3, 2, 0)?.block, 'air');
  assert.strictEqual(at(p, 3, 3, 0)?.block, 'oak_log'); // linteau
  // porte battante orientée vers l'intérieur (sud → facing=north pour ouvrir vers +z)
  const door = p.filter((b) => /oak_door/.test(b.block));
  assert.strictEqual(door.length, 2);
  assert.ok(door.some((b) => /half=lower/.test(b.block)));
  assert.ok(door.some((b) => /half=upper/.test(b.block)));
  assert.ok(door.every((b) => /facing=north/.test(b.block)));
});

test('porte : les 4 façades produisent un facing opposé', () => {
  const sud = porte({ facade: 'sud', x: 3, z: 0, y0: 0, materiau: 'stone' });
  const nord = porte({ facade: 'nord', x: 3, z: 8, y0: 0, materiau: 'stone' });
  const est = porte({ facade: 'est', x: 8, z: 3, y0: 0, materiau: 'stone' });
  const ouest = porte({ facade: 'ouest', x: 0, z: 3, y0: 0, materiau: 'stone' });
  assert.ok(sud.some((b) => /facing=north/.test(b.block)));
  assert.ok(nord.some((b) => /facing=south/.test(b.block)));
  assert.ok(est.some((b) => /facing=west/.test(b.block)));
  assert.ok(ouest.some((b) => /facing=east/.test(b.block)));
});

// ---- baie ----
test('baie : glass_pane sur la rangée, encadrement complet', () => {
  const b = baie({ facade: 'sud', x1: 2, x2: 5, z1: 0, z2: 0, y1: 2, y2: 3, encadrement: 'oak_log' });
  for (let x = 2; x <= 5; x++) for (let y = 2; y <= 3; y++) assert.strictEqual(at(b, x, y, 0)?.block, 'glass_pane');
  // encadrement : appui (y=1), linteau (y=4), jambages (x=1 et x=6)
  for (let x = 1; x <= 6; x++) assert.strictEqual(at(b, x, 1, 0)?.block, 'oak_log');
  for (let x = 1; x <= 6; x++) assert.strictEqual(at(b, x, 4, 0)?.block, 'oak_log');
  for (let y = 2; y <= 3; y++) { assert.strictEqual(at(b, 1, y, 0)?.block, 'oak_log'); assert.strictEqual(at(b, 6, y, 0)?.block, 'oak_log'); }
});

// ---- toitPlat ----
test('toitPlat : dalle horizontale + acrotère en wall', () => {
  const t = toitPlat({ x1: 0, z1: 0, x2: 5, z2: 4, y: 5, materiau: 'light_gray_concrete', acrotere: true, debord: 1 });
  // dalle sur emprise + débord 1
  for (let x = -1; x <= 6; x++) for (let z = -1; z <= 5; z++) assert.strictEqual(at(t, x, 5, z)?.block, 'light_gray_concrete');
  // acrotère sur le pourtour (y=6)
  for (let x = -1; x <= 6; x++) {
    assert.ok(/wall/.test(at(t, x, 6, -1).block));
    assert.ok(/wall/.test(at(t, x, 6, 5).block));
  }
});

test('toitPlat : sans acrotère, sans débord', () => {
  const t = toitPlat({ x1: 0, z1: 0, x2: 3, z2: 3, y: 5, materiau: 'stone', acrotere: false, debord: 0 });
  assert.strictEqual(at(t, -1, 5, 0), undefined);
  assert.strictEqual(at(t, 0, 6, 0), undefined);
});

// ---- toitDeuxPans ----
test('toitDeuxPans : versants en stairs orientées, pignons remplis, débord 1', () => {
  const t = toitDeuxPans({ x1: 0, z1: 0, x2: 6, z2: 6, y_base: 4, faitage: 'x', materiau: 'dark_oak', debord: 1 });
  // faitage sur x → versants nord (z=0) et sud (z=6), montent vers z=3
  // stairs facing=south sur le versant nord (montée regarde vers +z)
  const stairs = t.filter((b) => /_stairs\[facing=/.test(b.block));
  assert.ok(stairs.length > 0);
  assert.ok(stairs.some((b) => /facing=south/.test(b.block)));
  assert.ok(stairs.some((b) => /facing=north/.test(b.block)));
  // pignons remplis (x=0 et x=6) : mur triangulaire
  const pignonX0 = t.filter((b) => b.x === 0 && b.block === 'dark_oak_planks');
  assert.ok(pignonX0.length > 0);
  // faîtage à z=3, y = y_base + 3 (pente 1:1 sur 3)
  assert.ok(t.some((b) => b.z === 3 && b.y === 7));
});

// ---- toitQuatrePans ----
test('toitQuatrePans : rangées rétrécissant de 1 sur 4 côtés, pointe centrée', () => {
  const t = toitQuatrePans({ x1: 0, z1: 0, x2: 6, z2: 6, y_base: 4, materiau: 'dark_oak', debord: 1 });
  // premier niveau (y_base) déborde de 1
  assert.ok(t.some((b) => b.y === 4 && b.x === -1));
  // pointe centrée : x=3, z=3, y = y_base + rayon
  const top = t.filter((b) => b.y === Math.max(...t.map((c) => c.y)));
  assert.ok(top.every((b) => b.x >= 2 && b.x <= 4 && b.z >= 2 && b.z <= 4));
});

// ---- escalier ----
test('escalier : marches ascendantes facing correct, masse de soutien, trémie percée', () => {
  const e = escalier({ x: 2, z: 3, y_bas: 0, y_haut: 4, facing: 'east', materiau: 'oak', tremie: true, largeur: 1 });
  // 4 marches en +x
  const stairs = e.filter((b) => /oak_stairs\[facing=east/.test(b.block));
  assert.strictEqual(stairs.length, 4);
  const ys = stairs.map((b) => b.y).sort((a, b) => a - b);
  assert.deepStrictEqual(ys, [1, 2, 3, 4]);
  assert.deepStrictEqual([...new Set(stairs.map((b) => b.x))].sort(), [2, 3, 4, 5]);
  // masse de soutien pleine sous chaque marche
  for (let i = 1; i <= 3; i++) {
    for (let yy = 1; yy < 1 + i; yy++) assert.ok(e.some((b) => b.x === 2 + i && b.y === yy && b.z === 3 && b.block === 'oak_planks'), `soutien x=${2 + i} y=${yy} manquant`);
  }
  // trémie : cases air à y_haut, au-dessus des marches hautes
  assert.ok(e.some((b) => b.y === 4 && b.block === 'air'));
});

test('escalier : les 4 facings couvrent les 4 directions', () => {
  for (const facing of ['east', 'west', 'north', 'south']) {
    const e = escalier({ x: 10, z: 10, y_bas: 0, y_haut: 4, facing, materiau: 'stone_brick' });
    assert.ok(e.some((b) => new RegExp(`stairs\\[facing=${facing}`).test(b.block)));
  }
});

// ---- piscine ----
test('piscine : bassin étanche, eau en surface, fond et parois pleins', () => {
  const p = piscine({ x1: 5, z1: 5, x2: 10, z2: 8, y_surface: 2, profondeur: 2, bordure: 'smooth_stone' });
  // eau à y=2 sur l'intérieur du bassin
  for (let x = 6; x <= 9; x++) for (let z = 6; z <= 7; z++) assert.strictEqual(at(p, x, 2, z)?.block, 'water');
  // fond plein à y = y_surface - profondeur = 0
  for (let x = 5; x <= 10; x++) for (let z = 5; z <= 8; z++) assert.strictEqual(at(p, x, 0, z)?.block, 'smooth_stone');
  // parois pleines
  for (let y = 1; y <= 2; y++) {
    for (let x = 5; x <= 10; x++) { assert.strictEqual(at(p, x, y, 5)?.block, 'smooth_stone'); assert.strictEqual(at(p, x, y, 8)?.block, 'smooth_stone'); }
    for (let z = 5; z <= 8; z++) { assert.strictEqual(at(p, 5, y, z)?.block, 'smooth_stone'); assert.strictEqual(at(p, 10, y, z)?.block, 'smooth_stone'); }
  }
});

test('piscine : profondeur par défaut = 2', () => {
  const p = piscine({ x1: 0, z1: 0, x2: 3, z2: 3, y_surface: 5, bordure: 'stone' });
  assert.ok(p.some((b) => b.y === 3 && b.block === 'stone')); // fond à y_surface - 2
});

test('piscine : y_surface trop bas → erreur (le fond passerait sous y=0)', () => {
  assert.throws(() => piscine({ x1: 0, z1: 0, x2: 3, z2: 3, y_surface: 1, profondeur: 2, bordure: 'stone' }),
    /profondeur|y_surface|creus/i);
});

test('piscine : y_surface = profondeur exactement → fond à y=0, OK', () => {
  const p = piscine({ x1: 0, z1: 0, x2: 3, z2: 3, y_surface: 2, profondeur: 2, bordure: 'stone' });
  assert.ok(p.some((b) => b.y === 0 && b.block === 'stone'));
  assert.ok(!p.some((b) => b.y < 0));
});

test('escalier : la marche du sommet SURVIT à la trémie', () => {
  const e = escalier({ x: 2, z: 3, y_bas: 0, y_haut: 4, facing: 'east', materiau: 'oak' });
  // au sommet la marche est à x=5, y=4 : elle doit rester présente
  const sommet = e.filter((b) => b.x === 5 && b.y === 4 && b.z === 3);
  assert.ok(sommet.some((b) => /oak_stairs\[facing=east/.test(b.block)), `marche du sommet perdue : ${JSON.stringify(sommet)}`);
  // et l'air de trémie ne recouvre pas la marche du sommet
  assert.ok(!sommet.some((b) => b.block === 'air'));
});

test('toitDeuxPans : faitage z produit autant de bloc-pignon que faitage x (symétrie)', () => {
  const tx = toitDeuxPans({ x1: 0, z1: 0, x2: 6, z2: 6, y_base: 4, faitage: 'x', materiau: 'dark_oak' });
  const tz = toitDeuxPans({ x1: 0, z1: 0, x2: 6, z2: 6, y_base: 4, faitage: 'z', materiau: 'dark_oak' });
  const planksX = tx.filter((b) => b.block === 'dark_oak_planks').length;
  const planksZ = tz.filter((b) => b.block === 'dark_oak_planks').length;
  assert.strictEqual(planksZ, planksX, `symétrie brisée : x=${planksX}, z=${planksZ}`);
});

// ---- tour ----
const { tour } = require('../src/primitives');

test('tour : paroi cylindrique creuse, dalles pleines aux extrémités', () => {
  const t = tour({ x: 10, z: 10, rayon: 3, y_bas: 0, y_haut: 6, materiau: 'stone_bricks', toit_conique: false });
  // dalle basse : cercle plein à y_bas
  assert.ok(at(t, 10, 0, 10)?.block === 'stone_bricks', 'centre de la dalle basse');
  assert.ok(at(t, 13, 0, 10)?.block === 'stone_bricks', 'bord est de la dalle basse');
  // paroi cylindrique : bloc au bord, air à l'intérieur (y intermédiaire)
  assert.ok(at(t, 13, 3, 10)?.block === 'stone_bricks', 'paroi est');
  assert.ok(at(t, 10, 3, 10) === undefined, 'centre creux');
  // dalle haute pleine
  assert.ok(at(t, 10, 6, 10)?.block === 'stone_bricks');
});

test('tour : materiau préfixe bois → planks pour les dalles, log pour la paroi', () => {
  const t = tour({ x: 5, z: 5, rayon: 2, y_bas: 0, y_haut: 4, materiau: 'oak', toit_conique: false });
  assert.ok(t.some((b) => b.block === 'oak_planks'), 'dalles en oak_planks');
  assert.ok(t.some((b) => b.block === 'oak_log'), 'paroi en oak_log');
});

test('tour : toit conique = anneaux rétrécissants au-dessus de y_haut', () => {
  const t = tour({ x: 20, z: 20, rayon: 3, y_bas: 0, y_haut: 6, materiau: 'stone_bricks', toit_conique: true });
  const maxY = Math.max(...t.map((b) => b.y));
  assert.ok(maxY > 6, `toit au-dessus de y_haut : maxY=${maxY}`);
  // anneau au niveau y_haut+1 : rayon plus petit
  const anneau = t.filter((b) => b.y === 7);
  assert.ok(anneau.length > 0 && anneau.length < 40, `anneau intermédiaire : ${anneau.length} blocs`);
});

test('tour : créneaux alternés au sommet quand demandé', () => {
  const t = tour({ x: 30, z: 30, rayon: 3, y_bas: 0, y_haut: 8, materiau: 'stone_bricks', toit_conique: false, creneaux: true });
  const sommet = t.filter((b) => b.y === 9);
  assert.ok(sommet.length > 0, 'merlons présents');
  assert.ok(sommet.length < 20, `merlons alternés : ${sommet.length}`);
});

test('tour : rayon nul → erreur', () => {
  assert.throws(() => tour({ x: 0, z: 0, rayon: 0, y_bas: 0, y_haut: 4, materiau: 'stone_bricks' }), /rayon/i);
});

test('tour : y_haut<=y_bas → erreur', () => {
  assert.throws(() => tour({ x: 0, z: 0, rayon: 3, y_bas: 5, y_haut: 5, materiau: 'stone_bricks' }), /hauteur/i);
});

test('tour : la paroi est 4-connectée (pas de trous entre piliers)', () => {
  const t = tour({ x: 20, z: 20, rayon: 3, y_bas: 0, y_haut: 6, materiau: 'stone_bricks', toit_conique: false });
  // paroi au niveau intermédiaire y=3
  const paroi = t.filter((b) => b.y === 3);
  const set = new Set(paroi.map((b) => `${b.x},${b.z}`));
  // chaque bloc de paroi doit avoir au moins 2 voisins 4-connectés dans le mur
  // (les extrémités du cercle ont 2 voisins, jamais 1 : sinon il est isolé)
  for (const b of paroi) {
    const voisins = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .filter(([dx, dz]) => set.has(`${b.x + dx},${b.z + dz}`)).length;
    assert.ok(voisins >= 2, `bloc paroi isolé à (${b.x},${b.z}) : ${voisins} voisin(s)`);
  }
});

test('tour : rayon=4 aussi 4-connecté', () => {
  const t = tour({ x: 30, z: 30, rayon: 4, y_bas: 0, y_haut: 6, materiau: 'stone_bricks', toit_conique: false });
  const paroi = t.filter((b) => b.y === 3);
  const set = new Set(paroi.map((b) => `${b.x},${b.z}`));
  for (const b of paroi) {
    const voisins = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .filter(([dx, dz]) => set.has(`${b.x + dx},${b.z + dz}`)).length;
    assert.ok(voisins >= 2, `rayon=4 bloc paroi isolé à (${b.x},${b.z})`);
  }
});

test('tour : créneaux jamais adjacents 4-connectés (vrai alternance)', () => {
  const t = tour({ x: 40, z: 40, rayon: 4, y_bas: 0, y_haut: 8, materiau: 'stone_bricks', toit_conique: false, creneaux: true });
  const merlons = t.filter((b) => b.y === 9);
  const set = new Set(merlons.map((b) => `${b.x},${b.z}`));
  for (const m of merlons) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      assert.ok(!set.has(`${m.x + dx},${m.z + dz}`), `merlons collés à (${m.x},${m.z}) et (${m.x + dx},${m.z + dz})`);
    }
  }
});

// ---- Itération 14 : primitives d'extérieur et de détail ----
const { lampadaire, terrasse, pontonBois, haie, bordurePlantes, perron, gardeCorps } = require('../src/primitives');

test('lampadaire : poteau vertical de fences + lanterne au sommet', () => {
  const l = lampadaire({ x: 5, z: 5, y0: 0, hauteur: 4, materiau: 'dark_oak_fence' });
  for (let y = 0; y < 4; y++) assert.strictEqual(at(l, 5, y, 5)?.block, 'dark_oak_fence', `poteau y=${y} manquant`);
  assert.strictEqual(at(l, 5, 4, 5)?.block, 'lantern');
});

test('lampadaire : hauteur=1 → juste poteau + lanterne', () => {
  const l = lampadaire({ x: 0, z: 0, y0: 0, hauteur: 1, materiau: 'oak_fence' });
  assert.strictEqual(at(l, 0, 0, 0)?.block, 'oak_fence');
  assert.strictEqual(at(l, 0, 1, 0)?.block, 'lantern');
});

test('terrasse : dalle horizontale sur l\'emprise', () => {
  const t = terrasse({ x1: 0, z1: 0, x2: 4, z2: 3, y: 0, materiau: 'smooth_stone' });
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 3; z++) assert.strictEqual(at(t, x, 0, z)?.block, 'smooth_stone');
});

test('terrasse : bordure surélevée sur le pourtour', () => {
  const t = terrasse({ x1: 0, z1: 0, x2: 4, z2: 3, y: 0, materiau: 'smooth_stone', bordure: 'stone_brick_wall' });
  // dalle plate
  assert.strictEqual(at(t, 2, 0, 2)?.block, 'smooth_stone');
  // bordure au pourtour à y+1
  assert.strictEqual(at(t, 0, 1, 0)?.block, 'stone_brick_wall');
  assert.strictEqual(at(t, 4, 1, 3)?.block, 'stone_brick_wall');
  assert.strictEqual(at(t, 2, 1, 2), undefined); // intérieur pas bordé
});

test('pontonBois : dalle + pilotis descendant jusqu\'à y=0', () => {
  const p = pontonBois({ x1: 5, z1: 5, x2: 8, z2: 7, y: 3, materiau: 'oak_planks' });
  // dalle du ponton
  for (let x = 5; x <= 8; x++) for (let z = 5; z <= 7; z++) assert.strictEqual(at(p, x, 3, z)?.block, 'oak_planks');
  // pilotis aux coins jusqu'à y=0
  for (let y = 0; y < 3; y++) assert.strictEqual(at(p, 5, y, 5)?.block, 'oak_fence', `pilotis coin y=${y}`);
});

test('haie : rangée de feuilles persistent', () => {
  const h = haie({ x1: 0, z1: 5, x2: 6, z2: 5, y: 1, essence: 'oak_leaves', hauteur: 2 });
  for (let x = 0; x <= 6; x++) for (let y = 1; y <= 2; y++) {
    const b = at(h, x, y, 5);
    assert.strictEqual(b?.block, 'oak_leaves[persistent=true]', `haie x=${x} y=${y}`);
  }
});

test('bordurePlantes : 1 rangée de feuilles', () => {
  const b = bordurePlantes({ x1: 0, z1: 0, x2: 3, z2: 0, y: 1, materiau: 'azalea_leaves' });
  for (let x = 0; x <= 3; x++) assert.strictEqual(at(b, x, 1, 0)?.block, 'azalea_leaves[persistent=true]');
});

test('perron : marches ascendantes devant la porte, facing correct', () => {
  const p = perron({ x: 5, z: 3, y0: 0, largeur: 3, marches: 2, materiau: 'stone', facing: 'north' });
  // facing=north : la porte est au nord (z plus petit), on monte vers z-, marches z=3,2,1 face au sud… inversé : les marches regardent LA PORTE
  // pour facing=north (porte au nord) : marches en z décroissant, facing=north sur les stairs (montée regarde nord = vers la porte)
  const stairs = p.filter((b) => /_stairs\[facing=north/.test(b.block));
  assert.ok(stairs.length >= 3, `marches attendues : ${stairs.length}`);
});

test('gardeCorps : rangée d\'iron_bars sur le pourtour', () => {
  const g = gardeCorps({ x1: 0, z1: 0, x2: 5, z2: 3, y: 5, materiau: 'iron_bars' });
  // pourtour uniquement
  for (let x = 0; x <= 5; x++) { assert.strictEqual(at(g, x, 5, 0)?.block, 'iron_bars'); assert.strictEqual(at(g, x, 5, 3)?.block, 'iron_bars'); }
  for (let z = 1; z < 3; z++) { assert.strictEqual(at(g, 0, 5, z)?.block, 'iron_bars'); assert.strictEqual(at(g, 5, 5, z)?.block, 'iron_bars'); }
  assert.strictEqual(at(g, 2, 5, 2), undefined); // intérieur libre
});

test('validation : lampadaire hauteur nulle → erreur', () => {
  assert.throws(() => lampadaire({ x: 0, z: 0, y0: 0, hauteur: 0, materiau: 'oak_fence' }), /hauteur/i);
});

test('perron : largeur paire refusée (asymétrique impossible)', () => {
  assert.throws(() => perron({ x: 0, z: 0, y0: 0, largeur: 4, marches: 2, materiau: 'stone', facing: 'north' }), /largeur/i);
});

test('baie illumine=true : glowstone en second rang derrière les vitres (côté intérieur)', () => {
  const b = baie({ facade: 'sud', x1: 2, x2: 4, z1: 0, z2: 0, y1: 2, y2: 3, encadrement: 'oak_log', illumine: true });
  // les vitres restent à z=0
  assert.ok(b.some((k) => k.z === 0 && k.block === 'glass_pane'));
  // glowstone derrière : z=1 (côté intérieur pour façade sud), même x/y que les vitres
  assert.ok(b.some((k) => k.z === 1 && k.block === 'glowstone' && k.x === 3 && k.y === 2), JSON.stringify(b.filter((k) => k.z === 1)));
});

// ---- Vague 3 : densité de façade ----
const { colombages, lierre, avantCorps } = require('../src/primitives');

test('colombages : logs verticaux en saillie sur la façade, espacés régulièrement', () => {
  const c = colombages({ facade: 'sud', x1: 0, x2: 10, z: 0, y1: 1, y2: 3, materiau: 'dark_oak_log', espacement: 3 });
  // logs en saillie devant la façade (z=-1 pour façade sud) tous les 3 blocs
  const logs = c.filter((b) => b.block === 'dark_oak_log');
  assert.ok(logs.length > 0);
  const xs = [...new Set(logs.map((b) => b.x))].sort((a, b) => a - b);
  // pas régulier
  for (let i = 1; i < xs.length; i++) assert.strictEqual(xs[i] - xs[i - 1], 3);
});

test('lierre : rangées de vine sur un mur existant, dispersé', () => {
  const l = lierre({ facade: 'ouest', x: 0, z1: 2, z2: 8, y1: 1, y2: 5, densite: 0.5 });
  const vines = l.filter((b) => b.block === 'vine');
  assert.ok(vines.length > 0, 'lierre attendu');
  // moitié environ des cases occupées (tolérance)
  const total = 7 * 5;
  assert.ok(vines.length > total * 0.3 && vines.length < total * 0.7, `densité ~50% : ${vines.length}/${total}`);
});

test('avantCorps : boite en saillie de 1 devant une façade, plus étroite que celle-ci', () => {
  const a = avantCorps({ facade: 'sud', x1: 3, x2: 8, z_facade: 0, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'cobblestone' });
  // saillie de 1 vers le sud (z=-1)
  assert.ok(a.some((b) => b.z === -1));
  // murs latéraux au ras de la façade
  assert.ok(a.some((b) => b.x === 3 && b.y === 2 && b.z === -1));
  assert.ok(a.some((b) => b.x === 8 && b.y === 2 && b.z === -1));
});

// ---- Vague 4 : intégration au terrain naturel ----
const { berge } = require('../src/primitives');

test('berge : sol en pente + eau à côté + une bande de sable/gravier au contact', () => {
  const b = berge({ x1: 0, z1: 0, x2: 10, z2: 8, y_sol: 0, cote: 'sud', profondeur_eau: 2, sable: 'sand' });
  // sol plat au dessus (y_sol) sur la partie NORD (loin de l'eau)
  assert.ok(b.some((k) => k.z >= 4 && k.y === 0 && k.block === 'grass_block'), 'terre au nord');
  // eau au sud (petites z)
  assert.ok(b.some((k) => k.y === 0 && k.z === 0 && k.block === 'water'), 'eau au sud');
  // bande de sable au contact eau/terre
  assert.ok(b.some((k) => k.block === 'sand'), 'sable au contact');
});
