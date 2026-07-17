const express = require('express');
const multer = require('multer');

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

function createWebServer({ onPhoto }) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED.has(file.mimetype)) cb(null, true);
      else cb(new Error('format non supporté (JPEG, PNG, WebP uniquement)'));
    }
  });

  app.get('/upload/:username', (req, res) => {
    const username = String(req.params.username).replace(/[^A-Za-z0-9_]/g, '');
    res.send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Photo Builder</title></head>
<body>
  <h1>Envoyer une photo pour ${username}</h1>
  <form method="post" action="/build-from-photo" enctype="multipart/form-data">
    <input type="hidden" name="username" value="${username}">
    <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required>
    <button type="submit">Construire !</button>
  </form>
</body></html>`);
  });

  app.post('/build-from-photo', (req, res) => {
    upload.single('photo')(req, res, async (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message });
      if (!req.file) return res.status(400).json({ ok: false, error: 'aucune image reçue' });
      if (!req.body.username) return res.status(400).json({ ok: false, error: 'pseudo manquant' });
      try {
        console.log(`[web] image reçue de ${req.body.username} (${req.file.size} octets, ${req.file.mimetype})`);
        const message = await onPhoto(req.body.username, req.file.buffer, req.file.mimetype);
        res.json({ ok: true, message: message || 'photo reçue, analyse en cours' });
      } catch (e) {
        console.error('[web] erreur pipeline :', e.message);
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  });

  return app;
}

module.exports = { createWebServer };
