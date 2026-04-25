// Self-destruct: unregister this service worker and reload all clients
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister().then(() => {
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(client => client.navigate(client.url));
    });
  });
});
