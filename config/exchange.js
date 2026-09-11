// Centralized exchange rate configuration
// USD to Naira conversion

const DEFAULT_RATE = 1500;

// internal cached rate — can be updated at runtime via admin endpoint
let RATE = Number(process.env.USD_TO_NAIRA_RATE || DEFAULT_RATE);

function validateRate(r) {
  const num = Number(r);
  if (!Number.isFinite(num) || num <= 0) throw new Error('USD to Naira rate must be a positive number');
  return Math.round(num);
}

function getRate() {
  if (!Number.isFinite(RATE) || RATE <= 0) throw new Error('USD_TO_NAIRA_RATE is not configured');
  return RATE;
}

function setRate(newRate) {
  RATE = validateRate(newRate);
  // also update process.env for compatibility with other modules relying on env
  process.env.USD_TO_NAIRA_RATE = String(RATE);
  return RATE;
}

function convertToNaira(amountUsd) {
  return Math.round(Number(amountUsd || 0) * getRate());
}

function convertToUsd(amountNaira) {
  return parseFloat(((Number(amountNaira || 0) / getRate())).toFixed(6));
}

module.exports = {
  getRate,
  setRate,
  convertToNaira,
  convertToUsd,
  DEFAULT_RATE
};
