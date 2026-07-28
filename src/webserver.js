const express = require('express');
const multer = require('multer');
const path = require('node:path');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MODEL_EXTS = new Set(['.obj', '.stl', '.glb']);
const IMAGE_MAX = 5 * 1024 * 1024;

function createWebServer({ onPhoto, onDiorama, onModel, onPortrait, onSchema }) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (IMAGE_TYPES.has(file.mimetype) || MODEL_EXTS.has(ext)) cb(null, true);
      else cb(new Error('format non supporté (JPEG, PNG, WebP, OBJ, STL, GLB)'));
    }
  });

  app.get('/upload/:username', (req, res) => {
    const username = String(req.params.username).replace(/[^A-Za-z0-9_]/g, '');
    const mode = ['diorama', 'statue', 'portrait', 'schema'].includes(req.query.mode) ? req.query.mode : '';
    const accept = mode
      ? 'image/jpeg,image/png,image/webp,.obj,.stl,.glb'
      : 'image/jpeg,image/png,image/webp';
    res.send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Photo Builder</title></head>
<body>
  <h1>Envoyer ${mode ? 'une photo ou un modèle 3D' : 'une photo'} pour ${username}</h1>
  <form method="post" action="/build-from-photo" enctype="multipart/form-data">
    <input type="hidden" name="username" value="${username}">
    <input type="hidden" name="mode" value="${mode}">
    <input type="file" name="photo" accept="${accept}" required>
    <button type="submit">Construire !</button>
  </form>
</body></html>`);
  });

  app.post('/build-from-photo', (req, res) => {
    upload.single('photo')(req, res, async (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message });
      if (!req.file) return res.status(400).json({ ok: false, error: 'aucun fichier reçu' });
      // Même règle d'assainissement que le GET + longueur pseudo Minecraft (16).
      // Indispensable : le pseudo finit en tête de bot.chat(...) — un pseudo
      // commençant par "/" ferait exécuter une commande par le bot (op).
      const username = String(req.body.username || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
      if (!username) return res.status(400).json({ ok: false, error: 'pseudo manquant ou invalide' });
      try {
        const ext = path.extname(req.file.originalname).toLowerCase();
        let message;
        if (MODEL_EXTS.has(ext)) {
          console.log(`[web] modèle ${ext} reçu de ${username} (${req.file.size} octets)`);
          message = await onModel(username, req.file.buffer, ext.slice(1), req.body.mode || '');
        } else {
          if (req.file.size > IMAGE_MAX) {
            return res.status(400).json({ ok: false, error: 'image trop lourde (5 Mo max)' });
          }
          console.log(`[web] image reçue de ${username} (${req.file.size} octets, ${req.file.mimetype}, mode=${req.body.mode || 'code'})`);
          const m = req.body.mode;
          message = m === 'diorama' ? await onDiorama(username, req.file.buffer, req.file.mimetype)
            : m === 'portrait' ? await onPortrait(username, req.file.buffer, req.file.mimetype)
            : m === 'schema' ? await onSchema(username, req.file.buffer, req.file.mimetype)
            : await onPhoto(username, req.file.buffer, req.file.mimetype);
        }
        res.json({ ok: true, message: message || 'fichier reçu, analyse en cours' });
      } catch (e) {
        console.error('[web] erreur pipeline :', e.message);
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  });

  return app;
}

module.exports = { createWebServer };
