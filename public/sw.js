self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || "PR Territorios", { body: payload.body || "Tenés una nueva notificación.", icon: "/PR.svg", badge: "/PR.svg", tag: payload.tag, data: { url: payload.url || "/" } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
});
