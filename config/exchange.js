// Centralized exchange rate configuration
// USD to Naira conversion

const DEFAULT_RATE = 1500;

function getRate() {
  const rate = Number(process.env.USD_TO_NAIRA_RATE || DEFAULT_RATE);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('USD_TO_NAIRA_RATE must be a positive number');
  }

  return rate;
}

function convertToNaira(amountUsd) {
  return Math.round(Number(amountUsd || 0) * getRate());
}

function convertToUsd(amountNaira) {
  return parseFloat(((Number(amountNaira || 0) / getRate())).toFixed(6));
}

module.exports = {
  getRate,
  convertToNaira,
  convertToUsd,
  DEFAULT_RATE
};
