const { test } = require('node:test');
const assert = require('node:assert');
const { createWebServer } = require('../src/webserver');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function post(port, formData) {
  return fetch(`http://localhost:${port}/build-from-photo`, { method: 'POST', body: formData });
}

test('GET /upload/:username sert le formulaire', async () => {
  const app = createWebServer({ onPhoto: async () => {} });
  const server = await listen(app);
  const res = await fetch(`http://localhost:${server.address().port}/upload/Steve`);
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.match(html, /Steve/);
  assert.match(html, /build-from-photo/);
  server.close();
});

test('POST avec image valide appelle onPhoto', async () => {
  let received = null;
  const app = createWebServer({
    onPhoto: async (username, buffer, mimeType) => { received = { username, size: buffer.length, mimeType }; return 'analyse lancée'; }
  });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('photo', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'maison.jpg');
  const res = await post(server.address().port, fd);
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(received, { username: 'Steve', size: 3, mimeType: 'image/jpeg' });
  server.close();
});

test('POST sans fichier répond 400', async () => {
  const app = createWebServer({ onPhoto: async () => {} });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 400);
  server.close();
});

test('POST avec type non-image répond 400', async () => {
  const app = createWebServer({ onPhoto: async () => {} });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('photo', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 400);
  server.close();
});
