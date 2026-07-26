const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { reconstruct3D } = require('../src/triposr');

const TMP = path.join(__dirname, '..', 'tmp');

// helper : fabrique un buffer PNG minimal (1x1 rouge)
function pngBuffer() {
  return Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626000020000000500017a11a3d70000000049454e44ae426082', 'hex');
}

test('reconstruct3D : lève une erreur explicite si TripoSR absent (script Python introuvable)', async () => {
  await assert.rejects(
    () => reconstruct3D(pngBuffer(), 'png', { scriptPath: '/introuvable/wrapper.py' }),
    /TripoSR|non installé|introuvable|setup-triposr/i
  );
});

test('reconstruct3D : lève une erreur explicite si le subprocess échoue', async () => {
  await assert.rejects(
    () => reconstruct3D(pngBuffer(), 'png', {
      scriptPath: '/dev/null',
      pythonBin: 'false' // "false" retourne toujours code 1
    }),
    /échec|failed|code/i
  );
});

test('reconstruct3D : succès mocké → retourne le buffer GLB attendu', async () => {
  // On mocke en substituant pythonBin par un script shell qui écrit un GLB bidon
  const mockPy = path.join(TMP, `mock-${process.pid}.sh`);
  const outDir = path.join(TMP, `out-${process.pid}`);
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(path.join(outDir, '0'), { recursive: true });
  fs.writeFileSync(path.join(outDir, '0', 'mesh.glb'), Buffer.from('GLTFBIDON'));
  // Le mock ignore ses args, exit 0
  fs.writeFileSync(mockPy, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(mockPy, 0o755);
  const buf = await reconstruct3D(pngBuffer(), 'png', {
    scriptPath: '/fake/script.py',
    pythonBin: mockPy,
    outputDir: outDir,
    skipScriptCheck: true
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.strictEqual(buf.toString(), 'GLTFBIDON');
  fs.unlinkSync(mockPy);
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('reconstruct3D : timeout dépassé → erreur explicite + nettoyage', async () => {
  // Un python qui bloque : sleep 5
  await assert.rejects(
    () => reconstruct3D(pngBuffer(), 'png', {
      scriptPath: '/fake/script.py',
      pythonBin: 'sleep',
      pythonArgs: ['3'],
      skipScriptCheck: true,
      timeoutMs: 500
    }),
    /timeout|expiré/i
  );
});
