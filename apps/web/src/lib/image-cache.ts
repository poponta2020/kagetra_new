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
 * We instead hold the bytes in a `globalThis`-pinned Map keyed by an opaque
 * token, serve them from `/api/line-broadcast/images/[token]`, and let
 * stale entries expire after 24 h. A process restart drops the cache —
 * by then the push has long since completed, and LINE has already fetched
 * what it needs.
 *
 * NOT for cross-process / multi-instance deployments. The current
 * single-VM (Oracle Cloud) topology is fine; a future move to multiple
 * apps/web instances would need a shared backend (Redis or signed S3).
 *
 * Why `globalThis`-pinned (Issue #128): Next.js can bundle this module into
 * multiple webpack chunks (Server Action side vs Route Handler side). Each
 * chunk would otherwise instantiate its own `Map`, so `setCachedImage` from
 * the broadcast pipeline and `getCachedImage` from the public route would
 * see different stores → every image fetch 404s. Pinning the state to
 * `globalThis` gives a single instance per Node.js process regardless of how
 * many chunks import this file.
 *
 * r-final-17 should_fix: 上限なし Map だと 1 添付 30 ページ × 10MB の
 * ような実データで OOM し得る。total bytes と entry count に上限を
 * 入れ、超過時は古いものから (insertion order = LRU 近似) evict する。
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 200 MB / 500 entries は Lightsail 1 GB RAM クラスでの目安値。
 * Node プロセスのヒープ拡大は遅延的だが、ここを超えると次の配信で
 * メモリ圧が顕在化しやすい。
 */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const MAX_ENTRIES = 500

interface CacheEntry {
  data: Buffer
  contentType: string
  expiresAt: number
  byteLength: number
}

interface ImageCacheState {
  cache: Map<string, CacheEntry>
  totalBytes: number
}

const globalRef = globalThis as unknown as {
  __kagetraImageCacheState?: ImageCacheState
}
const state: ImageCacheState = (globalRef.__kagetraImageCacheState ??= {
  cache: new Map<string, CacheEntry>(),
  totalBytes: 0,
})

function deleteEntry(key: string): void {
  const entry = state.cache.get(key)
  if (!entry) return
  state.totalBytes -= entry.byteLength
  state.cache.delete(key)
}

/**
 * 容量超過時に古いエントリから evict する。Map は insertion order を
 * 保持するので、`cache.keys()` を最古から舐めれば LRU 近似になる。
 */
function evictUntilUnderLimit(): void {
  const it = state.cache.keys()
  while (
    (state.totalBytes > MAX_TOTAL_BYTES || state.cache.size > MAX_ENTRIES) &&
    state.cache.size > 0
  ) {
    const next = it.next()
    if (next.done) break
    deleteEntry(next.value)
  }
}

export function setCachedImage(
  token: string,
  data: Buffer,
  contentType: string,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  // r-final-9 should_fix: 追加時に古いエントリも掃除し、未取得 buffer が
  // 永続的にメモリを占有しないようにする。route GET 経由でしか evict
  // が走らなかった元実装では、配信後 LINE が取得しなかった画像が再起動
  // までメモリに残ってリークしていた。
  evictExpiredImages()

  // 同一 token を上書きするケースに備えて既存をまず deleteEntry する
  // (totalBytes の二重計上を防ぐ)。
  deleteEntry(token)

  state.cache.set(token, {
    data,
    contentType,
    expiresAt: Date.now() + ttlMs,
    byteLength: data.byteLength,
  })
  state.totalBytes += data.byteLength

  // r-final-17 should_fix: 容量超過していたら最古から evict。
  evictUntilUnderLimit()

  // TTL 経過時に強制 evict する timer も仕込む。setTimeout のコールバックは
  // プロセスが生きている間だけ動作するので、再起動で失われるのは想定通り
  // (LINE 側はその時点で既に画像取得済み)。`unref()` で Node.js プロセスの
  // 終了を妨げないように。
  const timer = setTimeout(() => {
    const entry = state.cache.get(token)
    if (entry && entry.expiresAt <= Date.now()) {
      deleteEntry(token)
    }
  }, ttlMs + 1000)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }
}

export function getCachedImage(
  token: string,
  now: number = Date.now(),
): { data: Buffer; contentType: string } | null {
  const entry = state.cache.get(token)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    deleteEntry(token)
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
  for (const [key, entry] of state.cache.entries()) {
    if (entry.expiresAt <= now) {
      deleteEntry(key)
      evicted++
    }
  }
  return evicted
}

export function _resetImageCacheForTests(): void {
  state.cache.clear()
  state.totalBytes = 0
}

/**
 * Test / observability hook: 現在のキャッシュ容量を取得。
 */
export function _getImageCacheStats(): {
  entries: number
  totalBytes: number
} {
  return { entries: state.cache.size, totalBytes: state.totalBytes }
}
