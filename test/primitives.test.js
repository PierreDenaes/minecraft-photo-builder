const { test } = require('node:test');
const assert = require('node:assert');
const {
  boite, porte, baie, toitPlat, toitDeuxPans, toitQuatrePans, escalier, piscine, arche, pyramideTronquee
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
test('porte : porte battante 2 blocs + linteau, oak_door orientée', () => {
  const murs = boite({ x1: 0, z1: 0, x2: 6, z2: 4, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'stone' });
  const p = porte({ facade: 'sud', x: 3, z: 0, y0: 0, hauteur: 2, materiau: 'oak_log' });
  // porte battante à y=1,2 (2 blocs oak_door)
  assert.ok(/oak_door.*half=lower/.test(at(p, 3, 1, 0)?.block));
  assert.ok(/oak_door.*half=upper/.test(at(p, 3, 2, 0)?.block));
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

test('baie illumine=true : source lumineuse dans le mur intérieur au-dessus du linteau', () => {
  const b = baie({ facade: 'nord', x1: 2, x2: 4, z1: 0, z2: 0, y1: 2, y2: 3, encadrement: 'oak_log', illumine: true });
  assert.ok(b.some((k) => k.z === 0 && k.block === 'glass_pane'));
  // glowstone à y2+1, décalé d'un cran vers l'intérieur (invisible depuis dehors)
  assert.ok(b.some((k) => k.z === 1 && k.block === 'glowstone' && k.x === 3 && k.y === 4),
    JSON.stringify(b.filter((k) => k.block === 'glowstone')));
});

// ---- Vague 3 : densité de façade ----
const { colombages, lierre, avantCorps } = require('../src/primitives');

test('colombages : logs verticaux en saillie sur la façade, espacés régulièrement', () => {
  const c = colombages({ facade: 'nord', x1: 0, x2: 10, z: 0, y1: 1, y2: 3, materiau: 'dark_oak_log', espacement: 3 });
  // logs en saillie devant la façade (z=-1 pour façade sud) tous les 3 blocs
  const logs = c.filter((b) => b.block === 'dark_oak_log');
  assert.ok(logs.length > 0);
  const xs = [...new Set(logs.map((b) => b.x))].sort((a, b) => a - b);
  // pas régulier
  for (let i = 1; i < xs.length; i++) assert.strictEqual(xs[i] - xs[i - 1], 3);
});

test('lierre : rangées de vine sur un mur existant, dispersé', () => {
  const l = lierre({ facade: 'ouest', x: 0, z1: 2, z2: 8, y1: 1, y2: 5, densite: 0.5 });
  // depuis l'audit 27/07, chaque vine porte sa face d'accrochage
  const vines = l.filter((b) => /^vine\[/.test(b.block));
  assert.ok(vines.length > 0, 'lierre attendu');
  // moitié environ des cases occupées (tolérance)
  const total = 7 * 5;
  assert.ok(vines.length > total * 0.3 && vines.length < total * 0.7, `densité ~50% : ${vines.length}/${total}`);
});

test('avantCorps : boite en saillie de 1 devant une façade, plus étroite que celle-ci', () => {
  const a = avantCorps({ facade: 'nord', x1: 3, x2: 8, z_facade: 0, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'cobblestone' });
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

test('avantCorps : saillie correcte pour façade ouest (bug de revue)', () => {
  const a = avantCorps({ facade: 'ouest', x1: 3, x2: 8, z_facade: 5, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'cobblestone' });
  // ouest = x plus petit ; saillie vers x < 5, donc x=4 (extérieur)
  assert.ok(a.some((b) => b.x === 4 && b.y === 2), 'saillie x=4 attendue');
  assert.ok(a.some((b) => b.x === 5 && b.z === 3), 'attaché x=5 (façade)');
  // murs latéraux au z=3 et z=8 (les bords de la saillie)
  assert.ok(a.some((b) => b.z === 3 && b.x === 4 && b.y === 2), 'mur lateral z=3');
  assert.ok(a.some((b) => b.z === 8 && b.x === 4 && b.y === 2), 'mur lateral z=8');
});

test('avantCorps : saillie correcte pour façade est', () => {
  const a = avantCorps({ facade: 'est', x1: 3, x2: 8, z_facade: 5, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'cobblestone' });
  assert.ok(a.some((b) => b.x === 6 && b.y === 2), 'saillie x=6');
});

test('baie illumine=true : PAS de bloc directement derrière la vitre (visible depuis dehors)', () => {
  const b = baie({ facade: 'nord', x1: 2, x2: 4, z1: 0, z2: 0, y1: 2, y2: 3, encadrement: 'oak_log', illumine: true });
  // Aucun bloc derrière la vitre au même y (visible en transparence)
  for (let x = 2; x <= 4; x++) for (let y = 2; y <= 3; y++) {
    const blockerDerriere = b.find((k) => k.x === x && k.y === y && k.z === 1);
    assert.ok(!blockerDerriere || blockerDerriere.block === 'air',
      `bloc derrière la vitre visible à x=${x} y=${y} : ${blockerDerriere?.block}`);
  }
  // mais un glowstone en HAUTEUR au-dessus du linteau, invisible depuis dehors
  const glow = b.find((k) => k.block === 'glowstone');
  assert.ok(glow, 'source lumineuse attendue');
});

test('primitives dérivant _stairs : erreur claire si smooth_stone (pas de stairs)', () => {
  const msg = /smooth_stone.*n'a pas.*stairs|_stairs.*n'existe/i;
  assert.throws(() => escalier({ x: 0, z: 0, y_bas: 0, y_haut: 4, facing: 'east', materiau: 'smooth_stone' }), msg);
  assert.throws(() => perron({ x: 0, z: 0, y0: 0, largeur: 3, marches: 2, materiau: 'smooth_stone', facing: 'north' }), msg);
  assert.throws(() => toitDeuxPans({ x1: 0, z1: 0, x2: 5, z2: 5, y_base: 0, faitage: 'x', materiau: 'smooth_stone' }), msg);
  assert.throws(() => toitQuatrePans({ x1: 0, z1: 0, x2: 5, z2: 5, y_base: 0, materiau: 'smooth_stone' }), msg);
});

test('primitives dérivant _stairs : materiau bois valide passe (oak → oak_stairs)', () => {
  const e = escalier({ x: 0, z: 0, y_bas: 0, y_haut: 4, facing: 'east', materiau: 'oak' });
  assert.ok(e.some((b) => /oak_stairs/.test(b.block)));
});

test('escalier / perron : acceptent le facing en français (nord/sud/est/ouest)', () => {
  const e = escalier({ x: 0, z: 0, y_bas: 0, y_haut: 4, facing: 'nord', materiau: 'oak' });
  assert.ok(e.some((b) => /oak_stairs\[facing=north/.test(b.block)));
  const p = perron({ x: 0, z: 0, y0: 0, largeur: 3, marches: 2, materiau: 'oak', facing: 'sud' });
  assert.ok(p.some((b) => /oak_stairs\[facing=south/.test(b.block)));
});

test('escalier + boite empilée : la trémie survit à un plancher au-dessus (ordre concat)', () => {
  // ordre : boite d'abord (plancher à y=5), escalier ensuite (trémie à y=5) → trémie doit gagner
  const b = boite({ x1: 0, z1: 0, x2: 9, z2: 9, y0: 0, y1: 5, murs: 'stone_bricks', fondation: 'cobblestone', plancher: 'oak_planks' });
  const e = escalier({ x: 3, z: 5, y_bas: 0, y_haut: 5, facing: 'east', materiau: 'oak', tremie: true });
  // combine ordre : boite en premier, escalier en second (comme dans les returns du LLM)
  const merged = [...b, ...e];
  // filtre déterministe : à position P, l'air prime
  const dedup = new Map();
  for (const bb of merged) {
    const k = `${bb.x},${bb.y},${bb.z}`;
    const prev = dedup.get(k);
    if (!prev || (bb.block === 'air' && prev.block !== 'air')) dedup.set(k, bb);
  }
  const at = (x, y, z) => [...dedup.values()].find((bb) => bb.x === x && bb.y === y && bb.z === z);
  // la case au-dessus des marches 2/3 (y=5) devrait être AIR (trémie)
  const tremieCells = e.filter((bb) => bb.block === 'air');
  assert.ok(tremieCells.length > 0, 'escalier doit produire des cases air pour la trémie');
  for (const t of tremieCells) {
    const finalAt = at(t.x, t.y, t.z);
    assert.strictEqual(finalAt?.block, 'air', `case trémie (${t.x},${t.y},${t.z}) rebouchée par ${finalAt?.block}`);
  }
});

test('porte hauteur > 2 : tympan plein au-dessus de la porte battante (pas 5 blocs d\'air)', () => {
  const p = porte({ facade: 'sud', x: 3, z: 0, y0: 0, hauteur: 5, materiau: 'stone_bricks' });
  // porte battante à y=1,2 (comme d'habitude)
  assert.ok(p.some((b) => b.y === 1 && /oak_door.*half=lower/.test(b.block)));
  assert.ok(p.some((b) => b.y === 2 && /oak_door.*half=upper/.test(b.block)));
  // AU-DESSUS de la porte, matériau plein (tympan), PAS air
  for (let y = 3; y <= 5; y++) {
    const above = p.find((b) => b.y === y && b.z === 0 && b.x === 3);
    assert.strictEqual(above?.block, 'stone_bricks', `y=${y} devrait être stone_bricks, est ${above?.block}`);
  }
  // linteau tout en haut
  assert.strictEqual(p.find((b) => b.y === 6)?.block, 'stone_bricks');
});

// ---- I19 : primitive cheminee ----
const { cheminee } = require('../src/primitives');

test('cheminee : colonne 1x1 entre y_base et y_haut + chapeau au sommet', () => {
  const c = cheminee({ x: 5, z: 5, y_base: 4, y_haut: 10, materiau: 'stone_bricks' });
  // colonne entre y_base et y_haut
  for (let y = 4; y <= 10; y++) {
    const b = c.find((k) => k.x === 5 && k.y === y && k.z === 5);
    assert.ok(b, `bloc y=${y} manquant`);
    assert.strictEqual(b.block, 'stone_bricks');
  }
  // chapeau : slab ou wall au-dessus du sommet
  const cap = c.find((k) => k.x === 5 && k.y === 11 && k.z === 5);
  assert.ok(cap, 'chapeau attendu au-dessus');
  assert.ok(/_slab|_wall/.test(cap.block), `chapeau doit être une slab ou wall : ${cap.block}`);
});

test('cheminee : y_haut <= y_base → erreur', () => {
  assert.throws(() => cheminee({ x: 0, z: 0, y_base: 5, y_haut: 5, materiau: 'bricks' }), /hauteur/i);
});

test('cheminee : materiau manquant → erreur', () => {
  assert.throws(() => cheminee({ x: 0, z: 0, y_base: 0, y_haut: 5 }), /materiau/i);
});

test('toitDeuxPans : matériau de maçonnerie (stone_brick) — pignons pleins avec le materiau, stairs existent', () => {
  const t = toitDeuxPans({ x1: 0, z1: 0, x2: 6, z2: 6, y_base: 4, faitage: 'x', materiau: 'stone_brick' });
  // AUCUN bloc stone_brick_planks (n'existe pas)
  assert.ok(!t.some((b) => b.block === 'stone_brick_planks'), `stone_brick_planks présent : ${t.find(b => b.block === 'stone_brick_planks')}`);
  // pignons pleins avec stone_bricks (pluriel — vrai nom du bloc)
  const pignon = t.find((b) => b.x === 0 && b.block === 'stone_bricks');
  assert.ok(pignon, 'pignon en stone_bricks attendu');
  // stairs correctement dérivés (stone_brick_stairs existe)
  assert.ok(t.some((b) => /stone_brick_stairs/.test(b.block)));
});

test('toitQuatrePans : deepslate_brick fonctionne (existe stairs+pignon en deepslate_bricks)', () => {
  const t = toitQuatrePans({ x1: 0, z1: 0, x2: 6, z2: 6, y_base: 4, materiau: 'deepslate_brick' });
  assert.ok(!t.some((b) => b.block === 'deepslate_brick_planks'));
  assert.ok(t.some((b) => /deepslate_brick_stairs/.test(b.block)));
});

test('cheminee : matériau au pluriel (stone_bricks) → chapeau stone_brick_slab (singulier, vrai nom)', () => {
  const c = cheminee({ x: 0, z: 0, y_base: 5, y_haut: 8, materiau: 'stone_bricks' });
  const cap = c.find((k) => k.y === 9);
  assert.strictEqual(cap.block, 'stone_brick_slab', `slab attendue au pluriel corrigé, obtenu ${cap.block}`);
});

test('cheminee : bricks → brick_slab (idem)', () => {
  const c = cheminee({ x: 0, z: 0, y_base: 5, y_haut: 8, materiau: 'bricks' });
  assert.strictEqual(c.find((k) => k.y === 9).block, 'brick_slab');
});

test('cheminee : cobblestone → cobblestone_slab (déjà correct)', () => {
  const c = cheminee({ x: 0, z: 0, y_base: 5, y_haut: 8, materiau: 'cobblestone' });
  assert.strictEqual(c.find((k) => k.y === 9).block, 'cobblestone_slab');
});

test('porte double : 2 portes côte à côte (2 blocs de large), facing cohérent', () => {
  const p = porte({ facade: 'sud', x: 5, z: 0, y0: 0, hauteur: 2, materiau: 'stone_bricks', double: true });
  // 4 blocs de porte au total (2 lower + 2 upper à x=5 ET x=6)
  const doors = p.filter((k) => /_door/.test(k.block));
  assert.strictEqual(doors.length, 4);
  const xs = [...new Set(doors.map((k) => k.x))].sort();
  assert.deepStrictEqual(xs, [5, 6]);
  // les 2 battants doivent s'ouvrir vers l'extérieur, symétriquement
  // (hinge=left à gauche, hinge=right à droite — sinon ils se cognent)
  const left = doors.filter((k) => k.x === 5 && /half=lower/.test(k.block))[0];
  const right = doors.filter((k) => k.x === 6 && /half=lower/.test(k.block))[0];
  assert.match(left.block, /hinge=left/);
  assert.match(right.block, /hinge=right/);
});

test('porte double sur facade est : 2 portes empilées sur z (pas sur x)', () => {
  const p = porte({ facade: 'est', x: 8, z: 3, y0: 0, materiau: 'stone', double: true });
  const doors = p.filter((k) => /_door/.test(k.block));
  const zs = [...new Set(doors.map((k) => k.z))].sort();
  assert.deepStrictEqual(zs, [3, 4]);
});

// arche : massif percé d'un tunnel voûté (Arc de Triomphe, portes de ville, aqueducs)
test('arche : massif plein sauf tunnel central en forme d\'arc', () => {
  const a = arche({ x1: 0, z1: 0, x2: 10, z2: 4, y_base: 0, y_faitage: 8, materiau: 'smooth_sandstone', axe: 'x' });
  // le massif doit contenir des blocs pleins ET des blocs stairs (voûte)
  const solid = a.filter((b) => b.block === 'smooth_sandstone');
  const stairs = a.filter((b) => /_stairs\[/.test(b.block));
  assert.ok(solid.length > 0, `pas de blocs pleins : ${a.length} blocs total`);
  assert.ok(stairs.length > 0, `pas de voûte (stairs) : ${a.length} blocs total`);
});

test('arche axe=x : le tunnel traverse selon X (piétons entrent par x1/x2)', () => {
  const a = arche({ x1: 0, z1: 0, x2: 10, z2: 4, y_base: 0, y_faitage: 8, materiau: 'stone_brick', axe: 'x' });
  // au milieu de l'emprise, à hauteur y=1 (au sol, sous la voûte), il doit y avoir de l'AIR
  // (tunnel ouvert traversant : soit air explicite, soit rien — jamais un bloc plein)
  const midX = 5, midZ = 2, midY = 1;
  const hit = a.find((b) => b.x === midX && b.z === midZ && b.y === midY);
  assert.ok(!hit || hit.block === 'air', `attendu air ou absent au centre du tunnel, obtenu : ${hit && hit.block}`);
  // par contre aux extrémités latérales (z=0), y=1 doit être plein (piédroit)
  const pilierGauche = a.find((b) => b.x === midX && b.z === 0 && b.y === 1);
  assert.ok(pilierGauche && pilierGauche.block !== 'air', 'piédroit gauche manquant');
});

test('arche axe=z : le tunnel traverse selon Z', () => {
  const a = arche({ x1: 0, z1: 0, x2: 4, z2: 10, y_base: 0, y_faitage: 8, materiau: 'stone_brick', axe: 'z' });
  const midX = 2, midZ = 5, midY = 1;
  const hit = a.find((b) => b.x === midX && b.z === midZ && b.y === midY);
  assert.ok(!hit || hit.block === 'air', `attendu air ou absent au centre du tunnel, obtenu : ${hit && hit.block}`);
  // piédroit sur x=0 doit exister
  const pilierGauche = a.find((b) => b.x === 0 && b.z === midZ && b.y === 1);
  assert.ok(pilierGauche && pilierGauche.block !== 'air', 'piédroit gauche manquant');
});

test('arche : sommet de la voûte atteint y_faitage-1 (attique posé dessus à y_faitage)', () => {
  const a = arche({ x1: 0, z1: 0, x2: 10, z2: 4, y_base: 0, y_faitage: 10, materiau: 'stone_brick', axe: 'x' });
  const maxY = Math.max(...a.map((b) => b.y));
  // le sommet de l'arche doit être juste en dessous de y_faitage (l'attique se poserait à y_faitage)
  assert.ok(maxY <= 9, `sommet arche y=${maxY} dépasse y_faitage-1=9`);
  assert.ok(maxY >= 7, `sommet arche y=${maxY} trop bas (voûte trop plate)`);
});

test('arche : materiau bois refusé (les stairs de bois seraient incohérents pour un monument)', () => {
  // en pratique le LLM peut passer un bois — arche doit fonctionner (utilise _stairs et _planks)
  // ce test vérifie juste que ça ne crash pas
  const a = arche({ x1: 0, z1: 0, x2: 8, z2: 4, y_base: 0, y_faitage: 6, materiau: 'oak', axe: 'x' });
  assert.ok(a.length > 0);
  const hasStairs = a.some((b) => b.block.includes('oak_stairs'));
  const hasPlanks = a.some((b) => b.block === 'oak_planks');
  assert.ok(hasStairs, 'aucun stair bois pour la voûte');
  assert.ok(hasPlanks, 'aucun bloc plein bois pour les piédroits');
});

test('arche : materiau manquant → throw', () => {
  assert.throws(() => arche({ x1: 0, z1: 0, x2: 8, z2: 4, y_base: 0, y_faitage: 6, axe: 'x' }), /materiau/);
});

test('arche : axe invalide → throw', () => {
  assert.throws(() => arche({ x1: 0, z1: 0, x2: 8, z2: 4, y_base: 0, y_faitage: 6, materiau: 'stone_brick', axe: 'y' }), /axe/);
});

test('arche pose air EXPLICITE dans le tunnel (nécessaire pour écraser une boite postérieure)', () => {
  // Le LLM combine parfois arche() avec une boite() de même emprise ; l'air explicite
  // du tunnel doit survivre au dedup optimizer (priorité air) et effacer les blocs
  // pleins de la boite. Sans air explicite, le tunnel resterait bouché.
  const a = arche({ x1: 0, z1: 0, x2: 10, z2: 4, y_base: 0, y_faitage: 8, materiau: 'stone_brick', axe: 'x' });
  const airBlocks = a.filter((b) => b.block === 'air');
  assert.ok(airBlocks.length > 0, `aucun air explicite posé dans le tunnel (${a.length} blocs total)`);
});

// pyramideTronquee : tronc de pyramide utile pour tours effilées (Tour Eiffel,
// Burj Khalifa), pyramides d'Egypte, toits de temples, obélisques
test('pyramideTronquee : base plus large que sommet, hauteur correcte', () => {
  const p = pyramideTronquee({ x: 20, z: 20, y_base: 0, y_haut: 10, base: 12, sommet: 4, materiau: 'stone_bricks' });
  const ys = [...new Set(p.map((b) => b.y))].sort((a, b) => a - b);
  assert.strictEqual(ys[0], 0);
  assert.strictEqual(ys[ys.length - 1], 9);  // dernier bloc à y=y_haut-1
  // niveau bas : couvre 12×12 environ (centré sur x=20, z=20 → x∈[14..25])
  const bas = p.filter((b) => b.y === 0);
  const xsBas = [...new Set(bas.map((b) => b.x))];
  const zsBas = [...new Set(bas.map((b) => b.z))];
  assert.ok(xsBas.length >= 10 && xsBas.length <= 14, `base X trop étroite/large : ${xsBas.length}`);
  assert.ok(zsBas.length >= 10 && zsBas.length <= 14);
  // niveau haut : couvre ~4×4 (rétréci)
  const haut = p.filter((b) => b.y === 9);
  const xsHaut = [...new Set(haut.map((b) => b.x))];
  assert.ok(xsHaut.length >= 3 && xsHaut.length <= 5, `sommet X mauvais : ${xsHaut.length}`);
});

test('pyramideTronquee : ajouree=false → murs pleins', () => {
  const p = pyramideTronquee({ x: 10, z: 10, y_base: 0, y_haut: 8, base: 8, sommet: 4, materiau: 'stone_bricks', ajouree: false });
  const solid = p.filter((b) => b.block === 'stone_bricks');
  const air = p.filter((b) => b.block === 'air');
  assert.ok(solid.length > 0);
  assert.strictEqual(air.length, 0, 'mode plein ne pose pas d\'air');
});

test('pyramideTronquee : ajouree=true → parois iron_bars, pas de blocs pleins', () => {
  const p = pyramideTronquee({ x: 10, z: 10, y_base: 0, y_haut: 8, base: 8, sommet: 4, materiau: 'stone_bricks', ajouree: true });
  const bars = p.filter((b) => b.block === 'iron_bars');
  const solid = p.filter((b) => b.block === 'stone_bricks');
  assert.ok(bars.length > 0, 'ajouree=true doit poser iron_bars');
  assert.strictEqual(solid.length, 0, 'ajouree=true ne doit PAS poser le materiau plein');
});

test('pyramideTronquee : contour creux (pas rempli) — seulement parois', () => {
  const p = pyramideTronquee({ x: 20, z: 20, y_base: 0, y_haut: 6, base: 10, sommet: 6, materiau: 'stone_bricks' });
  // au centre (x=20, z=20, y=3), il ne doit rien y avoir (intérieur creux)
  const centre = p.find((b) => b.x === 20 && b.z === 20 && b.y === 3);
  assert.strictEqual(centre, undefined, `centre creux attendu, obtenu ${centre && centre.block}`);
});

test('pyramideTronquee : sommet > base → throw (inversé)', () => {
  assert.throws(
    () => pyramideTronquee({ x: 10, z: 10, y_base: 0, y_haut: 8, base: 4, sommet: 12, materiau: 'stone_bricks' }),
    /sommet.*base/
  );
});

test('pyramideTronquee : materiau manquant → throw', () => {
  assert.throws(
    () => pyramideTronquee({ x: 10, z: 10, y_base: 0, y_haut: 8, base: 8, sommet: 4 }),
    /materiau/
  );
});

test('pyramideTronquee : base=sommet → cylindre (tronc droit, dégénéré valide)', () => {
  const p = pyramideTronquee({ x: 10, z: 10, y_base: 0, y_haut: 5, base: 6, sommet: 6, materiau: 'stone_bricks' });
  // toutes les couches ont la même emprise
  const bas = p.filter((b) => b.y === 0);
  const haut = p.filter((b) => b.y === 4);
  assert.strictEqual(bas.length, haut.length, 'base=sommet doit produire des couches identiques');
});

// Connectivité verticale : le contour EXTÉRIEUR de chaque couche doit reposer
// intégralement sur la couche du dessous (remplissage « marche d'escalier »),
// sinon les anneaux rétrécis sont en diagonale et flottent (bug Tour Eiffel en
// iron_bars : strates déconnectées). NB : un appui sous chaque bloc est
// impossible dans un frustum creux (l'anneau intérieur surplombe le vide) —
// l'invariant porte sur les blocs extrémaux de chaque ligne/colonne, qui
// forment exactement le contour extérieur de la couche.
function assertCouchesConnectees(p, label) {
  const parCouche = new Map();
  for (const b of p) {
    if (!parCouche.has(b.y)) parCouche.set(b.y, new Set());
    parCouche.get(b.y).add(`${b.x},${b.z}`);
  }
  const ys = [...parCouche.keys()].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    const dessous = parCouche.get(ys[i - 1]);
    const couche = [...parCouche.get(ys[i])].map((c) => c.split(',').map(Number));
    const parLigne = new Map(); // z → [xs], et x → [zs]
    const parColonne = new Map();
    for (const [cx, cz] of couche) {
      if (!parLigne.has(cz)) parLigne.set(cz, []);
      parLigne.get(cz).push(cx);
      if (!parColonne.has(cx)) parColonne.set(cx, []);
      parColonne.get(cx).push(cz);
    }
    const contourExt = new Set();
    for (const [cz, xs] of parLigne) {
      contourExt.add(`${Math.min(...xs)},${cz}`);
      contourExt.add(`${Math.max(...xs)},${cz}`);
    }
    for (const [cx, zs] of parColonne) {
      contourExt.add(`${cx},${Math.min(...zs)}`);
      contourExt.add(`${cx},${Math.max(...zs)}`);
    }
    for (const c of contourExt) {
      assert.ok(
        dessous.has(c),
        `${label} : contour extérieur (${c}) de la couche y=${ys[i]} sans appui sur y=${ys[i - 1]}`
      );
    }
  }
}

test('pyramideTronquee : le contour extérieur de chaque couche repose sur la précédente', () => {
  const p = pyramideTronquee({ x: 20, z: 20, y_base: 0, y_haut: 10, base: 12, sommet: 4, materiau: 'stone_bricks' });
  assertCouchesConnectees(p, 'frustum droit');
});

test('pyramideTronquee : connectivité verticale même sur pente raide', () => {
  const p = pyramideTronquee({ x: 0, z: 0, y_base: 0, y_haut: 5, base: 20, sommet: 2, materiau: 'sandstone' });
  assertCouchesConnectees(p, 'pente raide');
});

// Frustum incliné : x_sommet/z_sommet font migrer le centre linéairement avec la
// hauteur → 4 pieds convergents pour la Tour Eiffel, contreforts, tours penchées
test('pyramideTronquee inclinée : le sommet est centré sur (x_sommet, z_sommet)', () => {
  const p = pyramideTronquee({
    x: 0, z: 0, x_sommet: 10, z_sommet: 6,
    y_base: 0, y_haut: 12, base: 8, sommet: 3, materiau: 'iron_block',
  });
  const haut = p.filter((b) => b.y === 11);
  const cx = haut.reduce((s, b) => s + b.x, 0) / haut.length;
  const cz = haut.reduce((s, b) => s + b.z, 0) / haut.length;
  assert.ok(Math.abs(cx - 10) <= 1, `centre X du sommet attendu ~10, obtenu ${cx}`);
  assert.ok(Math.abs(cz - 6) <= 1, `centre Z du sommet attendu ~6, obtenu ${cz}`);
  // la base, elle, reste centrée sur (x, z)
  const bas = p.filter((b) => b.y === 0);
  const bx = bas.reduce((s, b) => s + b.x, 0) / bas.length;
  assert.ok(Math.abs(bx - 0) <= 1, `centre X de la base attendu ~0, obtenu ${bx}`);
});

// Invariant « structure jointe à chaque niveau » : l'intersection des empreintes
// (x,z) de deux couches consécutives doit former un anneau FERMÉ qui encercle le
// trou intérieur — chaque couche repose donc sur la précédente tout autour, pas
// seulement sur une ou deux arêtes (bug Tour Eiffel : contact en L, strates en
// diagonale). Valable aussi pour le frustum incliné, dont la face avant
// surplombe par nature (comme les vrais pieds de la Tour Eiffel).
function assertAnneauCommun(p, label) {
  const parCouche = new Map();
  for (const b of p) {
    if (!parCouche.has(b.y)) parCouche.set(b.y, new Set());
    parCouche.get(b.y).add(`${b.x},${b.z}`);
  }
  const ys = [...parCouche.keys()].sort((a, b) => a - b);
  for (let i = 0; i < ys.length - 1; i++) {
    const commun = new Set([...parCouche.get(ys[i])].filter((c) => parCouche.get(ys[i + 1]).has(c)));
    const pts = [...commun].map((c) => c.split(',').map(Number));
    assert.ok(pts.length > 0, `${label} : couches y=${ys[i]}/${ys[i + 1]} sans aucun bloc commun`);
    const xMin = Math.min(...pts.map(([a]) => a)) - 1;
    const xMax = Math.max(...pts.map(([a]) => a)) + 1;
    const zMin = Math.min(...pts.map(([, b]) => b)) - 1;
    const zMax = Math.max(...pts.map(([, b]) => b)) + 1;
    // flood fill du complément depuis l'extérieur : s'il reste une cellule vide
    // non atteinte, l'intersection encercle un trou → anneau fermé
    const atteint = new Set([`${xMin},${zMin}`]);
    const pile = [[xMin, zMin]];
    while (pile.length) {
      const [cx, cz] = pile.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        const k = `${nx},${nz}`;
        if (nx < xMin || nx > xMax || nz < zMin || nz > zMax) continue;
        if (commun.has(k) || atteint.has(k)) continue;
        atteint.add(k);
        pile.push([nx, nz]);
      }
    }
    let enclos = 0;
    for (let cx = xMin; cx <= xMax; cx++) {
      for (let cz = zMin; cz <= zMax; cz++) {
        const k = `${cx},${cz}`;
        if (!commun.has(k) && !atteint.has(k)) enclos++;
      }
    }
    assert.ok(
      enclos > 0,
      `${label} : couches y=${ys[i]}/${ys[i + 1]} — l'intersection n'encercle rien (contact partiel, pas un anneau fermé)`
    );
  }
}

test('pyramideTronquee inclinée : anneau fermé commun entre couches successives', () => {
  const p = pyramideTronquee({
    x: 0, z: 0, x_sommet: 12, z_sommet: 12,
    y_base: 0, y_haut: 24, base: 9, sommet: 3, materiau: 'iron_block',
  });
  assertAnneauCommun(p, 'frustum incliné');
});

test('pyramideTronquee droite : anneau fermé commun entre couches successives', () => {
  const p = pyramideTronquee({ x: 20, z: 20, y_base: 0, y_haut: 10, base: 12, sommet: 4, materiau: 'stone_bricks' });
  assertAnneauCommun(p, 'frustum droit');
});

test('pyramideTronquee : x_sommet/z_sommet omis → comportement centré inchangé', () => {
  const avec = pyramideTronquee({ x: 10, z: 10, x_sommet: 10, z_sommet: 10, y_base: 0, y_haut: 8, base: 8, sommet: 4, materiau: 'stone_bricks' });
  const sans = pyramideTronquee({ x: 10, z: 10, y_base: 0, y_haut: 8, base: 8, sommet: 4, materiau: 'stone_bricks' });
  assert.deepStrictEqual(avec, sans, 'x_sommet=x, z_sommet=z doit être identique au frustum droit');
});

// Normalisation tolérante : le LLM passe souvent le bloc plein (stone_bricks,
// dark_oak_planks) au lieu du préfixe (stone_brick, dark_oak)
test('arche accepte "stone_bricks" (pluriel) et le normalise en stone_brick_stairs', () => {
  const a = arche({ x1: 0, z1: 0, x2: 10, z2: 4, y_base: 0, y_faitage: 8, materiau: 'stone_bricks', axe: 'x' });
  const stairs = a.filter((b) => /stone_brick_stairs\[/.test(b.block));
  assert.ok(stairs.length > 0, `attendu stone_brick_stairs dans la voûte, blocs stairs : ${[...new Set(a.filter((b) => /_stairs/.test(b.block)).map((b) => b.block))]}`);
  // les piédroits utilisent le bloc plein stone_bricks
  const pleins = a.filter((b) => b.block === 'stone_bricks');
  assert.ok(pleins.length > 0);
});

test('toitDeuxPans accepte "dark_oak_planks" et le normalise en dark_oak (stairs + planks)', () => {
  const t = toitDeuxPans({ x1: 0, z1: 0, x2: 8, z2: 6, y_base: 5, faitage: 'x', materiau: 'dark_oak_planks' });
  const stairs = t.filter((b) => /dark_oak_stairs\[/.test(b.block));
  assert.ok(stairs.length > 0, 'attendu dark_oak_stairs');
});

test('escalier accepte "deepslate_tiles" (pluriel) → deepslate_tile_stairs', () => {
  const e = escalier({ x: 2, z: 2, y_bas: 0, y_haut: 4, facing: 'east', materiau: 'deepslate_tiles' });
  const stairs = e.filter((b) => /deepslate_tile_stairs\[/.test(b.block));
  assert.ok(stairs.length > 0, `attendu deepslate_tile_stairs, obtenu : ${[...new Set(e.map((b) => b.block))]}`);
});

test('normalisation : matériau sans variante stairs (brown_terracotta) throw toujours', () => {
  assert.throws(
    () => arche({ x1: 0, z1: 0, x2: 10, z2: 4, y_base: 0, y_faitage: 8, materiau: 'brown_terracotta', axe: 'x' }),
    /n'existe pas/
  );
});

// === Corrections audit 27/07 (CORRECTIONS-primitives_1.md) —
// toutes les primitives nécessaires sont déjà importées plus haut

test('toitPlat : acrotère planks → fence de la même essence (oak_wall n\'existe pas)', () => {
  const t = toitPlat({ x1: 0, z1: 0, x2: 5, z2: 5, y: 4, materiau: 'oak_planks' });
  assert.ok(!t.some((b) => b.block === 'oak_wall'), 'oak_wall n\'existe pas dans Minecraft');
  assert.ok(t.some((b) => b.block === 'oak_fence'), 'attendu oak_fence en acrotère');
  // bricks → brick_wall inchangé, repli cobblestone_wall inchangé
  const tb = toitPlat({ x1: 0, z1: 0, x2: 5, z2: 5, y: 4, materiau: 'stone_bricks' });
  assert.ok(tb.some((b) => b.block === 'stone_brick_wall'));
  const tc = toitPlat({ x1: 0, z1: 0, x2: 5, z2: 5, y: 4, materiau: 'white_concrete' });
  assert.ok(tc.some((b) => b.block === 'cobblestone_wall'));
});

test('arche axe=x : stairs de voûte orientés north/south (jamais east/west)', () => {
  const a = arche({ x1: 0, z1: 0, x2: 10, z2: 6, y_base: 0, y_faitage: 10, materiau: 'stone_brick', axe: 'x' });
  const stairs = a.filter((b) => /_stairs\[/.test(b.block));
  assert.ok(stairs.length > 0, 'la voûte doit contenir des stairs');
  for (const s of stairs) {
    assert.match(s.block, /facing=(north|south)/, `axe=x : facing z attendu, obtenu ${s.block}`);
  }
  // axe=z : east/west (comportement d'origine, conservé)
  const az = arche({ x1: 0, z1: 0, x2: 6, z2: 10, y_base: 0, y_faitage: 10, materiau: 'stone_brick', axe: 'z' });
  for (const s of az.filter((b) => /_stairs\[/.test(b.block))) {
    assert.match(s.block, /facing=(east|west)/, `axe=z : facing x attendu, obtenu ${s.block}`);
  }
});

test('lierre : chaque vine porte sa face d\'accrochage (sinon retirée par le jeu)', () => {
  const v = lierre({ facade: 'nord', x1: 0, x2: 10, z: 0, y1: 1, y2: 5, densite: 1 });
  assert.ok(v.length > 0);
  for (const b of v) {
    assert.match(b.block, /^vine\[(north|south|east|west)=true\]$/, `vine sans accrochage : ${b.block}`);
  }
  // façade nord : le mur porteur est au sud de la vine
  assert.ok(v.every((b) => b.block === 'vine[south=true]'), `attendu vine[south=true], obtenu ${v[0].block}`);
});

test('porte : essence dérivée du materiau (spruce_log → spruce_door, repli oak)', () => {
  const ps = porte({ facade: 'sud', x: 3, z: 0, y0: 0, materiau: 'spruce_log' });
  assert.ok(ps.some((b) => /^spruce_door\[/.test(b.block)), 'attendu spruce_door');
  const pd = porte({ facade: 'sud', x: 3, z: 0, y0: 0, materiau: 'dark_oak_log' });
  assert.ok(pd.some((b) => /^dark_oak_door\[/.test(b.block)), 'dark_oak avant oak (préfixe le plus long)');
  assert.ok(!pd.some((b) => /^oak_door\[/.test(b.block)), 'PAS oak_door pour du dark_oak');
  const pp = porte({ facade: 'sud', x: 3, z: 0, y0: 0, materiau: 'stone_bricks' });
  assert.ok(pp.some((b) => /^oak_door\[/.test(b.block)), 'repli oak_door pour un matériau non bois');
});
