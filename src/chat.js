const { rotateY, rotateX } = require('./support');
const memory = require('./memory');

// Applique une rotation à la proposition ; si elle a un socle, seul le corps tourne
// et le socle est régénéré à plat sous la nouvelle emprise
function transformProposal(prop, fn) {
  if (!prop.socle) {
    prop.blocks = fn(prop.blocks);
    return;
  }
  const { h, block, margin } = prop.socle;
  const body = prop.blocks.filter((b) => b.y >= h).map((b) => ({ ...b, x: b.x - margin, y: b.y - h, z: b.z - margin }));
  const turned = fn(body).map((b) => ({ ...b, x: b.x + margin, y: b.y + h, z: b.z + margin }));
  let maxX = 0;
  let maxZ = 0;
  for (const b of turned) {
    maxX = Math.max(maxX, b.x);
    maxZ = Math.max(maxZ, b.z);
  }
  const socle = [];
  for (let x = 0; x <= maxX + margin; x++) {
    for (let z = 0; z <= maxZ + margin; z++) {
      for (let y = 0; y < h; y++) socle.push({ x, y, z, block });
    }
  }
  prop.blocks = socle.concat(turned);
}

function sizeOf(blocks) {
  const s2 = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    s2.x = Math.max(s2.x, b.x + 1);
    s2.y = Math.max(s2.y, b.y + 1);
    s2.z = Math.max(s2.z, b.z + 1);
  }
  return s2;
}

function createChatHandler({ bot, builder, config, pending, tpDelayMs = 1500, onBuild }) {
  const lastBuilt = new Map(); // pseudo (minuscules) → dernière proposition construite
  const lastBuildId = new Map(); // pseudo (minuscules) → buildId retourné par memory.saveCase
  return function handle(username, message) {
    if (username === bot.username) return;
    try {
      const cmd = message.trim();

      if (cmd === '!help') {
        bot.chat('Commandes : !photo !schema !diorama !statue !portrait (upload) · !build <texte> · !go !cancel · !tourner !redresser · !status !undo · !note 1-5 · !help');
        return;
      }

      if (cmd === '!photo') {
        bot.chat(`${username} : envoie ta photo ici → http://${config.web.public_host}:${config.web.port}/upload/${username}`);
        return;
      }

      if (cmd === '!diorama') {
        bot.chat(`${username} : copie conforme (photo ou modèle 3D) → http://${config.web.public_host}:${config.web.port}/upload/${username}?mode=diorama`);
        return;
      }

      if (cmd === '!statue') {
        bot.chat(`${username} : statue fidèle depuis un modèle 3D → http://${config.web.public_host}:${config.web.port}/upload/${username}?mode=statue`);
        return;
      }

      if (cmd === '!portrait') {
        bot.chat(`${username} : fresque pixel-art depuis une photo → http://${config.web.public_host}:${config.web.port}/upload/${username}?mode=portrait`);
        return;
      }

      if (cmd === '!schema') {
        bot.chat(`${username} : bâtiment fidèle depuis la bibliothèque de schemas → http://${config.web.public_host}:${config.web.port}/upload/${username}?mode=schema`);
        return;
      }

      if (cmd.startsWith('!build ') || cmd === '!build') {
        const userText = cmd === '!build' ? '' : cmd.slice(7).trim();
        if (!userText) {
          bot.chat(`${username} : !build attend une description, ex: !build chateau de disney`);
          return;
        }
        if (!onBuild) {
          bot.chat(`${username} : commande !build indisponible dans cet environnement`);
          return;
        }
        Promise.resolve(onBuild(username, userText)).catch((err) => {
          bot.chat(`${username} : erreur !build : ${err.message}`);
        });
        return;
      }

      if (cmd === '!go') {
        const st = builder.status();
        if (st.active) {
          bot.chat(`${username} : une construction est déjà en cours (${st.done}/${st.total}). Attends la fin ou !undo.`);
          return;
        }
        const pkey = username.toLowerCase();
        const p = pending.get(pkey);
        if (!p) { bot.chat(`${username} : aucune proposition en attente. Envoie une photo avec !photo`); return; }
        const launch = (player) => {
          const origin = builder.computeOrigin(player.entity.position, player.entity.yaw, p.size);
          let started;
          try {
            started = builder.startBuild(p.blocks, origin, p.size);
          } catch (err) {
            // Build cassé (optimizer, bloc invalide...) : on consomme la proposition
            // pour éviter une boucle de retry, et on laisse remonter l'erreur.
            pending.delete(pkey);
            throw err;
          }
          if (!started) {
            // Course : la garde chat est passée mais le builder est actif → on restitue
            bot.chat(`${username} : une construction est déjà en cours, réessaie après.`);
            return;
          }
          const { total } = started;
          pending.delete(pkey);
          lastBuilt.set(pkey, { blocks: p.blocks, size: p.size, description: p.description, socle: p.socle, photo: p.photo, code: p.code });
          bot.chat(`Construction de ${p.description.type_batiment} lancée (~${builder.estimateSeconds(total)} s, ${total} commandes). !status pour suivre, !undo pour annuler.`);
          bot.chat(`Emprise : (${origin.x},${origin.z}) → (${origin.x + p.size.x - 1},${origin.z + p.size.z - 1}), centre (${origin.x + Math.floor(p.size.x / 2)},${origin.z + Math.floor(p.size.z / 2)})`);
          // Capture mémoire en arrière-plan (fire-and-forget, ne bloque pas la construction)
          // Guard : seulement si photo ET code sont disponibles (portrait/diorama/statue/model n'en ont pas)
          if (p.photo && p.code) {
            Promise.resolve(memory.saveCase({
              photo: p.photo,
              description: p.description,
              code: p.code
            })).then((buildId) => {
              lastBuildId.set(pkey, buildId);
              console.log(`[chat] cas mémoire enregistré : ${buildId}`);
            }).catch((err) => {
              console.warn('[chat] saveCase échoué :', err.message);
            });
          }
        };
        const player = bot.players[username];
        if (player && player.entity) { launch(player); return; }
        // Joueur hors de portée de suivi : se téléporter vers lui puis réessayer
        bot.chat(`/tp ${bot.username} ${username}`);
        setTimeout(() => {
          try {
            const retry = bot.players[username];
            if (retry && retry.entity) launch(retry);
            else bot.chat(`${username} : je ne te vois pas en jeu.`);
          } catch (err) {
            console.error('[chat] erreur commande :', err);
            bot.chat(`${username} : oups, une erreur est survenue (${err.message})`);
          }
        }, tpDelayMs);
        return;
      }

      if (cmd === '!tourner') {
        const pkey2 = username.toLowerCase();
        let prop = pending.get(pkey2);
        if (!prop && lastBuilt.has(pkey2)) {
          if (builder.undo()) bot.chat('Construction précédente effacée pour rotation...');
          prop = lastBuilt.get(pkey2);
          lastBuilt.delete(pkey2);
        }
        if (!prop) { bot.chat(`${username} : aucune proposition à tourner.`); return; }
        transformProposal(prop, rotateY);
        prop.size = sizeOf(prop.blocks);
        pending.set(pkey2, prop);
        bot.chat(`Proposition pivotée de 90° (${prop.size.x}x${prop.size.z}x${prop.size.y}). !tourner encore ou !go.`);
        return;
      }

      if (cmd === '!redresser') {
        const pk = username.toLowerCase();
        let prop = pending.get(pk);
        if (!prop && lastBuilt.has(pk)) {
          if (builder.undo()) bot.chat('Construction précédente effacée pour redressement...');
          prop = lastBuilt.get(pk);
          lastBuilt.delete(pk);
        }
        if (!prop) { bot.chat(`${username} : aucune proposition à redresser.`); return; }
        transformProposal(prop, rotateX);
        prop.size = sizeOf(prop.blocks);
        pending.set(pk, prop);
        bot.chat(`Proposition redressée (${prop.size.x}x${prop.size.z}x${prop.size.y}). !redresser/!tourner encore, ou !go.`);
        return;
      }

      if (cmd === '!cancel') {
        if (pending.delete(username.toLowerCase())) bot.chat(`${username} : proposition annulée.`);
        else bot.chat(`${username} : rien à annuler.`);
        return;
      }

      if (cmd === '!undo') {
        const mode = builder.undo();
        if (mode === 'flat') bot.chat('Restauration en terrain plat (relief d\'origine non conservé)...');
        else if (mode) bot.chat('Restauration de la zone en cours...');
        else bot.chat('Aucune construction à annuler.');
        return;
      }

      if (cmd === '!status') {
        const s = builder.status();
        if (s.total === 0) bot.chat('Aucune construction en cours.');
        else bot.chat(`Avancement : ${s.done}/${s.total} commandes${s.active ? '' : ' (terminé)'}.`);
        return;
      }

      if (cmd === '!note') {
        bot.chat(`${username} : !note attend une note de 1 à 5, ex : !note 4`);
        return;
      }

      if (cmd.startsWith('!note ')) {
        const n = parseInt(cmd.slice(6).trim(), 10);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          bot.chat(`${username} : note attendue entre 1 et 5, ex : !note 4`);
          return;
        }
        const buildId = lastBuildId.get(username.toLowerCase());
        if (!buildId) {
          bot.chat(`${username} : aucune construction récente à noter`);
          return;
        }
        Promise.resolve(memory.updateNote(buildId, n))
          .then(() => bot.chat(`Note enregistrée : ${n}/5, merci !`))
          .catch((err) => {
            console.warn('[chat] updateNote échoué :', err.message);
            bot.chat(`${username} : impossible d'enregistrer la note, réessaie.`);
          });
        return;
      }
    } catch (err) {
      console.error('[chat] erreur commande :', err);
      bot.chat(`${username} : oups, une erreur est survenue (${err.message})`);
    }
  };
}

module.exports = { createChatHandler };
