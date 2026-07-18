const { test } = require('node:test');
const assert = require('node:assert');
const { cleanTriangles } = require('../src/meshclean');

function tri(x, y, z, s = 1, color = null) {
  return { a: [x, y, z], b: [x + s, y, z], c: [x, y, z + s], color };
}

function grid(x0, y0, z0, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(tri(x0 + (i % 10) * 1.0, y0, z0 + Math.floor(i / 10) * 1.0));
  return out;
}

test('retire une petite composante déconnectée', () => {
  const main = grid(0, 0, 0, 100);           // grande nappe connexe (sommets partagés)
  const junk = [tri(500, 500, 500), tri(500.5, 500, 500)]; // 2 % isolés et lointains
  const { triangles, removed } = cleanTriangles([...main, ...junk]);
  assert.strictEqual(removed, 2);
  assert.ok(triangles.every((t) => t.a[0] < 100));
});

test('le crop percentile resserre la boîte malgré un débris intégré', () => {
  const main = grid(0, 0, 0, 200);
  // débris CONNECTÉ en hauteur (relié par un sommet) : la composante ne le retire pas,
  // le crop des centroïdes oui
  const spike = [{ a: [0, 0, 0], b: [0, 300, 0], c: [1, 300, 0], color: null }];
  const { triangles } = cleanTriangles([...main, ...spike]);
  const maxY = Math.max(...triangles.map((t) => Math.max(t.a[1], t.b[1], t.c[1])));
  assert.ok(maxY < 100, `boîte non resserrée : maxY=${maxY}`);
});

test('sans débris : rien de retiré', () => {
  const main = grid(0, 0, 0, 50);
  const { triangles, removed } = cleanTriangles(main);
  assert.strictEqual(removed, 0);
  assert.strictEqual(triangles.length, 50);
});
