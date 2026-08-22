// paymentGateway.js
// Unified payment integration for Paystack and Crypto payments

class PaymentGateway {
  constructor(config = {}) {
    this.config = {
      paystack: {
        publicKey: config.paystackPublicKey || process.env.PAYSTACK_PUBLIC_KEY,
        secretKey: config.paystackSecretKey || process.env.PAYSTACK_SECRET_KEY,
        baseUrl: 'https://api.paystack.co'
      },
      crypto: {
        // Crypto gateway configuration (e.g., Coinbase Commerce, BTCPay, etc.)
        apiKey: config.cryptoApiKey || process.env.CRYPTO_API_KEY,
        network: config.cryptoNetwork || 'ethereum',
        provider: config.cryptoProvider || 'coinbase' // coinbase, blockfrost, infura
      },
      webhook: {
        secret: config.webhookSecret || process.env.PAYMENT_WEBHOOK_SECRET,
        url: config.webhookUrl || '/api/webhooks/payment'
      }
    };

    this.paystackInitialized = !!this.config.paystack.secretKey;
    this.cryptoInitialized = !!this.config.crypto.apiKey;
  }

  // ===== PAYSTACK METHODS =====

  /**
   * Initialize Paystack payment
   */
  async initializePaystackPayment(userId, amount, email, metadata = {}) {
    if (!this.paystackInitialized) {
      throw new Error('Paystack is not configured');
    }

    try {
      const response = await fetch(`${this.config.paystack.baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.paystack.secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          amount: Math.round(amount * 100), // Convert to kobo
          metadata: {
            userId,
            userName: metadata.userName,
            ...metadata
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to initialize Paystack payment');
      }

      const data = await response.json();
      return {
        status: 'success',
        paymentUrl: data.data.authorization_url,
        accessCode: data.data.access_code,
        reference: data.data.reference,
        provider: 'paystack'
      };
    } catch (error) {
      console.error('Paystack initialization error:', error);
      throw error;
    }
  }

  /**
   * Verify Paystack payment
   */
  async verifyPaystackPayment(reference) {
    if (!this.paystackInitialized) {
      throw new Error('Paystack is not configured');
    }

    try {
      const response = await fetch(
        `${this.config.paystack.baseUrl}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.paystack.secretKey}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to verify Paystack payment');
      }

      const data = await response.json();
      const transaction = data.data;

      return {
        status: 'success',
        verified: transaction.status === 'success',
        reference,
        amount: transaction.amount / 100, // Convert from kobo
        email: transaction.customer.email,
        metadata: transaction.metadata,
        timestamp: new Date(transaction.paid_at)
      };
    } catch (error) {
      console.error('Paystack verification error:', error);
      throw error;
    }
  }

  /**
   * Get Paystack customer info
   */
  async getPaystackCustomer(email) {
    if (!this.paystackInitialized) {
      throw new Error('Paystack is not configured');
    }

    try {
      const response = await fetch(
        `${this.config.paystack.baseUrl}/customer?identifier=${encodeURIComponent(email)}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.paystack.secretKey}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Customer not found');
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching Paystack customer:', error);
      throw error;
    }
  }

  // ===== CRYPTO PAYMENT METHODS =====

  /**
   * Initialize crypto payment (supports Ethereum, Bitcoin, etc.)
   */
  async initializeCryptoPayment(userId, amount, currency = 'USD', metadata = {}) {
    if (!this.cryptoInitialized) {
      throw new Error('Crypto payments are not configured');
    }

    try {
      if (this.config.crypto.provider === 'coinbase') {
        return await this.initializeCoinbasePayment(userId, amount, currency, metadata);
      } else if (this.config.crypto.provider === 'btcpay') {
        return await this.initializeBTCPayPayment(userId, amount, currency, metadata);
      } else {
        throw new Error('Unsupported crypto provider');
      }
    } catch (error) {
      console.error('Crypto payment initialization error:', error);
      throw error;
    }
  }

  /**
   * Coinbase Commerce integration
   */
  async initializeCoinbasePayment(userId, amount, currency, metadata = {}) {
    try {
      const chargeData = {
        name: `Watch2Earn Payment - ${metadata.userName || userId}`,
        description: `Withdrawal for user ${userId}`,
        pricing_type: 'fixed_price',
        local_price: {
          amount: amount.toString(),
          currency
        },
        metadata: {
          userId,
          ...metadata
        }
      };

      const response = await fetch('https://api.commerce.coinbase.com/charges', {
        method: 'POST',
        headers: {
          'X-CC-Api-Key': this.config.crypto.apiKey,
          'X-CC-Version': '2018-03-22',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(chargeData)
      });

      if (!response.ok) {
        throw new Error('Failed to create Coinbase charge');
      }

      const data = await response.json();

      return {
        status: 'success',
        chargeId: data.data.id,
        paymentUrl: data.data.hosted_url,
        amount,
        currency,
        expiresAt: data.data.expires_at,
        provider: 'coinbase',
        address: data.data.address // Crypto address for payment
      };
    } catch (error) {
      console.error('Coinbase payment error:', error);
      throw error;
    }
  }

  /**
   * BTCPay Server integration
   */
  async initializeBTCPayPayment(userId, amount, currency, metadata = {}) {
    try {
      const invoiceData = {
        price: amount,
        currency,
        orderId: `ORDER-${userId}-${Date.now()}`,
        buyer: {
          name: metadata.userName || 'Customer',
          email: metadata.email
        },
        serverInitiatedUnconfirmed: true,
        buyerNotificationURL: `${process.env.APP_URL}/api/webhooks/btcpay`
      };

      // This would require BTCPay Server setup
      // The actual endpoint depends on your BTCPay Server configuration

      return {
        status: 'success',
        invoiceId: `inv-${Date.now()}`,
        paymentUrl: `${process.env.BTCPAY_SERVER_URL}/invoice?id=${Date.now()}`,
        amount,
        currency,
        provider: 'btcpay'
      };
    } catch (error) {
      console.error('BTCPay payment error:', error);
      throw error;
    }
  }

  /**
   * Verify crypto payment status (Coinbase)
   */
  async verifyCoinbasePayment(chargeId) {
    try {
      const response = await fetch(`https://api.commerce.coinbase.com/charges/${chargeId}`, {
        headers: {
          'X-CC-Api-Key': this.config.crypto.apiKey,
          'X-CC-Version': '2018-03-22'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to verify Coinbase charge');
      }

      const data = await response.json();
      const charge = data.data;

      return {
        status: 'success',
        chargeId,
        paymentStatus: charge.timeline[0].status, // e.g., 'COMPLETED', 'PENDING'
        cryptoAmount: charge.crypto_amount,
        cryptoCurrency: charge.crypto_amount.crypto,
        usdAmount: charge.pricing.local.amount,
        paid: charge.payments && charge.payments.length > 0,
        confirmations: charge.payments?.[0]?.confirmations || 0
      };
    } catch (error) {
      console.error('Coinbase verification error:', error);
      throw error;
    }
  }

  /**
   * List crypto addresses for multi-payment support
   */
  async getCryptoAddresses() {
    return {
      ethereum: process.env.ETHEREUM_ADDRESS,
      bitcoin: process.env.BITCOIN_ADDRESS,
      litecoin: process.env.LITECOIN_ADDRESS,
      bnb: process.env.BNB_ADDRESS
    };
  }

  // ===== GENERIC METHODS =====

  /**
   * Get payment status
   */
  async getPaymentStatus(paymentId, provider = 'paystack') {
    if (provider === 'paystack') {
      return await this.verifyPaystackPayment(paymentId);
    } else if (provider === 'coinbase') {
      return await this.verifyCoinbasePayment(paymentId);
    } else {
      throw new Error('Unknown payment provider');
    }
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(signature, payload) {
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha256', this.config.webhook.secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return hash === signature;
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(userId, limit = 50) {
    // This would fetch from your database
    // Implementation depends on your DB structure
    return {
      userId,
      transactions: [],
      total: 0
    };
  }
}

module.exports = PaymentGateway;
