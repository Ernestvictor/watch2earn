const { Telegraf } = require('telegraf');
const axios = require('axios');

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  module.exports = { bot: null };
} else {
  const bot = new Telegraf(botToken);

  bot.start((ctx) => {
    ctx.reply('Welcome to Watch2Earn!\nUse /claim to credit your balance after you finish the task in our Telegram channel.\nJoin: https://t.me/watch2earnnn');
  });

  bot.command('claim', async (ctx) => {
    const idToken = ctx.session && ctx.session.idToken ? ctx.session.idToken : null;
    if (!idToken) {
      return ctx.reply('Please send your Firebase token first with /connect <idToken>.');
    }

    try {
      const appBaseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:5000';
      const response = await axios.get(`${appBaseUrl}/claim`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const message = response.data && response.data.message ? response.data.message : 'Claim successful!';
      return ctx.reply(message);
    } catch (error) {
      const errorText = error && error.response && error.response.data && error.response.data.error
        ? error.response.data.error
        : error.message;
      return ctx.reply(`Error claiming coins: ${errorText}`);
    }
  });

  bot.command('connect', (ctx) => {
    const text = ctx.message && ctx.message.text ? ctx.message.text : '';
    const [, token] = text.split(/\s+/);
    if (!token) {
      return ctx.reply('Usage: /connect <your_firebase_id_token>');
    }

    if (!ctx.session) ctx.session = {};
    ctx.session.idToken = token;
    return ctx.reply('Your Firebase token has been stored for this chat. Use /claim to claim the bonus.');
  });

  bot.launch().catch((err) => {
    console.error('Telegram bot failed to start:', err && err.message ? err.message : err);
  });

  module.exports = { bot };
}
