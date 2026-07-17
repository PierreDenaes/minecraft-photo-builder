function createChatHandler({ bot, builder, config, pending }) {
  return function handle(username, message) {
    if (username === bot.username) return;
    try {
      const cmd = message.trim();

      if (cmd === '!photo') {
        bot.chat(`${username} : envoie ta photo ici → http://${config.web.public_host}:${config.web.port}/upload/${username}`);
        return;
      }

      if (cmd === '!go') {
        const p = pending.get(username);
        if (!p) { bot.chat(`${username} : aucune proposition en attente. Envoie une photo avec !photo`); return; }
        const player = bot.players[username];
        if (!player || !player.entity) { bot.chat(`${username} : je ne te vois pas en jeu.`); return; }
        pending.delete(username);
        const origin = builder.computeOrigin(player.entity.position, player.entity.yaw, p.size);
        const { total } = builder.startBuild(p.blocks, origin, p.size);
        bot.chat(`Construction de ${p.description.type_batiment} lancée (~${builder.estimateSeconds(total)} s, ${total} commandes). !status pour suivre, !undo pour annuler.`);
        return;
      }

      if (cmd === '!cancel') {
        if (pending.delete(username)) bot.chat(`${username} : proposition annulée.`);
        else bot.chat(`${username} : rien à annuler.`);
        return;
      }

      if (cmd === '!undo') {
        if (builder.undo()) bot.chat('Restauration de la zone en cours...');
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
