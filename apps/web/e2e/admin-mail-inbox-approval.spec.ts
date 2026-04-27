import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
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
 * Covers the three operator-facing actions admin sees on a draft detail page:
 *   1. Approve — pre-filled EventForm submission inserts events row + flips
 *      draft.status to 'approved'.
 *   2. Reject — textarea reason + flip to 'rejected', no events row created.
 *   3. Reextract — clicking the button re-renders the page (no 500). The
 *      deeper "classifyMail was called" assertion lives in the Vitest action
 *      tests; here we only need the route to not blow up because LLM stubs
 *      via env are fragile under the real Anthropic SDK constructor.
 */

const SAMPLE_PAYLOAD = {
  is_tournament_announcement: true,
  confidence: 0.92,
  reason: 'fixture',
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
    eligible_grades: ['A', 'B'],
    kind: 'individual' as const,
    capacity_total: 64,
    capacity_a: 32,
    capacity_b: 16,
    capacity_c: 8,
    capacity_d: 4,
    capacity_e: 4,
    official: true,
  },
}

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

  test('happy path: 承認フォーム送信で events 挿入 + draft が approved になる', async ({
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
      extractedPayload: SAMPLE_PAYLOAD,
    })

    const context = await browser.newContext()
    await addSessionCookie(context, admin.sessionToken)
    const page = await context.newPage()

    await page.goto(`/admin/mail-inbox/${draft.id}`)
    // Pre-fill assertion: title input carries the AI-extracted value.
    const titleInput = page.locator('input[name="title"]')
    await expect(titleInput).toHaveValue('第10回テスト大会')
    await expect(page.locator('input[name="eventDate"]')).toHaveValue(
      '2030-12-01',
    )
    await expect(page.locator('input[name="location"]')).toHaveValue(
      '札幌市民会館',
    )

    // Submit the approval form unchanged. Multiple <form> elements live on the
    // page (approve / reject / reextract / link) — pick the one wrapping the
    // title input.
    const approvalForm = page.locator('form', { has: titleInput })
    await approvalForm.getByRole('button', { name: '作成' }).click()

    // The approveDraft Server Action calls revalidatePath but does not
    // redirect, so a successful submit just re-renders the page; wait for
    // the persisted state instead.
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
    expect(after?.eventId).not.toBeNull()
    expect(after?.approvedByUserId).toBe(admin.userId)

    const insertedEvent = await testDb.query.events.findFirst({
      where: eq(events.id, after?.eventId ?? -1),
    })
    expect(insertedEvent?.title).toBe('第10回テスト大会')
    expect(insertedEvent?.eventDate).toBe('2030-12-01')

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
      extractedPayload: SAMPLE_PAYLOAD,
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
    // guards) live in the Vitest action test
    // (src/app/(app)/admin/mail-inbox/actions.test.ts), which mocks the
    // mail-worker classifier surface directly. Form-wiring (`action=
    // reextractAction`) is therefore only loosely covered here — keep the
    // PR4 review r4 follow-up note in mind if the reextract Server Action
    // signature changes.

    const admin = await seedAdminSession({ name: 'Admin Reextractor' })
    const mail = await createMailMessage({ subject: '再抽出対象メール' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
      extractedPayload: SAMPLE_PAYLOAD,
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
