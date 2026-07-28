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

test('mode=diorama route vers onDiorama', async () => {
  let called = null;
  const app = createWebServer({
    onPhoto: async () => { called = 'photo'; },
    onDiorama: async () => { called = 'diorama'; return 'ok'; },
    onModel: async () => { called = 'model'; }
  });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('mode', 'diorama');
  fd.append('photo', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'x.jpg');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(called, 'diorama');
  server.close();
});

test('fichier .obj route vers onModel avec l\'extension', async () => {
  let got = null;
  const app = createWebServer({
    onPhoto: async () => {},
    onDiorama: async () => {},
    onModel: async (u, buf, ext) => { got = { u, size: buf.length, ext }; return 'modèle reçu'; }
  });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('photo', new Blob(['v 0 0 0'], { type: 'application/octet-stream' }), 'cube.obj');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(got, { u: 'Steve', size: 7, ext: 'obj' });
  server.close();
});

test('image de plus de 5 Mo → 400, modèle de 6 Mo accepté', async () => {
  const app = createWebServer({ onPhoto: async () => {}, onDiorama: async () => {}, onModel: async () => 'ok' });
  const server = await listen(app);
  const big = Buffer.alloc(6 * 1024 * 1024, 1);
  const fd1 = new FormData();
  fd1.append('username', 'Steve');
  fd1.append('photo', new Blob([big], { type: 'image/jpeg' }), 'gros.jpg');
  const r1 = await post(server.address().port, fd1);
  assert.strictEqual(r1.status, 400);
  const fd2 = new FormData();
  fd2.append('username', 'Steve');
  fd2.append('photo', new Blob([big], { type: 'application/octet-stream' }), 'gros.stl');
  const r2 = await post(server.address().port, fd2);
  assert.strictEqual(r2.status, 200);
  server.close();
});

test('le formulaire diorama contient le champ mode', async () => {
  const app = createWebServer({ onPhoto: async () => {}, onDiorama: async () => {}, onModel: async () => {} });
  const server = await listen(app);
  const res = await fetch(`http://localhost:${server.address().port}/upload/Steve?mode=diorama`);
  const html = await res.text();
  assert.match(html, /name="mode" value="diorama"/);
  assert.match(html, /\.obj/);
  server.close();
});

test('mode statue routé vers onModel avec le mode', async () => {
  let got = null;
  const app = createWebServer({
    onPhoto: async () => {}, onDiorama: async () => {},
    onModel: async (u, buf, ext, mode) => { got = { ext, mode }; return 'ok'; }
  });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('mode', 'statue');
  fd.append('photo', new Blob(['v 0 0 0'], { type: 'application/octet-stream' }), 'sonic.obj');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(got, { ext: 'obj', mode: 'statue' });
  server.close();
});

test('le formulaire statue est servi', async () => {
  const app = createWebServer({ onPhoto: async () => {}, onDiorama: async () => {}, onModel: async () => {} });
  const server = await listen(app);
  const res = await fetch(`http://localhost:${server.address().port}/upload/Steve?mode=statue`);
  assert.match(await res.text(), /name="mode" value="statue"/);
  server.close();
});

test('image en mode portrait routée vers onPortrait', async () => {
  let called = null;
  const app = createWebServer({
    onPhoto: async () => { called = 'photo'; }, onDiorama: async () => { called = 'diorama'; },
    onModel: async () => { called = 'model'; }, onPortrait: async () => { called = 'portrait'; return 'ok'; }
  });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('mode', 'portrait');
  fd.append('photo', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'moi.jpg');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(called, 'portrait');
  server.close();
});


test('mode=schema route vers onSchema', async () => {
  let called = null;
  const app = createWebServer({
    onPhoto: async () => 'photo',
    onDiorama: async () => 'diorama',
    onModel: async () => 'model',
    onPortrait: async () => 'portrait',
    onSchema: async () => { called = 'schema'; return 'ok schema'; }
  });
  const server = app.listen(0);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('mode', 'schema');
  fd.append('photo', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'x.jpg');
  const res = await fetch(`http://localhost:${server.address().port}/build-from-photo`, { method: 'POST', body: fd });
  const body = await res.json();
  server.close();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(called, 'schema');
});

// === Corrections audit 27/07 (CORRECTIONS-webserver.md) : sécurité ===

test('POST : username assaini avant d\'atteindre le handler (anti-injection commande MC)', async () => {
  let received = null;
  const app = createWebServer({ onPhoto: async (username) => { received = username; return 'ok'; } });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', '/give @p diamond 64');
  fd.append('photo', new Blob([Buffer.from([1, 2, 3])], { type: 'image/jpeg' }), 'p.jpg');
  const res = await post(server.address().port, fd);
  server.close();
  // deux issues acceptables : 400, OU pseudo assaini SANS slash ni espace
  if (res.status === 200) {
    assert.strictEqual(received, 'givepdiamond64', `pseudo non assaini : ${received}`);
    assert.ok(!/[/@ ]/.test(received), 'aucun caractère de commande ne doit subsister');
  } else {
    assert.strictEqual(res.status, 400);
  }
});

test('POST : username vide après assainissement → 400', async () => {
  const app = createWebServer({ onPhoto: async () => 'ok' });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', '/@#$%'); // ne laisse rien après nettoyage
  fd.append('photo', new Blob([Buffer.from([1, 2, 3])], { type: 'image/jpeg' }), 'p.jpg');
  const res = await post(server.address().port, fd);
  server.close();
  assert.strictEqual(res.status, 400);
});

test('POST : username tronqué à 16 caractères (limite pseudo Minecraft)', async () => {
  let received = null;
  const app = createWebServer({ onPhoto: async (username) => { received = username; return 'ok'; } });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'A'.repeat(40));
  fd.append('photo', new Blob([Buffer.from([1, 2, 3])], { type: 'image/jpeg' }), 'p.jpg');
  const res = await post(server.address().port, fd);
  server.close();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(received.length, 16);
});
