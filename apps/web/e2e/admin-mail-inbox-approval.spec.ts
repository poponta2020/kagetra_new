import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import type {
  EventUnit,
  ExtractionPayload,
} from '@kagetra/mail-worker/classify/schema'
import { events, tournamentDrafts } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  seedAdminSession,
} from '../src/test-utils/playwright-auth'
import {
  createMailMessage,
  createTournamentDraft,
} from '../src/test-utils/seed'
import { testDb, truncateAll } from '../src/test-utils/db'

/**
 * /admin/mail-inbox/[id] approval flow E2E.
 *
 * tournament-title-grade-split: the approval surface is now a multi-unit form
 * — one AI draft (= one mail) materializes into N events (split per event
 * date). The DOM contract this spec exercises:
 *   - Each event unit renders an `EventForm` whose fields are namespaced
 *     `${unit_key}__<field>` (e.g. `u1__title`, `u1__eventDate`). The title is
 *     pre-filled by `composeTitle(short_name_stem, eligible_grades)`.
 *   - One submit button "選択したイベントを登録" wraps every unit; per-unit
 *     `${unit_key}__register` checkboxes (default ON) gate which units are
 *     created. Split approvals set `events.tournament_draft_id = draftId`
 *     (+ `tournament_draft_unit_key`); `tournament_drafts.event_id` stays null.
 *   - A separate "残りは作らず完了" button calls `completeDraft` to close a
 *     partially-approved draft without materializing the remaining units.
 *
 * Scenarios:
 *   1. happy path (single unit) — submit pre-filled form, assert 1 event row
 *      (title '札幌AB', createdBy=admin), draft → approved, event_id null.
 *   2. multi-unit partial approval → complete — uncheck u2, submit (only u1
 *      materializes, draft stays pending_review), then "残りは作らず完了"
 *      flips to approved with u2 still uncreated.
 *   3. legacy back-compat — old single-`extracted` payload renders one `u1`
 *      form (title from `extracted.title`); submit creates an event + approves.
 *   4. reject — textarea reason → 'rejected', no events row.
 *   5. reextract smoke — 再抽出 button visible + enabled.
 *
 * The deeper "classifyMail was called" assertion lives in the Vitest action
 * tests; here we only need the route to not blow up because LLM stubs via env
 * are fragile under the real Anthropic SDK constructor.
 */

/**
 * Build a fully-populated EventUnit. Per-grade capacity only (the 2.0.0 payload
 * dropped the announcement-wide `capacity_total`).
 */
function buildUnit(overrides: Partial<EventUnit> = {}): EventUnit {
  return {
    unit_key: 'u1',
    event_date: '2030-12-01',
    eligible_grades: ['A', 'B'],
    formal_name: '第10回 札幌春季かるた大会',
    venue: '札幌市民会館',
    fee_jpy: 3500,
    payment_deadline: '2030-11-25',
    payment_info_text: '○○銀行 普通 1234567',
    payment_method: '事前振込',
    entry_method: 'メール申込',
    organizer_text: 'テストかるた会',
    entry_deadline: '2030-11-30',
    kind: 'individual',
    capacity_a: 32,
    capacity_b: 16,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: true,
    ...overrides,
  }
}

/**
 * New-format (PROMPT_VERSION 2.0.0) payload: announcement-wide
 * `short_name_stem` + an `events[]` array of units.
 */
function buildPayload(
  units: EventUnit[],
  shortNameStem: string | null,
): ExtractionPayload {
  return {
    is_tournament_announcement: true,
    confidence: 0.92,
    reason: 'fixture',
    is_correction: false,
    references_subject: null,
    short_name_stem: shortNameStem,
    events: units,
  }
}

// Single-unit announcement: stem '札幌' + grades ['A','B'] → title '札幌AB'.
const SINGLE_UNIT_PAYLOAD = buildPayload([buildUnit()], '札幌')

// Legacy single-`extracted` payload from before the 2.0.0 bump. The web layer
// must still render pending drafts persisted in this shape. Cast through
// unknown because `extracted` is not part of the new ExtractionPayload type.
const LEGACY_PAYLOAD = {
  is_tournament_announcement: true,
  confidence: 0.7,
  reason: 'legacy',
  is_correction: false,
  references_subject: null,
  extracted: {
    title: '第10回テスト大会',
    formal_name: '第10回 札幌春季かるた大会',
    event_date: '2030-12-01',
    venue: '札幌市民会館',
    fee_jpy: 3500,
    payment_deadline: '2030-11-25',
    payment_info_text: '○○銀行 普通 1234567',
    payment_method: '事前振込',
    entry_method: 'メール申込',
    organizer_text: 'テストかるた会',
    entry_deadline: '2030-11-30',
    eligible_grades: ['A'],
    kind: 'individual',
    capacity_total: 64,
    capacity_a: 64,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: true,
  },
} as unknown as ExtractionPayload

async function addSessionCookie(
  context: import('@playwright/test').BrowserContext,
  token: string,
) {
  await context.addCookies([
    {
      name: AUTHJS_SESSION_COOKIE,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

test.describe.configure({ mode: 'serial' })

test.describe('/admin/mail-inbox/[id] approval flow', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('happy path (単一単位): 承認フォーム送信で events 1 件挿入 + draft が approved になる', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Admin Approver' })
    const mail = await createMailMessage({
      subject: '【ご案内】第10回テスト大会',
    })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      confidence: '0.92',
      extractedPayload: SINGLE_UNIT_PAYLOAD,
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/mail-inbox/${draft.id}`)

    // Pre-fill assertions: title = composeTitle('札幌', ['A','B']) = '札幌AB',
    // and the rest of the unit maps onto its namespaced fields.
    await expect(page.locator('input[name="u1__title"]')).toHaveValue('札幌AB')
    await expect(page.locator('input[name="u1__eventDate"]')).toHaveValue(
      '2030-12-01',
    )
    await expect(page.locator('input[name="u1__location"]')).toHaveValue(
      '札幌市民会館',
    )
    await expect(page.locator('input[name="u1__formalName"]')).toHaveValue(
      '第10回 札幌春季かるた大会',
    )
    await expect(page.locator('input[name="u1__feeJpy"]')).toHaveValue('3500')

    // Submit the multi-unit approval form unchanged. The single submit button
    // "選択したイベントを登録" wraps every unit.
    await page.getByRole('button', { name: '選択したイベントを登録' }).click()

    // approveDraftUnits calls revalidatePath but does not redirect, so a
    // successful submit just re-renders the page; wait for the persisted state.
    await expect
      .poll(
        async () => {
          const after = await testDb.query.tournamentDrafts.findFirst({
            where: eq(tournamentDrafts.id, draft.id),
          })
          return after?.status
        },
        { timeout: 10_000 },
      )
      .toBe('approved')

    const after = await testDb.query.tournamentDrafts.findFirst({
      where: eq(tournamentDrafts.id, draft.id),
    })
    expect(after?.approvedByUserId).toBe(admin.userId)
    // Split approvals keep tournament_drafts.event_id null — the source of
    // truth is events.tournament_draft_id.
    expect(after?.eventId).toBeNull()

    const insertedEvents = await testDb
      .select()
      .from(events)
      .where(eq(events.tournamentDraftId, draft.id))
    expect(insertedEvents).toHaveLength(1)
    const inserted = insertedEvents[0]!
    expect(inserted.title).toBe('札幌AB')
    expect(inserted.eventDate).toBe('2030-12-01')
    expect(inserted.tournamentDraftUnitKey).toBe('u1')
    expect(inserted.createdBy).toBe(admin.userId)

    await context.close()
  })

  test('複数単位・部分承認→完了: u2 を外して登録すると u1 のみ作成され、その後「残りは作らず完了」で approved になる', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Admin Splitter' })
    const mail = await createMailMessage({
      subject: '【ご案内】大阪かるた大会（B級/C級）',
    })
    // stem '大阪' + 2 units split by date: u1=B級(1/11), u2=C級(1/12).
    const payload = buildPayload(
      [
        buildUnit({
          unit_key: 'u1',
          eligible_grades: ['B'],
          event_date: '2030-01-11',
          formal_name: '大阪かるた大会 B級',
          capacity_a: null,
          capacity_b: 64,
        }),
        buildUnit({
          unit_key: 'u2',
          eligible_grades: ['C'],
          event_date: '2030-01-12',
          formal_name: '大阪かるた大会 C級',
          capacity_a: null,
          capacity_c: 48,
        }),
      ],
      '大阪',
    )
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: payload,
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/mail-inbox/${draft.id}`)

    // Both units render with grade-composed titles.
    await expect(page.locator('input[name="u1__title"]')).toHaveValue('大阪B')
    await expect(page.locator('input[name="u1__eventDate"]')).toHaveValue(
      '2030-01-11',
    )
    await expect(page.locator('input[name="u2__title"]')).toHaveValue('大阪C')
    await expect(page.locator('input[name="u2__eventDate"]')).toHaveValue(
      '2030-01-12',
    )

    // Deselect u2, then register — only u1 should materialize.
    await page.locator('input[name="u2__register"]').uncheck()
    await page.getByRole('button', { name: '選択したイベントを登録' }).click()

    // Wait for u1's event row to land.
    await expect
      .poll(
        async () => {
          const rows = await testDb
            .select()
            .from(events)
            .where(eq(events.tournamentDraftId, draft.id))
          return rows.length
        },
        { timeout: 10_000 },
      )
      .toBe(1)

    const partialRows = await testDb
      .select()
      .from(events)
      .where(eq(events.tournamentDraftId, draft.id))
    expect(partialRows[0]!.title).toBe('大阪B')
    expect(partialRows[0]!.tournamentDraftUnitKey).toBe('u1')

    // Not all units are materialized (u2 missing) → draft stays pending_review.
    const midDraft = await testDb.query.tournamentDrafts.findFirst({
      where: eq(tournamentDrafts.id, draft.id),
    })
    expect(midDraft?.status).toBe('pending_review')

    // Reload to get a fresh form (u1 now read-only, u2 still editable), then
    // close the draft without creating u2.
    await page.reload()
    await expect(
      page.getByRole('button', { name: '残りは作らず完了' }),
    ).toBeVisible()
    await page.getByRole('button', { name: '残りは作らず完了' }).click()

    await expect
      .poll(
        async () => {
          const after = await testDb.query.tournamentDrafts.findFirst({
            where: eq(tournamentDrafts.id, draft.id),
          })
          return after?.status
        },
        { timeout: 10_000 },
      )
      .toBe('approved')

    // u2 must NOT have been created — still exactly 1 event for this draft.
    const finalRows = await testDb
      .select()
      .from(events)
      .where(eq(events.tournamentDraftId, draft.id))
    expect(finalRows).toHaveLength(1)
    expect(finalRows[0]!.tournamentDraftUnitKey).toBe('u1')

    const finalDraft = await testDb.query.tournamentDrafts.findFirst({
      where: eq(tournamentDrafts.id, draft.id),
    })
    expect(finalDraft?.approvedByUserId).toBe(admin.userId)

    await context.close()
  })

  test('旧形式後方互換: extracted のみの payload も詳細ページが表示され承認で events 作成 + approved になる', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Admin Legacy' })
    const mail = await createMailMessage({ subject: '旧形式メール' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: LEGACY_PAYLOAD,
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    const response = await page.goto(`/admin/mail-inbox/${draft.id}`)
    // The legacy payload must not 500 the detail route.
    expect(response?.ok()).toBe(true)

    // No stem → title falls back to the legacy full `extracted.title`.
    await expect(page.locator('input[name="u1__title"]')).toHaveValue(
      '第10回テスト大会',
    )
    await expect(page.locator('input[name="u1__eventDate"]')).toHaveValue(
      '2030-12-01',
    )

    await page.getByRole('button', { name: '選択したイベントを登録' }).click()

    await expect
      .poll(
        async () => {
          const after = await testDb.query.tournamentDrafts.findFirst({
            where: eq(tournamentDrafts.id, draft.id),
          })
          return after?.status
        },
        { timeout: 10_000 },
      )
      .toBe('approved')

    const insertedEvents = await testDb
      .select()
      .from(events)
      .where(eq(events.tournamentDraftId, draft.id))
    expect(insertedEvents).toHaveLength(1)
    expect(insertedEvents[0]!.title).toBe('第10回テスト大会')
    expect(insertedEvents[0]!.tournamentDraftUnitKey).toBe('u1')

    await context.close()
  })

  test('reject: 却下理由を入力して送信すると draft.status が rejected になり events は作られない', async ({
    browser,
  }) => {
    const admin = await seedAdminSession({ name: 'Admin Rejecter' })
    const mail = await createMailMessage({ subject: '却下対象メール' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: SINGLE_UNIT_PAYLOAD,
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/mail-inbox/${draft.id}`)
    const reasonInput = page.locator('textarea[name="rejection_reason"]')
    await reasonInput.fill('本件は対象外')
    await page.getByRole('button', { name: '却下する' }).click()

    await expect
      .poll(
        async () => {
          const after = await testDb.query.tournamentDrafts.findFirst({
            where: eq(tournamentDrafts.id, draft.id),
          })
          return after?.status
        },
        { timeout: 10_000 },
      )
      .toBe('rejected')

    const after = await testDb.query.tournamentDrafts.findFirst({
      where: eq(tournamentDrafts.id, draft.id),
    })
    expect(after?.rejectionReason).toBe('本件は対象外')
    expect(after?.eventId).toBeNull()

    // No events row should exist as a side effect of rejection.
    const eventRows = await testDb.select().from(events)
    expect(eventRows).toHaveLength(0)

    await context.close()
  })

  test('reextract: 再抽出ボタンが表示される (smoke test)', async ({
    browser,
  }) => {
    // Smoke test only: assert the 再抽出 button is rendered + enabled for a
    // pending_review draft. This does NOT click/submit — submitting would
    // invoke AnthropicSonnet46Extractor, which needs either a working
    // ANTHROPIC_API_KEY or an HTTP intercept for the SDK; both are deferred.
    //
    // The deeper assertions (classifyMail force=true, persistOutcome, status
    // guards, the "already-materialized → refuse" guard) live in the Vitest
    // action test (src/app/(app)/admin/mail-inbox/actions.test.ts).

    const admin = await seedAdminSession({ name: 'Admin Reextractor' })
    const mail = await createMailMessage({ subject: '再抽出対象メール' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: SINGLE_UNIT_PAYLOAD,
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    const detailUrl = `/admin/mail-inbox/${draft.id}`
    const initialResponse = await page.goto(detailUrl)
    expect(initialResponse?.ok()).toBe(true)

    const reextractButton = page.getByRole('button', { name: '再抽出' })
    await expect(reextractButton).toBeVisible()
    await expect(reextractButton).toBeEnabled()

    await context.close()
  })
})
