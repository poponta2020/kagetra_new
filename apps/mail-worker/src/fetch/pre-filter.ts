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
 *   - `List-Unsubscribe` is present AND `List-Id` is missing. Real mailing
 *     lists (Mailman, sympa, taikai-ajka, etc.) always set `List-Id`; without
 *     it we treat List-Unsubscribe as a marketing-traffic signal and skip.
 *
 * Why we do NOT skip on `Precedence: list` or on `List-Unsubscribe` paired
 * with `List-Id`: those are standard ML headers that legitimate
 * tournament-announcement mailing lists set. The whole point of PR1 is to
 * ingest taikai-ajka, so blocking ML headers would silently break the feature.
 *
 * Header keys lookup contract: `headers` MUST already have lowercase keys
 * (imap-client.ts normalises them on the way in). The `get()` helper lowercases
 * the lookup name purely for ergonomics, so call sites can write
 * `get('Auto-Submitted')` without thinking about casing.
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

  // List-Unsubscribe without List-Id is the strongest "consumer newsletter"
  // signal we have. Properly-configured mailing lists always set List-Id;
  // absence means this isn't a real ML and is most likely marketing traffic
  // we don't want to AI-process. ML allowlisting is therefore expressed via
  // List-Id presence alone.
  const listUnsubscribe = get('list-unsubscribe')?.trim()
  if (listUnsubscribe) {
    const listId = get('list-id')?.trim()
    if (!listId) return true
  }

  return false
}
