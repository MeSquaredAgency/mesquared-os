/*
 * MeSquared OS service worker. It shows notifications, opens the right page
 * when one is tapped, and shows an offline screen when a page can't load.
 * The only thing it caches is that screen and its icon: workspace data is
 * never stored on the device.
 */
const OFFLINE = "msq-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== OFFLINE) await caches.delete(key);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

/* Page loads go to the network as normal; only when that fails does the offline screen answer. */
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        return preloaded || (await fetch(event.request));
      } catch {
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })(),
  );
});

/* The offline screen's icon, when it is shown. */
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate" || new URL(event.request.url).pathname !== "/icons/icon-192.png") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/icons/icon-192.png")));
});

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
