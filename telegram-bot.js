const { Telegraf } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.warn('⚠️  BOT_TOKEN is not set. Telegram bot will not start.');
  module.exports = { startTelegramBot: () => {} };
} else {
  const bot = new Telegraf(BOT_TOKEN);

  // /start command
  bot.start((ctx) => {
    const firstName = ctx.from.first_name || 'User';
    const userId = ctx.from.id;
    
    ctx.reply(
      `🎉 Welcome to Watch2Earn, ${firstName}!

Here's what you can do:
/claim - Claim 10 coins (₦1500 or ~$1)
/help - Get help

Start claiming coins now!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Claim Coins', callback_data: 'claim_coins' }],