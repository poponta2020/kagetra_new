import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const ZIPCLOUD_ENDPOINT = 'https://zipcloud.ibsnet.co.jp/api/search'
// Cap the wait so a slow/unreachable zipcloud can't hang the registration
// form — on any failure the client falls back to manual address entry.
const UPSTREAM_TIMEOUT_MS = 5000

const FALLBACK_ERROR = '住所を取得できませんでした。住所を手入力してください。'

type ZipcloudResult = {
  address1: string
  address2: string
  address3: string
}
type ZipcloudResponse = {
  status: number
  message: string | null
  results: ZipcloudResult[] | null
}

/** Strip hyphens/whitespace and accept only an exactly-7-digit code. */
function normalizeZipcode(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/[\s-]/g, '')
  return /^\d{7}$/.test(digits) ? digits : null
}

/**
 * GET /api/zip?zipcode=<7桁>
 *
 * Server-side proxy to zipcloud (unauthenticated, no API key). Returns the
 * prefecture+city+area string for the postcode so the register form can
 * pre-fill 住所1 (the user then appends 丁目・番地). zipcloud is hit on the
 * server to dodge CORS, keep the route testable, and avoid baking the upstream
 * URL into the client bundle.
 *
 * Contract: `{ address }` on a hit, `{ error }` otherwise. Every failure mode
 * (bad input / upstream down / no match) is non-fatal — the form stays
 * submittable with a hand-typed address (requirements §3.3).
 *
 * Reachable by the unbound LINE-authenticated registrant on /register/* — this
 * path is exempted from the auth middleware matcher (see src/middleware.ts).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const zipcode = normalizeZipcode(req.nextUrl.searchParams.get('zipcode'))
  if (!zipcode) {
    return NextResponse.json(
      { error: '郵便番号は7桁の数字で入力してください。' },
      { status: 400 },
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(`${ZIPCLOUD_ENDPOINT}?zipcode=${zipcode}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json({ error: FALLBACK_ERROR }, { status: 502 })
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: FALLBACK_ERROR }, { status: 502 })
  }

  let data: ZipcloudResponse
  try {
    data = (await upstream.json()) as ZipcloudResponse
  } catch {
    return NextResponse.json({ error: FALLBACK_ERROR }, { status: 502 })
  }

  const hit = data.results?.[0]
  if (!hit) {
    return NextResponse.json(
      { error: '該当する住所が見つかりませんでした。住所を手入力してください。' },
      { status: 404 },
    )
  }

  const address = `${hit.address1}${hit.address2}${hit.address3}`
  return NextResponse.json({ address })
}
