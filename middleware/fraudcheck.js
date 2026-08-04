const rateLimit = {};
const MAX_WITHDRAWALS_PER_DAY = 3;

module.exports = (req, res, next) => {
  const uid = req.user.uid;
  const today = new Date().toISOString().slice(0,10);

  if (!rateLimit[uid]) rateLimit[uid] = {};
  if (!rateLimit[uid][today]) rateLimit[uid][today] = 0;

  if (rateLimit[uid][today] >= MAX_WITHDRAWALS_PER_DAY) {
    return res.status(429).json({ error: 'Daily withdrawal limit reached' });
  }

  rateLimit[uid][today] += 1;
  next();
};
