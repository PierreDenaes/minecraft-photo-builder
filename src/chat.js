const { rotateY } = require('./support');

function createChatHandler({ bot, builder, config, pending, tpDelayMs = 1500 }) {
  const lastBuilt = new Map(); // pseudo (minuscules) → dernière proposition construite
  return function handle(username, message) {
    if (username === bot.username) return;
    try {
      const cmd = message.trim();

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

      if (cmd === '!go') {
        const pkey = username.toLowerCase();
        const p = pending.get(pkey);
        if (!p) { bot.chat(`${username} : aucune proposition en attente. Envoie une photo avec !photo`); return; }
        const launch = (player) => {
          pending.delete(pkey);
          lastBuilt.set(pkey, { blocks: p.blocks, size: p.size, description: p.description });
          const origin = builder.computeOrigin(player.entity.position, player.entity.yaw, p.size);
          const { total } = builder.startBuild(p.blocks, origin, p.size);
          bot.chat(`Construction de ${p.description.type_batiment} lancée (~${builder.estimateSeconds(total)} s, ${total} commandes). !status pour suivre, !undo pour annuler.`);
          bot.chat(`Emprise : (${origin.x},${origin.z}) → (${origin.x + p.size.x - 1},${origin.z + p.size.z - 1}), centre (${origin.x + Math.floor(p.size.x / 2)},${origin.z + Math.floor(p.size.z / 2)})`);
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
        prop.blocks = rotateY(prop.blocks);
        prop.size = { x: prop.size.z, y: prop.size.y, z: prop.size.x };
        pending.set(pkey2, prop);
        bot.chat(`Proposition pivotée de 90° (${prop.size.x}x${prop.size.z}x${prop.size.y}). !tourner encore ou !go.`);
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
    } catch (err) {
      console.error('[chat] erreur commande :', err);
      bot.chat(`${username} : oups, une erreur est survenue (${err.message})`);
    }
  };
}

module.exports = { createChatHandler };
