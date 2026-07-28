const { test } = require('node:test');
const assert = require('node:assert');
const { parseModel } = require('../src/mesh');

const CUBE_OBJ = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
usemtl rouge
f 1 2 3 4
`;

test('OBJ : quad triangulé en éventail, couleur null, warning MTL', async () => {
  const { triangles, warning } = await parseModel(Buffer.from(CUBE_OBJ), 'obj');
  assert.strictEqual(triangles.length, 2);
  assert.deepStrictEqual(triangles[0].a, [0, 0, 0]);
  assert.deepStrictEqual(triangles[1].c, [0, 1, 0]);
  assert.strictEqual(triangles[0].color, null);
  assert.match(warning, /MTL/);
});

test('STL binaire : un triangle', async () => {
  const buf = Buffer.alloc(84 + 50);
  buf.writeUInt32LE(1, 80); // 1 triangle
  const base = 84 + 12;     // saute la normale
  const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  verts.forEach((v, vi) => v.forEach((c, ci) => buf.writeFloatLE(c, base + vi * 12 + ci * 4)));
  const { triangles } = await parseModel(buf, 'stl');
  assert.strictEqual(triangles.length, 1);
  assert.deepStrictEqual(triangles[0].b, [1, 0, 0]);
  assert.strictEqual(triangles[0].color, null);
});

test('STL ascii : un triangle', async () => {
  const ascii = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 2 0 0
vertex 0 2 0
endloop
endfacet
endsolid t`;
  const { triangles } = await parseModel(Buffer.from(ascii), 'stl');
  assert.strictEqual(triangles.length, 1);
  assert.deepStrictEqual(triangles[0].c, [0, 2, 0]);
});

function makeGLB() {
  // 1 triangle indexé, matériau rouge
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const json = {
    asset: { version: '2.0' },
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 }
    ],
    buffers: [{ byteLength: binPad.length }]
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // magic "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPad.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPad.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN"
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binPad]);
}

test('GLB : triangle indexé avec couleur du matériau', async () => {
  const { triangles } = await parseModel(makeGLB(), 'glb');
  assert.strictEqual(triangles.length, 1);
  assert.deepStrictEqual(triangles[0].a, [0, 0, 0]);
  assert.deepStrictEqual(triangles[0].color, [255, 0, 0]);
});

test('fichier illisible → erreur claire', async () => {
  await assert.rejects(() => parseModel(Buffer.from('n\'importe quoi'), 'glb'), /GLB invalide/);
});

test('STL binaire avec en-tête commençant par "solid" reste binaire', async () => {
  const buf = Buffer.alloc(84 + 50);
  buf.write('solid facet exported by cad', 0, 'ascii'); // en-tête trompeur
  buf.writeUInt32LE(1, 80);
  const base = 84 + 12;
  const verts = [[0, 0, 0], [3, 0, 0], [0, 3, 0]];
  verts.forEach((v, vi) => v.forEach((c, ci) => buf.writeFloatLE(c, base + vi * 12 + ci * 4)));
  const { triangles } = await parseModel(buf, 'stl');
  assert.strictEqual(triangles.length, 1);
  assert.deepStrictEqual(triangles[0].b, [3, 0, 0]);
});

function makeTexturedGLB(pngBuffer, { specGloss = false, alphaZero = false } = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); // 36 o, view 0
  const uvs = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);    // 24 o, view 1 @36
  const indices = new Uint16Array([0, 1, 2]);                       // 6 o, view 2 @60
  let bin = Buffer.concat([
    Buffer.from(positions.buffer), Buffer.from(uvs.buffer), Buffer.from(indices.buffer)
  ]);
  const pngOffset = bin.length + ((4 - (bin.length % 4)) % 4);      // aligné → view 3
  bin = Buffer.concat([bin, Buffer.alloc(pngOffset - bin.length), pngBuffer]);
  bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const json = {
    asset: { version: '2.0' },
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [specGloss
      ? { extensions: { KHR_materials_pbrSpecularGlossiness: { diffuseTexture: { index: 0 }, diffuseFactor: [1, 1, 1, alphaZero ? 0 : 1] } } }
      : alphaZero
        ? { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 0] } }
        : { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 3, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 6 },
      { buffer: 0, byteOffset: pngOffset, byteLength: pngBuffer.length }
    ],
    buffers: [{ byteLength: bin.length }]
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]);
}

test('GLB : couleur échantillonnée dans la texture (baseColorTexture + UV)', async () => {
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  const { triangles } = await parseModel(makeTexturedGLB(png), 'glb');
  assert.strictEqual(triangles.length, 1);
  assert.deepStrictEqual(triangles[0].color, [255, 0, 0]);
});

function makeStripGLB(colorPerVertex) {
  // 4 sommets → TRIANGLE_STRIP (mode 5) = 2 triangles ; COLOR_0 float VEC3 optionnel
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  const colors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]); // rouge
  let bin = Buffer.from(positions.buffer);
  const colorOffset = bin.length;
  if (colorPerVertex) bin = Buffer.concat([bin, Buffer.from(colors.buffer)]);
  bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const attributes = { POSITION: 0 };
  const accessors = [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }];
  const bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: 48 }];
  if (colorPerVertex) {
    attributes.COLOR_0 = 1;
    accessors.push({ bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' });
    bufferViews.push({ buffer: 0, byteOffset: colorOffset, byteLength: 48 });
  }
  const json = {
    asset: { version: '2.0' },
    meshes: [{ primitives: [{ attributes, mode: 5 }] }],
    accessors, bufferViews,
    buffers: [{ byteLength: bin.length }]
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

test('GLB TRIANGLE_STRIP triangulé (2 triangles depuis 4 sommets)', async () => {
  const { triangles } = await parseModel(makeStripGLB(false), 'glb');
  assert.strictEqual(triangles.length, 2);
  assert.deepStrictEqual(triangles[0].a, [0, 0, 0]);
  assert.deepStrictEqual(triangles[1].c, [1, 1, 0]);
});

test('GLB COLOR_0 par sommet lu comme couleur de triangle', async () => {
  const { triangles } = await parseModel(makeStripGLB(true), 'glb');
  assert.deepStrictEqual(triangles[0].color, [255, 0, 0]);
});

test('GLB specularGlossiness : diffuseTexture échantillonnée', async () => {
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 200, b: 0 } } }).png().toBuffer();
  const { triangles } = await parseModel(makeTexturedGLB(png, { specGloss: true }), 'glb');
  assert.strictEqual(triangles.length, 1);
  assert.deepStrictEqual(triangles[0].color, [0, 200, 0]);
});

test('GLB matériau alpha 0 : géométrie invisible ignorée', async () => {
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
  const { triangles } = await parseModel(makeTexturedGLB(png, { alphaZero: true }), 'glb');
  assert.strictEqual(triangles.length, 0);
});

// === Corrections audit 27/07 (CORRECTIONS-mesh.md) ===
const mesh = require('../src/mesh');

test('parseSTL : buffer tronqué (< 84 o) → erreur claire, pas de RangeError', async () => {
  await assert.rejects(() => parseModel(Buffer.alloc(50), 'stl'), /STL invalide ou tronqué/);
});

test('parseSTL : compteur mensonger (annonce 1000 triangles, buffer pour 1) → lit ce qui existe', async () => {
  const buf = Buffer.alloc(84 + 50); // place pour 1 triangle
  buf.writeUInt32LE(1000, 80);       // mais en annonce 1000
  const base = 84 + 12;
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((v, vi) => v.forEach((c, ci) => buf.writeFloatLE(c, base + vi * 12 + ci * 4)));
  const { triangles } = await parseModel(buf, 'stl');
  assert.strictEqual(triangles.length, 1); // pas de crash, on lit le triangle réel
});

test('parseOBJ : face aux sommets manquants ignorée + warning', async () => {
  const obj = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 99\n'; // 99 hors bornes
  const { triangles, warning } = await parseModel(Buffer.from(obj), 'obj');
  assert.strictEqual(triangles.length, 1, 'seule la face valide est conservée');
  assert.match(warning, /face\(s\) avec sommets manquants/);
});

test('helpers mat4 exportés : nodeLocalMatrix + mat4TransformPoint (translation)', () => {
  assert.strictEqual(typeof mesh.nodeLocalMatrix, 'function');
  const m = mesh.nodeLocalMatrix({ translation: [10, 0, 0] });
  assert.deepStrictEqual(mesh.mat4TransformPoint(m, 1, 2, 3), [11, 2, 3]);
});

test('helpers mat4 : rotation quart de tour autour Y', () => {
  const m = mesh.nodeLocalMatrix({ rotation: [0, 0.7071068, 0, 0.7071068] });
  const [x, y, z] = mesh.mat4TransformPoint(m, 1, 0, 0);
  assert.ok(Math.abs(x - 0) < 1e-4, `x≈0, obtenu ${x}`);
  assert.ok(Math.abs(y - 0) < 1e-4, `y≈0, obtenu ${y}`);
  assert.ok(Math.abs(z - (-1)) < 1e-4, `z≈-1, obtenu ${z}`);
});

// GLB à deux nodes translatés : le mesh doit être placé selon le graphe de scène
function makeTwoNodeGLB() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0 },                              // à l'origine
      { mesh: 0, translation: [100, 0, 0] }     // décalé de +100 en x
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 }
    ],
    buffers: [{ byteLength: binPad.length }]
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPad.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, binPad]);
}

test('parseGLB : transforms du graphe de scène appliqués (2 nodes, un translaté)', async () => {
  const { triangles } = await parseModel(makeTwoNodeGLB(), 'glb');
  assert.strictEqual(triangles.length, 2, '2 instances du mesh (une par node)');
  const xs = triangles.flatMap((t) => [t.a[0], t.b[0], t.c[0]]);
  assert.ok(xs.some((x) => x >= 100), 'le node translaté doit décaler la géométrie de +100 en x');
  assert.ok(xs.some((x) => x < 100), 'le node à l\'origine reste près de 0');
});
