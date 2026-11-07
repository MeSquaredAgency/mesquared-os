/* MeSquared OS service worker: shows notifications and opens the right page when one is tapped. Nothing is cached. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "MeSquared OS", body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: typeof data.url === "string" ? data.url : "/" },
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(data.title || "MeSquared OS", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever open a page of this app.
  let target = new URL("/", self.location.origin);
  try {
    const wanted = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/", self.location.origin);
    if (wanted.origin === self.location.origin) target = wanted;
  } catch {}
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) if (w.url === target.href && "focus" in w) return w.focus();
      for (const w of windows) if ("navigate" in w && "focus" in w) return w.navigate(target.href).then((n) => (n || w).focus());
      return self.clients.openWindow(target.href);
    }),
  );
});
