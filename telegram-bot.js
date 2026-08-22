const { Telegraf } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.BASE_URL || process.env.PUBLIC_URL || 'http://localhost:5000';

function startTelegramBot() {
  if (!BOT_TOKEN) {
    console.warn('⚠️ BOT_TOKEN is not set. Telegram bot will not start.');
    return null;
  }

  const bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    const firstName = ctx.from && ctx.from.first_name ? ctx.from.first_name : 'User';
    return ctx.reply(
      `🎉 Welcome to Watch2Earn, ${firstName}!

Here's what you can do:
/claim - Claim 10 coins (₦1500 or ~$1)
/help - Get help

Start claiming coins now!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Claim Coins', callback_data: 'claim_coins' }],
          ],
        },
      },
    );
  });

  bot.command('connect', (ctx) => {
    const text = (ctx.message && ctx.message.text) || '';
    const token = text.split(/\s+/).slice(1).join(' ').trim();

    if (!token) {
      return ctx.reply('Usage: /connect <your_firebase_id_token>');
    }

    if (!ctx.session) ctx.session = {};
    ctx.session.idToken = token;
    return ctx.reply('✅ Your Firebase token is saved for this chat. Use /claim to claim the bonus.');
  });

  bot.command('claim', async (ctx) => {
    const idToken = ctx.session && ctx.session.idToken ? ctx.session.idToken : null;
    if (!idToken) {
      return ctx.reply('Please connect your account first using /connect <firebase_id_token>.');
    }

    try {
      const response = await axios.get(`${APP_BASE_URL}/claim`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      const message = response && response.data && response.data.message
        ? response.data.message
        : '✅ Claim successful!';

      return ctx.reply(message);
    } catch (error) {
      const apiError =
        error && error.response && error.response.data && error.response.data.error
          ? error.response.data.error
          : error.message || 'Unknown error';
      return ctx.reply(`Error claiming coins: ${apiError}`);
    }
  });

  bot.help((ctx) => {
    return ctx.reply('Available commands:\n/start - welcome\n/connect <firebase_id_token> - link your account\n/claim - claim Telegram bonus');
  });

  bot.launch({ dropPendingUpdates: true }).catch((error) => {
    console.error('Telegram bot failed to start:', error && error.message ? error.message : error);
  });

  return bot;
}

module.exports = { startTelegramBot };

if (require.main === module) {
  startTelegramBot();
}