/// <reference lib="webworker" />
import { clientsClaim, setCacheNameDetails } from 'workbox-core'
import { PrecacheController, PrecacheRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>
}

const manifest = self.__WB_MANIFEST
const base = new URL(self.registration.scope)
// Isolate this app from sibling Pages applications. Versioned caches keep old
// lazy chunks usable in other open tabs when an update is explicitly accepted.
const version = manifest.reduce((hash, entry) => {
  const identity = typeof entry === 'string' ? entry : `${entry.url}:${entry.revision ?? ''}`
  for (const character of identity) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0
  }
  return hash
}, 2166136261)
setCacheNameDetails({ prefix: 'little-sips', suffix: `${base.pathname}-${version}` })
const precache = new PrecacheController()
precache.precache(manifest)
registerRoute(new PrecacheRoute(precache, { ignoreURLParametersMatching: [] }))

registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate' &&
    url.origin === base.origin &&
    (url.pathname === base.pathname || url.pathname === `${base.pathname}index.html`),
  // Never cache the navigation URL: OAuth/invitation queries only receive the
  // already-cached public shell, without becoming Cache Storage entries.
  precache.createHandlerBoundToURL(new URL('index.html', base).href),
)

clientsClaim()
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  } else if (event.data?.type === 'CHECK_OFFLINE_READY' && event.ports[0]) {
    event.waitUntil(
      (async () => {
        try {
          const cache = await caches.open(precache.strategy.cacheName)
          const keys = [...precache.getURLsToCacheKeys().values()]
          const complete =
            keys.length > 0 &&
            (await Promise.all(keys.map((key) => cache.match(key)))).every(Boolean)
          event.ports[0]!.postMessage({ ready: complete })
        } catch {
          event.ports[0]!.postMessage({ ready: false })
        }
      })(),
    )
  }
})
