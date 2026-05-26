import { NextResponse, type NextRequest } from 'next/server'
import { evictExpiredImages, getCachedImage } from '@/lib/image-cache'

export const dynamic = 'force-dynamic'
// Node runtime: the cache lives in module-level Map and depends on a single
// long-running Node process (see image-cache.ts header). Edge runs each
// request on a fresh isolate and would lose the entry between push and
// LINE's image fetch.
export const runtime = 'nodejs'

/**
 * GET /api/line-broadcast/images/[token]
 *
 * Serves a freshly-rendered attachment page image from the in-memory cache
 * that the broadcast pipeline (`lib/line-broadcast.ts`, lands in PR6)
 * populates before pushing the `image` LINE message.
 *
 * Returns 404 once the entry has TTL'd (24h after render). By then LINE has
 * fetched-and-cached the bytes inside the conversation, so a missing entry
 * here means "no one was ever going to fetch it again". We also opportunistically
 * sweep stale entries on each request to avoid unbounded growth in case the
 * broadcast pipeline crashes before publishing.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params
  if (!token) {
    return new NextResponse('Not Found', { status: 404 })
  }

  evictExpiredImages()
  const hit = getCachedImage(token)
  if (!hit) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const headers = new Headers({
    'Content-Type': hit.contentType,
    // LINE caches the image on the device once fetched; we still allow a
    // short shared cache so the LINE preview fetcher and the inline image
    // fetcher don't double-fetch within one batch push.
    'Cache-Control': 'public, max-age=300, immutable',
  })
  return new NextResponse(new Uint8Array(hit.data), { status: 200, headers })
}
