// Service Worker for Push Notifications

self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    
    const options = {
      body: data.body || "New notification",
      icon: data.icon || "/favicon.png",
      badge: data.badge || "/favicon.png",
      tag: data.tag || `audit-alert-${Date.now()}`,
      data: data.data || { url: "/" },
      requireInteraction: true,
      vibrate: [200, 100, 200],
      actions: [
        { action: "view", title: "View Details" },
        { action: "dismiss", title: "Dismiss" },
      ],
    };

    event.waitUntil(
      self.registration.showNotification(data.title || "Matbex Alert", options)
    );
  } catch (error) {
    console.error("Error showing push notification:", error);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const url = notificationData.url || "/";

  // Handle action buttons
  if (event.action === "dismiss") {
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Try to focus existing window
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.focus();
          if (url !== "/") {
            client.navigate(url);
          }
          return;
        }
      }
      // Open new window if no existing window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // Handle subscription expiration
  console.log("Push subscription changed, attempting to re-subscribe...");
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true })
      .then((subscription) => {
        console.log("Re-subscribed to push:", subscription.endpoint);
        // Note: The app will need to sync this new subscription to the backend
      })
      .catch((error) => {
        console.error("Failed to re-subscribe:", error);
      })
  );
});
