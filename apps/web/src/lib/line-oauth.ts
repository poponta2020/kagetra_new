/**
 * LINE Login OAuth2 helpers.
 *
 * We do NOT use the Auth.js LINE provider because it would create a session;
 * here we only want to resolve a `lineUserId` and persist it on the existing
 * user record. Everything is a plain HTTPS POST.
 *
 * Docs: https://developers.line.biz/ja/docs/line-login/integrate-line-login/
 */

export const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize'
export const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token'
export const LINE_PROFILE_URL = 'https://api.line.me/v2/profile'

export const LINE_STATE_COOKIE = 'line_link_state'
export const LINE_STATE_MAX_AGE = 300 // 5 minutes

export type LineProfile = {
  userId: string
  displayName: string
  pictureUrl?: string
}

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
  return (await res.json()) as LineProfile
}
