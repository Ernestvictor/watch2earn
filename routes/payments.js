const express = require('express');
const router = express.Router();
const PaymentGateway = require('../config/paymentGateway');

const paymentGateway = new PaymentGateway();

function normalizeAmount(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Amount must be greater than zero.');
  }
  return value;
}

router.get('/config', (req, res) => {
  res.json({
    paystackEnabled: Boolean(process.env.PAYSTACK_SECRET_KEY),
    cryptoEnabled: Boolean(process.env.CRYPTO_API_KEY),
    providers: {
      paystack: Boolean(process.env.PAYSTACK_SECRET_KEY),
      crypto: Boolean(process.env.CRYPTO_API_KEY)
    }
  });
});

router.post('/paystack/init', async (req, res) => {
  try {
    const { userId, amount, email, metadata = {} } = req.body || {};
    const normalizedAmount = normalizeAmount(amount);

    if (!email) {
      return res.status(400).json({ error: 'Email is required to initialize Paystack checkout.' });
    }

    const result = await paymentGateway.initializePaystackPayment(
      userId || 'guest-user',
      normalizedAmount,
      email,
      metadata
    );

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || 'Paystack payment could not be initialized.' });
  }
});

router.post('/paystack/verify', async (req, res) => {
  try {
    const { reference } = req.body || {};

    if (!reference) {
      return res.status(400).json({ success: false, error: 'Reference is required.' });
    }

    const result = await paymentGateway.verifyPaystackPayment(reference);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || 'Paystack payment verification failed.' });
  }
});

router.post('/crypto/init', async (req, res) => {
  try {
    const { userId, amount, currency = 'USD', metadata = {} } = req.body || {};
    const normalizedAmount = normalizeAmount(amount);

    const result = await paymentGateway.initializeCryptoPayment(
      userId || 'guest-user',
      normalizedAmount,
      currency,
      metadata
    );

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || 'Crypto payment could not be initialized.' });
  }
});

router.post('/crypto/verify', async (req, res) => {
  try {
    const { chargeId } = req.body || {};

    if (!chargeId) {
      return res.status(400).json({ success: false, error: 'Charge ID is required.' });
    }

    const result = await paymentGateway.verifyCoinbasePayment(chargeId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || 'Crypto payment verification failed.' });
  }
});

module.exports = router;
