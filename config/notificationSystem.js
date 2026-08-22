// config/notificationSystem.js
// Unified notification system for audio, web push, and email

const nodemailer = (() => {
  try { return require('nodemailer'); } catch (e) { return null; }
})();

class NotificationSystem {
  constructor(config = {}) {
    this.config = {
      audio: {
        enabled: config.audioEnabled !== false,
        soundsDir: config.soundsDir || '/public/sounds',
        notificationSounds: {
          earning: 'earning-notification.mp3',
          withdrawal: 'withdrawal-notification.mp3',
          referral: 'referral-notification.mp3',
          alert: 'alert-notification.mp3',
          message: 'message-notification.mp3',
          success: 'success-notification.mp3',
          error: 'error-notification.mp3'
        }
      },
      webPush: {
        enabled: config.webPushEnabled !== false,
        vapidPublicKey: config.vapidPublicKey || process.env.VAPID_PUBLIC_KEY,
        vapidPrivateKey: config.vapidPrivateKey || process.env.VAPID_PRIVATE_KEY,
        vapidSubject: config.vapidSubject || process.env.VAPID_SUBJECT || 'mailto:admin@watch2earn.com'
      },
      email: {
        enabled: config.emailEnabled !== false,
        provider: config.emailProvider || 'nodemailer',
        from: config.emailFrom || process.env.EMAIL_FROM,
        smtp: {
          host: config.smtpHost || process.env.SMTP_HOST,
          port: config.smtpPort || process.env.SMTP_PORT || 587,
          secure: config.smtpSecure || process.env.SMTP_SECURE === 'true',
          auth: {
            user: config.smtpUser || process.env.SMTP_USER,
            pass: config.smtpPass || process.env.SMTP_PASS
          }
        },
        sendgrid: {
          apiKey: process.env.SENDGRID_API_KEY
        }
      }
    };

    this.initializeEmailTransport();
    this.webPush = this.config.webPush.enabled ? require('web-push') : null;
  }

  initializeEmailTransport() {
    if (!this.config.email.enabled || !nodemailer) return;

    try {
      this.emailTransport = nodemailer.createTransport({
        host: this.config.email.smtp.host,
        port: this.config.email.smtp.port,
        secure: this.config.email.smtp.secure,
        auth: this.config.email.smtp.auth
      });
    } catch (error) {
      console.error('Failed to initialize email transport:', error);
      this.emailTransport = null;
    }
  }

  // ===== AUDIO NOTIFICATIONS =====

  /**
   * Get audio notification URL
   */
  getAudioUrl(type) {
    if (!this.config.audio.enabled) return null;

    const sound = this.config.audio.notificationSounds[type];
    if (!sound) return null;

    return `${this.config.audio.soundsDir}/${sound}`;
  }

  /**
   * Get all available audio notifications
   */
  getAvailableAudio() {
    return this.config.audio.notificationSounds;
  }

  /**
   * Client-side audio notification (returns the sound to play)
   */
  getAudioNotification(type) {
    return {
      url: this.getAudioUrl(type),
      type,
      volume: this.getNotificationVolume(type)
    };
  }

  getNotificationVolume(type) {
    const volumes = {
      earning: 0.8,
      withdrawal: 0.9,
      referral: 0.7,
      alert: 1.0,
      message: 0.6,
      success: 0.7,
      error: 0.9
    };
    return volumes[type] || 0.7;
  }

  // ===== WEB PUSH NOTIFICATIONS =====

  /**
   * Send web push notification
   */
  async sendWebPushNotification(subscription, notification) {
    if (!this.config.webPush.enabled || !this.webPush) {
      return { success: false, error: 'Web Push disabled' };
    }

    try {
      this.webPush.setVapidDetails(
        this.config.webPush.vapidSubject,
        this.config.webPush.vapidPublicKey,
        this.config.webPush.vapidPrivateKey
      );

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        icon: notification.icon || '/images/icon-192x192.png',
        tag: notification.tag || 'notification',
        badge: notification.badge || '/images/badge-72x72.png',
        data: notification.data || {}
      });

      await this.webPush.sendNotification(subscription, payload);

      return { success: true };
    } catch (error) {
      console.error('Web Push error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Store push subscription for user
   */
  async subscribeToPushNotifications(userId, subscription) {
    // This would store the subscription in your database
    // Example: db.pushSubscriptions.upsert({ userId }, { subscription })
    return {
      success: true,
      userId,
      subscribed: true
    };
  }

  /**
   * Send push notification to user by ID
   */
  async sendNotificationToUser(userId, notification) {
    // Fetch user's push subscription from DB and send notification
    // Example implementation:
    // const subscription = await db.pushSubscriptions.findOne({ userId });
    // if (subscription) {
    //   return await this.sendWebPushNotification(subscription, notification);
    // }
    return { success: false, error: 'User subscription not found' };
  }

  // ===== EMAIL NOTIFICATIONS =====

  /**
   * Send email notification
   */
  async sendEmailNotification(recipient, notification) {
    if (!this.config.email.enabled || !this.emailTransport) {
      console.warn('Email notifications disabled');
      return { success: false, error: 'Email disabled' };
    }

    try {
      const mailOptions = {
        from: this.config.email.from,
        to: recipient,
        subject: notification.subject,
        html: notification.html || this.generateEmailTemplate(notification)
      };

      const result = await this.emailTransport.sendMail(mailOptions);

      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error) {
      console.error('Email sending error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send bulk email notifications
   */
  async sendBulkEmail(recipients, notification) {
    const results = [];

    for (const recipient of recipients) {
      const result = await this.sendEmailNotification(recipient, notification);
      results.push({ recipient, ...result });
    }

    return results;
  }

  /**
   * Generate HTML email template
   */
  generateEmailTemplate(notification) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; }
          .header { color: #4CAF50; margin-bottom: 20px; }
          .content { color: #333; line-height: 1.6; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #888; font-size: 12px; }
          .button { display: inline-block; background: #4CAF50; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2 class="header">${notification.subject}</h2>
          <div class="content">
            ${notification.body || ''}
            ${notification.actionUrl ? `<a href="${notification.actionUrl}" class="button">${notification.actionText || 'View Details'}</a>` : ''}
          </div>
          <div class="footer">
            Watch2Earn Team<br>
            ${new Date().toLocaleDateString()}
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // ===== COMBINED NOTIFICATIONS =====

  /**
   * Send notification through multiple channels
   */
  async sendNotification(userId, notification, channels = ['audio', 'email']) {
    const results = {
      audio: null,
      webPush: null,
      email: null
    };

    if (channels.includes('audio')) {
      results.audio = this.getAudioNotification(notification.type);
    }

    if (channels.includes('webPush')) {
      results.webPush = await this.sendNotificationToUser(userId, {
        title: notification.title,
        body: notification.body,
        icon: notification.icon,
        data: notification.data
      });
    }

    if (channels.includes('email')) {
      // Fetch user email from DB
      const userEmail = notification.userEmail || await this.getUserEmail(userId);
      if (userEmail) {
        results.email = await this.sendEmailNotification(userEmail, notification);
      }
    }

    return results;
  }

  /**
   * Pre-defined notification templates
   */
  getNotificationTemplate(type, data = {}) {
    const templates = {
      earningCredited: {
        title: 'Earning Credited! 💰',
        body: `You earned $${data.amount || 0}`,
        type: 'earning',
        icon: '/images/earning.png'
      },
      withdrawalInitiated: {
        title: 'Withdrawal Initiated',
        body: `Your withdrawal of $${data.amount || 0} has been initiated. It will arrive in 24-48 hours.`,
        type: 'withdrawal',
        icon: '/images/withdrawal.png'
      },
      withdrawalCompleted: {
        title: 'Withdrawal Completed ✅',
        body: `Your $${data.amount || 0} withdrawal has been completed and sent to your account.`,
        type: 'success',
        icon: '/images/success.png'
      },
      referralBonus: {
        title: 'Referral Bonus! 🎉',
        body: `You earned $${data.amount || 0} from your referral ${data.referralName || 'a friend'}.`,
        type: 'referral',
        icon: '/images/referral.png'
      },
      message: {
        title: 'New Message',
        body: data.message || 'You have a new message from the admin.',
        type: 'message',
        icon: '/images/message.png'
      },
      alert: {
        title: 'Alert',
        body: data.message || 'Important notification',
        type: 'alert',
        icon: '/images/alert.png'
      }
    };

    return templates[type] || null;
  }

  /**
   * Mock getUserEmail (implement based on your DB)
   */
  async getUserEmail(userId) {
    // Implementation depends on your database
    // Example: return db.users.findOne({ id: userId })?.email;
    return null;
  }
}

module.exports = NotificationSystem;
