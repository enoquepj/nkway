/* NKWAY — Service Worker do PDV (app shell + assets do Next).
   Objetivo: se a internet cair, a aba do PDV já aberta continua funcionando e, ao recarregar,
   a última versão da tela /pdv é servida do cache. Dados (server actions, APIs) nunca são cacheados. */

const VERSAO = "nkway-pdv-v2";
const CACHE_SHELL = `${VERSAO}-shell`;
const CACHE_ASSETS = `${VERSAO}-assets`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_SHELL).then((c) => c.addAll(["/pdv"]).catch(() => undefined)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSAO)).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // server actions (POST) nunca passam pelo cache
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // dados sempre da rede

  // Navegação para o PDV: rede primeiro; sem rede, última cópia do shell.
  if (req.mode === "navigate") {
    if (!url.pathname.startsWith("/pdv")) return;
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) caches.open(CACHE_SHELL).then((c) => c.put("/pdv", res.clone())); return res; })
        .catch(() => caches.match("/pdv").then((hit) => hit || new Response("<h1>PDV offline</h1><p>Sem cópia local desta tela. Conecte-se uma vez para habilitar o modo offline.</p>", { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 }))),
    );
    return;
  }

  // Assets estáticos do Next (imutáveis por hash): cache primeiro, rede como complemento.
  if (url.pathname.startsWith("/_next/static/") || /\.(?:css|js|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) caches.open(CACHE_ASSETS).then((c) => c.put(req, res.clone())); return res; })),
    );
  }
});
