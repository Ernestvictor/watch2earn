// public/js/notificationManager.js
// Client-side notification management for audio, web push, and visual notifications

class NotificationManager {
  constructor(config = {}) {
    this.config = {
      enableAudio: config.enableAudio !== false,
      enablePush: config.enablePush !== false,
      enableToast: config.enableToast !== false,
      audioVolume: config.audioVolume || 0.7,
      soundsPath: config.soundsPath || '/sounds'
    };

    this.audioContext = null;
    this.audioElements = {};
    this.toastContainer = null;
    this.swRegistration = null;

    this.initializeAudio();
    this.initializeWebPush();
    this.createToastContainer();
  }

  // ===== AUDIO INITIALIZATION =====

  initializeAudio() {
    if (!this.config.enableAudio) return;

    // Create audio elements for each notification type
    const sounds = [
      'earning-notification.mp3',
      'withdrawal-notification.mp3',
      'referral-notification.mp3',
      'alert-notification.mp3',
      'message-notification.mp3',
      'success-notification.mp3',
      'error-notification.mp3'
    ];

    sounds.forEach(sound => {
      const audio = new Audio();
      audio.src = `${this.config.soundsPath}/${sound}`;
      audio.volume = this.config.audioVolume;
      this.audioElements[sound.replace('-notification.mp3', '')] = audio;
    });
  }

  /**
   * Play audio notification
   */
  playAudio(type = 'alert', volume = null) {
    if (!this.config.enableAudio) return;

    const audioKey = type.replace(/\.mp3/, '').split('/').pop();
    const audio = this.audioElements[audioKey];

    if (!audio) {
      console.warn(`Audio for type "${type}" not found`);
      return;
    }

    if (volume !== null) {
      audio.volume = Math.min(volume, 1);
    }

    // Reset audio to beginning
    audio.currentTime = 0;
    
    // Play audio
    audio.play().catch(error => {
      console.warn('Audio playback failed:', error);
    });
  }

  // ===== WEB PUSH NOTIFICATIONS =====

  async initializeWebPush() {
    if (!this.config.enablePush || !('Notification' in window) || !('serviceWorker' in navigator)) {
      return;
    }

    // Request permission if not already granted
    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.log('Notification permission denied');
          return;
        }
      } catch (error) {
        console.warn('Failed to request notification permission:', error);
        return;
      }
    }

    // Register service worker
    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });
      console.log('Service Worker registered for push notifications');
    } catch (error) {
      console.warn('Service Worker registration failed:', error);
    }
  }

  /**
   * Subscribe to push notifications
   */
  async subscribeToPush() {
    if (!this.swRegistration || !('pushManager' in this.swRegistration)) {
      return null;
    }

    try {
      const subscription = await this.swRegistration.pushManager.getSubscription();
      
      if (!subscription) {
        // Create new subscription
        const vapidPublicKey = await this.getVapidPublicKey();
        if (!vapidPublicKey) return null;

        const newSubscription = await this.swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(vapidPublicKey)
        });

        // Send subscription to server
        await this.sendSubscriptionToServer(newSubscription);
        return newSubscription;
      }

      return subscription;
    } catch (error) {
      console.error('Push subscription failed:', error);
      return null;
    }
  }

  /**
   * Show web push notification
   */
  async showPushNotification(title, options = {}) {
    if (!this.config.enablePush || Notification.permission !== 'granted') {
      this.showToast(title, options);
      return;
    }

    try {
      if (this.swRegistration) {
        await this.swRegistration.showNotification(title, {
          icon: options.icon || '/images/icon-192x192.png',
          badge: options.badge || '/images/badge-72x72.png',
          tag: options.tag || 'notification',
          requireInteraction: options.requireInteraction || false,
          ...options
        });
      } else {
        new Notification(title, options);
      }
    } catch (error) {
      console.error('Failed to show push notification:', error);
      this.showToast(title, options);
    }
  }

  /**
   * Get VAPID public key
   */
  async getVapidPublicKey() {
    try {
      const response = await fetch('/api/push/vapid-public-key');
      if (!response.ok) throw new Error('Failed to fetch VAPID key');
      const data = await response.json();
      return data.publicKey;
    } catch (error) {
      console.error('Error fetching VAPID key:', error);
      return null;
    }
  }

  /**
   * Send subscription to server
   */
  async sendSubscriptionToServer(subscription) {
    try {
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscription)
      });

      if (!response.ok) throw new Error('Failed to subscribe on server');
      return await response.json();
    } catch (error) {
      console.error('Error sending subscription to server:', error);
    }
  }

  /**
   * Convert VAPID key
   */
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  // ===== VISUAL TOAST NOTIFICATIONS =====

  createToastContainer() {
    if (document.getElementById('toast-container')) return;

    const container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      max-width: 400px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
    this.toastContainer = container;
  }

  /**
   * Show toast notification
   */
  showToast(message, options = {}) {
    if (!this.config.enableToast || !this.toastContainer) return;

    const {
      type = 'info',
      duration = 4000,
      icon = null,
      action = null
    } = options;

    const toast = document.createElement('div');
    const typeClasses = {
      success: { bg: '#4CAF50', icon: '✓' },
      error: { bg: '#f44336', icon: '✕' },
      warning: { bg: '#ffd700', icon: '⚠' },
      info: { bg: '#2196F3', icon: 'ℹ' }
    };

    const typeStyle = typeClasses[type] || typeClasses.info;

    toast.style.cssText = `
      background: ${typeStyle.bg};
      color: ${type === 'warning' ? '#000' : '#fff'};
      padding: 16px;
      border-radius: 4px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slideIn 0.3s ease-out;
      pointer-events: auto;
      font-size: 14px;
    `;

    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon || typeStyle.icon;
    iconSpan.style.fontSize = '18px';
    iconSpan.style.fontWeight = 'bold';

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    messageSpan.style.flex = '1';

    toast.appendChild(iconSpan);
    toast.appendChild(messageSpan);

    if (action) {
      const button = document.createElement('button');
      button.textContent = action.label;
      button.style.cssText = `
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        font-weight: 600;
        text-decoration: underline;
        padding: 0;
        margin-left: 12px;
      `;
      button.onclick = () => {
        action.callback?.();
        toast.remove();
      };
      toast.appendChild(button);
    }

    this.toastContainer.appendChild(toast);

    // Add animation
    if (!document.querySelector('style[data-toast-animation]')) {
      const style = document.createElement('style');
      style.setAttribute('data-toast-animation', 'true');
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(400px);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    // Auto remove
    if (duration > 0) {
      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    return toast;
  }

  // ===== COMBINED NOTIFICATIONS =====

  /**
   * Send full notification (audio + push + toast)
   */
  async sendNotification(title, options = {}) {
    const {
      body = '',
      type = 'info',
      audioType = type,
      icon = null,
      duration = 4000,
      playAudio = true,
      showPush = true,
      showToast = true,
      action = null
    } = options;

    // Play audio
    if (playAudio && this.config.enableAudio) {
      this.playAudio(audioType);
    }

    // Show push notification
    if (showPush && this.config.enablePush) {
      await this.showPushNotification(title, {
        body,
        icon,
        tag: type,
        requireInteraction: type === 'warning' || type === 'error'
      });
    }

    // Show toast
    if (showToast && this.config.enableToast) {
      this.showToast(title, {
        type,
        duration,
        icon,
        action
      });
    }
  }

  /**
   * Pre-defined notification templates
   */
  async notifyEarning(amount) {
    await this.sendNotification('Earning Credited! 💰', {
      body: `You earned $${amount}`,
      type: 'success',
      audioType: 'earning',
      icon: '/images/earning.png'
    });
  }

  async notifyWithdrawal(amount, status = 'initiated') {
    const messages = {
      initiated: `Your withdrawal of $${amount} has been initiated`,
      completed: `Your $${amount} withdrawal has been completed`,
      rejected: `Your $${amount} withdrawal was rejected`
    };

    await this.sendNotification(
      status === 'completed' ? 'Withdrawal Completed ✅' : 'Withdrawal Initiated',
      {
        body: messages[status],
        type: status === 'rejected' ? 'error' : 'info',
        audioType: 'withdrawal',
        icon: '/images/withdrawal.png'
      }
    );
  }

  async notifyReferral(amount, referralName) {
    await this.sendNotification('Referral Bonus! 🎉', {
      body: `You earned $${amount} from ${referralName}`,
      type: 'success',
      audioType: 'referral',
      icon: '/images/referral.png'
    });
  }

  async notifyAlert(message, severity = 'warning') {
    await this.sendNotification('Alert', {
      body: message,
      type: severity,
      audioType: 'alert',
      duration: 6000
    });
  }

  async notifyMessage(senderName, messagePreview) {
    await this.sendNotification('New Message', {
      body: `${senderName}: ${messagePreview}`,
      type: 'info',
      audioType: 'message',
      duration: 0
    });
  }

  // ===== UTILITY METHODS =====

  /**
   * Set audio volume
   */
  setAudioVolume(volume) {
    this.config.audioVolume = Math.min(Math.max(volume, 0), 1);
    Object.values(this.audioElements).forEach(audio => {
      audio.volume = this.config.audioVolume;
    });
  }

  /**
   * Enable/disable notifications
   */
  setEnabled(featureName, enabled) {
    this.config[featureName] = enabled;
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationManager;
}
