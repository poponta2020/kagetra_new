/**
 * In-memory cache for rendered attachment images.
 *
 * LINE's Messaging API `image` message requires `originalContentUrl` /
 * `previewImageUrl` to be HTTPS URLs reachable from LINE's image fetchers.
 * Persisting every rendered JPEG to the DB or to S3 just so LINE can pull
 * them once is wasteful — the image fetch happens within seconds of the
 * push, then LINE caches the bitmap on the device for ~the lifetime of the
 * conversation.
 *
 * We instead hold the bytes in this module-level Map keyed by an opaque
 * token, serve them from `/api/line-broadcast/images/[token]`, and let
 * stale entries expire after 24 h. A process restart drops the cache —
 * by then the push has long since completed, and LINE has already fetched
 * what it needs.
 *
 * NOT for cross-process / multi-instance deployments. The current
 * single-VM (Lightsail) topology is fine; a future move to multiple
 * apps/web instances would need a shared backend (Redis or signed S3).
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

interface CacheEntry {
  data: Buffer
  contentType: string
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export function setCachedImage(
  token: string,
  data: Buffer,
  contentType: string,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  cache.set(token, {
    data,
    contentType,
    expiresAt: Date.now() + ttlMs,
  })
}

export function getCachedImage(
  token: string,
  now: number = Date.now(),
): { data: Buffer; contentType: string } | null {
  const entry = cache.get(token)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    cache.delete(token)
    return null
  }
  return { data: entry.data, contentType: entry.contentType }
}

/**
 * Sweep expired entries. Called lazily from the route handler so we don't
 * need a background timer (which would keep the Node event loop alive
 * unnecessarily in dev).
 */
export function evictExpiredImages(now: number = Date.now()): number {
  let evicted = 0
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key)
      evicted++
    }
  }
  return evicted
}

export function _resetImageCacheForTests(): void {
  cache.clear()
}
