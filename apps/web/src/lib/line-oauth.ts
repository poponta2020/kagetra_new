/**
 * LINE Login OAuth2 helpers.
 *
 * We do NOT use the Auth.js LINE provider because it would create a session;
 * here we only want to resolve a `lineUserId` and persist it on the existing
 * user record. Everything is a plain HTTPS POST.
 *
 * Docs: https://developers.line.biz/ja/docs/line-login/integrate-line-login/
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize'
export const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token'
export const LINE_PROFILE_URL = 'https://api.line.me/v2/profile'

export const LINE_STATE_COOKIE = 'line_link_state'
export const LINE_STATE_MAX_AGE = 300 // 5 minutes

// `userId` is the only field we persist; empty/missing must hard-fail so a
// malformed upstream response can't silently overwrite users.lineUserId with
// an empty string or leave the flow looking successful without a real link.
const lineProfileSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string(),
  pictureUrl: z.string().optional(),
})

export type LineProfile = z.infer<typeof lineProfileSchema>

export type LineOAuthEnv = {
  channelId: string
  channelSecret: string
  callbackUrl: string
}

export function readLineOAuthEnv(): LineOAuthEnv | null {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET
  const callbackUrl = process.env.LINE_LOGIN_CALLBACK_URL
  if (!channelId || !channelSecret || !callbackUrl) return null
  return { channelId, channelSecret, callbackUrl }
}

/**
 * Testing switch: when set to 'true' in non-production, the callback route
 * skips the real HTTP round-trips and returns a deterministic profile. This
 * is ONLY read in non-production (we double-check via NODE_ENV).
 */
export function isLineOAuthTestMode(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.LINE_OAUTH_TEST_MODE === 'true'
}

export function buildAuthorizeUrl(
  env: LineOAuthEnv,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.channelId,
    redirect_uri: env.callbackUrl,
    state,
    scope: 'profile openid',
  })
  return `${LINE_AUTHORIZE_URL}?${params.toString()}`
}

/**
 * Exchange an authorization code for an access token. We intentionally do
 * not persist the token — it's used once to fetch the profile then dropped.
 */
export async function exchangeCodeForAccessToken(
  env: LineOAuthEnv,
  code: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.callbackUrl,
    client_id: env.channelId,
    client_secret: env.channelSecret,
  })
  const res = await fetch(LINE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`LINE token exchange failed: ${res.status}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) {
    throw new Error('LINE token response missing access_token')
  }
  return json.access_token
}

export async function fetchLineProfile(accessToken: string): Promise<LineProfile> {
  const res = await fetch(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`LINE profile fetch failed: ${res.status}`)
  }
  const parsed = lineProfileSchema.safeParse(await res.json())
  if (!parsed.success) {
    throw new Error('LINE profile response failed validation')
  }
  return parsed.data
}

// --- Signed state cookie ------------------------------------------------
//
// The OAuth2 `state` alone only defends against CSRF. It does NOT bind the
// flow to the user who started it, so a logout+relogin as a different user
// between /start and /callback could attach the linked LINE ID to the wrong
// account. We bind `userId` into the cookie and HMAC-sign the pair with
// AUTH_SECRET; the callback re-verifies and rejects on mismatch.

const STATE_COOKIE_SEPARATOR = '.'

function readAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    // Auth.js v5 refuses to start without AUTH_SECRET, so this should never
    // fire in a real environment — but surfacing the missing config is safer
    // than silently producing unverifiable cookies.
    throw new Error('AUTH_SECRET is not set; LINE link flow cannot sign state cookie')
  }
  return secret
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  return Buffer.from(
    input.replace(/-/g, '+').replace(/_/g, '/') + pad,
    'base64',
  ).toString('utf8')
}

function hmacSign(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Build the signed state cookie: `${state}.${userIdB64}.${sig}`.
 * Callers pass the pure OAuth state via the authorize URL; only the cookie
 * carries the userId binding.
 */
export function buildLineLinkStateCookie(state: string, userId: string): string {
  const secret = readAuthSecret()
  const userIdB64 = base64UrlEncode(userId)
  const payload = `${state}${STATE_COOKIE_SEPARATOR}${userIdB64}`
  const sig = hmacSign(payload, secret)
  return `${payload}${STATE_COOKIE_SEPARATOR}${sig}`
}

export type LineLinkStateCookieContents = {
  state: string
  userId: string
}

/**
 * Verify signature + structure and return the state/userId pair. Returns
 * null on any parse or signature failure; callers should treat null as
 * state_mismatch.
 */
export function verifyLineLinkStateCookie(
  cookieValue: string,
): LineLinkStateCookieContents | null {
  const parts = cookieValue.split(STATE_COOKIE_SEPARATOR)
  if (parts.length !== 3) return null
  const [state, userIdB64, sig] = parts
  if (!state || !userIdB64 || !sig) return null

  let secret: string
  try {
    secret = readAuthSecret()
  } catch {
    return null
  }
  const expected = hmacSign(
    `${state}${STATE_COOKIE_SEPARATOR}${userIdB64}`,
    secret,
  )
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null

  let userId: string
  try {
    userId = base64UrlDecode(userIdB64)
  } catch {
    return null
  }
  if (!userId) return null
  return { state, userId }
}
