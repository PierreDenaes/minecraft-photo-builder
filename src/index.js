const mineflayer = require('mineflayer');
const config = require('../config.json');

function createBot(cfg) {
  const bot = mineflayer.createBot({
    host: cfg.minecraft.host,
    port: cfg.minecraft.port,
    username: cfg.minecraft.username,
    version: cfg.minecraft.version,
    auth: 'offline'
  });
  bot.on('spawn', () => console.log('[bot] connecté et apparu en jeu'));
  bot.on('kicked', (reason) => console.error('[bot] kick:', reason));
  bot.on('error', (err) => console.error('[bot] erreur:', err.message));
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    console.log(`[chat] <${username}> ${message}`);
    if (message === '!ping') bot.chat('pong');
  });
  return bot;
}

if (require.main === module) createBot(config);
module.exports = { createBot };
