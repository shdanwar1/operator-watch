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
    data: {
      url: payload.url || "/",
      type: payload.type || "notify",
      scheduledShiftId: payload.scheduledShiftId || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || "/";
  const absolute = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of all) {
        // Tell the open app about the intent first: on browsers where
        // client.navigate() is unavailable or rejects (notably installed iOS
        // apps), this message is the only thing that survives the tap.
        try {
          client.postMessage({
            type: data.type || "notify",
            scheduledShiftId: data.scheduledShiftId || null,
            url: target,
          });
        } catch {
          /* ignore */
        }

        try {
          if ("focus" in client) await client.focus();
        } catch {
          /* ignore */
        }

        if ("navigate" in client) {
          try {
            await client.navigate(absolute);
            return;
          } catch {
            /* uncontrolled or unsupported — the postMessage above stands in */
          }
        }
        return;
      }

      await self.clients.openWindow(absolute);
    })(),
  );
});
