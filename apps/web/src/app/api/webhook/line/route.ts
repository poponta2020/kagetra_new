import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handleLineWebhook } from '@/lib/line-webhook-handler'

export const dynamic = 'force-dynamic'
// LINE signature verification is HMAC-SHA256 on the raw request body, and
// we need `node:crypto` plus the `pg` driver — both Node-only. Edge runtime
// would re-encode the body via TextDecoder and break the signature check.
export const runtime = 'nodejs'

/**
 * POST /api/webhook/line
 *
 * Single endpoint for all 30 broadcast Bots — `destination` in the payload
 * identifies which channel sent the event, and the handler looks up the
 * matching `line_channels` row to fetch the channel secret + access token.
 *
 * Always returns 200 on success (verified events) so LINE doesn't retry
 * after delivery, even when individual event handlers no-op (e.g. a stray
 * `follow` event). Signature failures return 401, unknown destinations
 * return 404.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read the raw body once: it's needed both for signature verification
  // and JSON parsing. Reading req.text() twice would throw.
  const rawBody = await req.text()
  const signature = req.headers.get('x-line-signature')

  const result = await handleLineWebhook(db, rawBody, signature)
  if (result.status === 200) {
    return NextResponse.json({ ok: true })
  }
  return new NextResponse(result.reason ?? 'error', { status: result.status })
}
