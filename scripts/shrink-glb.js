// Allège un GLB trop lourd pour l'upload : garde 1 triangle sur N, réécrit un GLB minimal
// Usage : node scripts/shrink-glb.js <entrée.glb> <sortie.glb> [ratio]
const fs = require('node:fs');
const { parseModel } = require('../src/mesh');

const [, , input, output, ratioArg] = process.argv;
if (!input || !output) {
  console.error('usage : node scripts/shrink-glb.js entrée.glb sortie.glb [1/N gardé, défaut 20]');
  process.exit(1);
}
const N = Number(ratioArg) || 20;

const { triangles } = parseModel(fs.readFileSync(input), 'glb');
const kept = triangles.filter((_, i) => i % N === 0);

const positions = new Float32Array(kept.length * 9);
kept.forEach((t, i) => {
  [t.a, t.b, t.c].forEach((p, vi) => positions.set(p, i * 9 + vi * 3));
});
let bin = Buffer.from(positions.buffer);
bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], positions[i + a]);
    max[a] = Math.max(max[a], positions[i + a]);
  }
}

const json = {
  asset: { version: '2.0' },
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: kept.length * 3, type: 'VEC3', min, max }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
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

fs.writeFileSync(output, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]));
console.log(`${triangles.length} → ${kept.length} triangles, ${(fs.statSync(output).size / 1e6).toFixed(1)} Mo → ${output}`);
