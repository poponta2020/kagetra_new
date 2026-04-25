/**
 * Header-based noise pre-filter.
 *
 * Runs before AI classification (PR3). When this returns true the mail is
 * persisted with `classification='noise'` so the inbox UI can hide it by
 * default — we still keep the row so the operator can inspect false positives.
 *
 * Rules (any one match → skip):
 *   - `Auto-Submitted` is anything other than `no` (auto-generated bots,
 *     calendar invites, vacation auto-replies)
 *   - `Precedence` is `bulk` or `junk` (NOT `list`; see below)
 *   - `X-Spam-Flag` is `YES`
 *   - `X-Spam-Status` starts with `Yes`
 *   - `List-Unsubscribe` is present, BUT only when `List-Id` is missing AND
 *     `From` looks like a no-reply address. This catches consumer newsletters
 *     while letting mailing-list announcements (e.g. taikai-ajka) through.
 *
 * Why we do NOT skip on `Precedence: list` or `List-Unsubscribe` alone:
 * those are standard ML headers (Mailman, sympa, etc.) that legitimate
 * tournament-announcement mailing lists set. The whole point of PR1 is to
 * ingest taikai-ajka, so blocking ML headers would silently break the feature.
 *
 * Header keys are matched case-insensitively. `headers` is expected to already
 * have lowercase keys (see `imap-client.ts`).
 */
export function shouldSkipByHeaders(headers: Record<string, string>): boolean {
  const get = (name: string): string | undefined => headers[name.toLowerCase()]

  const autoSubmitted = get('auto-submitted')?.trim().toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return true

  // 'list' is a legitimate ML header (e.g. taikai-ajka uses it). Only 'bulk'
  // and 'junk' are noise signals here.
  const precedence = get('precedence')?.trim().toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk') return true

  const spamFlag = get('x-spam-flag')?.trim().toLowerCase()
  if (spamFlag === 'yes') return true

  const spamStatus = get('x-spam-status')?.trim().toLowerCase()
  if (spamStatus && spamStatus.startsWith('yes')) return true

  // List-Unsubscribe alone is too common in ML mails to be a noise signal.
  // Only treat it as noise when there's no List-Id (so it's not a real ML)
  // AND the From address looks like a no-reply (consumer newsletter pattern).
  const listUnsubscribe = get('list-unsubscribe')?.trim()
  if (listUnsubscribe) {
    const listId = get('list-id')?.trim()
    const from = get('from')?.toLowerCase() ?? ''
    const isNoReply = /no-?reply|donotreply/.test(from)
    if (!listId && isNoReply) return true
  }

  return false
}
