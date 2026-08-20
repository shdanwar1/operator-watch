/* Studio Shift Tracker — push notification service worker.
   Handles background push delivery and notification clicks only.
   It intentionally does no caching, so the app is never served stale. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Studio Shift Tracker", body: event.data ? event.data.text() : "" };
  }

  // A retraction: the shift behind this reminder was cancelled or retimed.
  if (payload.type === "close") {
    event.waitUntil(
      (async () => {
        const shown = await self.registration.getNotifications(
          payload.tag ? { tag: payload.tag } : {},
        );
        for (const n of shown) {
          if (!payload.tag || n.tag === payload.tag) n.close();
        }
      })(),
    );
    return;
  }

  const title = payload.title || "Studio Shift Tracker";
  const options = {
    body: payload.body || "",
    tag: payload.tag || "shift",
    renotify: true,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
