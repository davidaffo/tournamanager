const CACHE = 'tournamanager-v4'
const appRoot = new URL('./', self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    const response = await fetch(appRoot)
    if (response.ok) {
      await cache.put(appRoot, response.clone())
      const html = await response.text()
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => new URL(match[1], appRoot).href)
        .filter((url) => url.startsWith(appRoot))
      await Promise.all(assets.map(async (url) => {
        const asset = await fetch(url)
        if (asset.ok) await cache.put(url, asset)
      }))
    }
  }))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put(event.request, copy))
    }
    return response
  }).catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === 'navigate' ? caches.match(appRoot) : undefined))))
})
