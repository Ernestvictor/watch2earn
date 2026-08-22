self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  const payload = event.data ? event.data.json() : {
    title: 'Watch2Earn',
    body: 'You have a new update.',
    url: '/'
  };

  const notificationOptions = {
    body: payload.body || 'New notification',
    icon: payload.icon || '/images/icon-192x192.png',
    badge: payload.badge || '/images/badge-72x72.png',
    tag: payload.tag || 'watch2earn-notification',
    data: {
      url: payload.url || '/'
    }
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'Watch2Earn', notificationOptions));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === targetUrl || client.url.includes(targetUrl)) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
