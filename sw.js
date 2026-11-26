/* Desk service worker: the app shell works offline. Data (d/..., /api/...) is never cached or touched here. */
const V = "desk-shell-v1";
const SHELL = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/d/") || u.pathname.startsWith("/api/")) return;
  const scope = new URL(self.registration.scope).pathname;
  const rel = u.pathname.startsWith(scope) ? u.pathname.slice(scope.length) || "./" : null;
  if (rel === null || !SHELL.includes(rel === "" ? "./" : rel)) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request)));
});
/* Web push (only if the app sits on the home screen and you allowed it; Plan B uses Telegram). The payload carries the
   FOMO link made by links.py on the desk. */
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Grok Bot · now", { body: d.body || "", icon: "icons/apple-touch-icon.png", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(clients.openWindow(e.notification.data && e.notification.data.url || "./")); });
