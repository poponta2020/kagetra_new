import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  events,
  mailAttachments,
  mailMessages,
  mailWorkerJobs,
  matches,
  players,
  resultDrafts,
  tournamentDrafts,
  tournaments,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEvent,
  createMailMessage,
  createTournamentDraft,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// review r2 blocker: vi.mock factory は hoist されるため、factory 内で参照する
// mock は通常の top-level const ではなく vi.hoisted で生成する（hoist 前参照=
// TDZ を避ける。anthropic.test.ts と同じパターン）。
const {
  afterMock,
  broadcastMailToEventMock,
  loadActiveBindingMock,
  classifyMailMock,
  persistOutcomeMock,
} = vi.hoisted(() => ({
  // dedup テストで即時実行に差し替えるため切り替え可能（既定 no-op）。
  afterMock: vi.fn((_cb: () => void | Promise<void>) => {}),
  broadcastMailToEventMock: vi.fn(async () => ({
    status: 'skipped' as const,
    reason: 'mocked',
    sentTextCount: 0,
    sentImageCount: 0,
    fallbackLinkCount: 0,
  })),
  loadActiveBindingMock: vi.fn(
    async (_db: unknown, _eventId: number) =>
      null as { lineGroupId: string } | null,
  ),
  classifyMailMock: vi.fn(async () => ({ kind: 'noise' as const, result: {} })),
  persistOutcomeMock: vi.fn(async () => ({})),
}))

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))
// r-final-14 blocker: next/server.after() は Next.js の request scope 外
// (Vitest 直接呼出) で例外を投げる。approveDraft / linkDraftToEvent が
// broadcastMailToEvent を fire-and-forget で呼ぶための after() を no-op
// にモックして、本テストが既存の承認フロー検証だけを扱えるようにする。
//
// tournament-title-grade-split: broadcast の dedup 検証では after() の中身を
// 実行する必要があるので、afterMock を切り替え可能にして既定は no-op、dedup
// テストだけ即時実行に差し替える（afterMock は上の vi.hoisted で生成）。
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => afterMock(cb),
  }
})
// broadcastMailToEvent / loadActiveBinding の実呼び出しはテスト対象外。
// after が直接実行されても LINE 連携ロジックを発火させないようスタブ化する。
// loadActiveBinding は approveDraftUnits の broadcast dedup が呼ぶので、
// 既定は「紐付けなし(null)」を返し、dedup テストで eventId→group を差し替える。
vi.mock('@/lib/line-broadcast', () => ({
  broadcastMailToEvent: broadcastMailToEventMock,
  loadActiveBinding: loadActiveBindingMock,
}))

// Stub the mail-worker classifier surface so reextractDraft does not actually
// call Anthropic. The action only needs `classifyMail` + `persistOutcome` to
// resolve; we capture the call shape for assertions.
vi.mock('@kagetra/mail-worker/classify/classifier', () => ({
  classifyMail: classifyMailMock,
  persistOutcome: persistOutcomeMock,
}))
vi.mock('@kagetra/mail-worker/classify/llm/anthropic', () => ({
  // The action constructs `new AnthropicSonnet46Extractor({ apiKey })` but
  // never invokes the instance directly — the extractor is forwarded into
  // classifyMail (which is itself mocked above).
  AnthropicSonnet46Extractor: class {
    readonly modelId = 'mock'
    constructor(_opts: unknown) {}
  },
}))
vi.mock('@kagetra/mail-worker/config', () => ({
  loadLlmConfig: () => ({ anthropicApiKey: 'mock-anthropic-key' }),
}))

// Import after mocks so `@/auth` and the mail-worker imports resolve to the
// mocked modules.
const {
  approveDraft,
  approveDraftUnits,
  completeDraft,
  rejectDraft,
  linkDraftToEvent,
  reextractDraft,
  triggerMailFetch,
  dismissMail,
  undoTriage,
  triggerExtractDraft,
  linkMailToEvent,
  unlinkMailFromEvent,
  triggerResultParse,
  approveResultDraft,
  rejectResultDraft,
} = await import('./actions')

function buildApproveFormData(overrides: Partial<Record<string, string>> = {}) {
  const fd = new FormData()
  // Required-or-defaulted fields
  fd.set('title', 'AI 抽出から承認した大会')
  fd.set('eventDate', '2030-06-15')
  fd.set('status', 'draft')
  fd.set('kind', 'individual')
  // The checkbox `official` uses 'on' for true; omit to leave false.
  fd.set('official', 'on')
  // Optional fields populated to exercise the full surface
  fd.set('description', '長文の説明')
  fd.set('location', '札幌市民会館')
  fd.set('capacity', '64')
  fd.set('formalName', '第10回テスト大会')
  fd.set('entryDeadline', '2030-06-01')
  fd.set('internalDeadline', '2030-05-25')
  fd.set('feeJpy', '3500')
  fd.set('paymentDeadline', '2030-06-10')
  fd.set('paymentInfo', '○○銀行 普通 1234567')
  fd.set('paymentMethod', '事前振込')
  fd.set('entryMethod', 'メール申込')
  fd.set('organizer', 'テストかるた会')
  fd.set('capacityA', '16')
  fd.set('capacityB', '16')
  fd.set('capacityC', '12')
  fd.set('capacityD', '12')
  fd.set('capacityE', '8')
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) fd.delete(k)
    else fd.set(k, v as string)
  }
  return fd
}

async function getDraft(id: number) {
  return testDb.query.tournamentDrafts.findFirst({
    where: eq(tournamentDrafts.id, id),
  })
}

async function getMail(id: number) {
  return testDb.query.mailMessages.findFirst({
    where: eq(mailMessages.id, id),
  })
}

// ── tournament-title-grade-split helpers ─────────────────────────────────

/** Minimal EventUnit-shaped object for new-format extracted_payload. */
function unit(
  unitKey: string,
  grades: ('A' | 'B' | 'C' | 'D' | 'E')[] | null,
  eventDate: string | null,
) {
  return {
    unit_key: unitKey,
    event_date: eventDate,
    eligible_grades: grades,
    formal_name: null,
    venue: null,
    fee_jpy: null,
    payment_deadline: null,
    payment_info_text: null,
    payment_method: null,
    entry_method: null,
    organizer_text: null,
    entry_deadline: null,
    kind: null,
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: null,
  }
}

function newPayload(units: ReturnType<typeof unit>[], shortNameStem = '大阪') {
  return {
    is_tournament_announcement: true,
    confidence: 0.9,
    reason: 'split',
    short_name_stem: shortNameStem,
    events: units,
  }
}

/**
 * Build the multi-unit approval FormData the ApprovalForm would submit. Each
 * spec entry seeds one unit's title/eventDate/grades, namespaced as
 * `${unitKey}__<field>`, plus a hidden `unit_key` and (when register=true) the
 * register checkbox.
 */
function buildUnitsFormData(
  specs: Array<{
    unitKey: string
    register?: boolean
    title?: string
    eventDate?: string
    grades?: ('A' | 'B' | 'C' | 'D' | 'E')[]
    extra?: Record<string, string>
  }>,
) {
  const fd = new FormData()
  for (const s of specs) {
    fd.append('unit_key', s.unitKey)
    if (s.register !== false) fd.set(`${s.unitKey}__register`, 'on')
    fd.set(`${s.unitKey}__title`, s.title ?? `大会-${s.unitKey}`)
    fd.set(`${s.unitKey}__eventDate`, s.eventDate ?? '2031-01-11')
    fd.set(`${s.unitKey}__status`, 'draft')
    fd.set(`${s.unitKey}__kind`, 'individual')
    fd.set(`${s.unitKey}__official`, 'on')
    for (const g of s.grades ?? []) fd.set(`${s.unitKey}__grade_${g}`, 'on')
    for (const [k, v] of Object.entries(s.extra ?? {})) {
      fd.set(`${s.unitKey}__${k}`, v)
    }
  }
  return fd
}

describe('admin/mail-inbox actions', () => {
  beforeEach(async () => {
    await truncateAll()
    classifyMailMock.mockClear()
    persistOutcomeMock.mockClear()
    broadcastMailToEventMock.mockClear()
    loadActiveBindingMock.mockClear()
    loadActiveBindingMock.mockResolvedValue(null)
    // 既定は no-op (after は実行しない)。dedup テストだけ即時実行に切り替える。
    afterMock.mockReset()
    afterMock.mockImplementation(() => {})
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('approveDraft', () => {
    it('admin が valid なフォームで呼ぶと events を作成し draft を承認状態に遷移させる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ subject: 'approve test' })
      const draft = await createTournamentDraft({ messageId: mail.id })

      await approveDraft(draft.id, buildApproveFormData())

      // events row inserted with the form values (a few representative
      // columns — full schema mapping is exercised via eventFormSchema's
      // own tests).
      const inserted = await testDb.query.events.findFirst({
        where: eq(events.title, 'AI 抽出から承認した大会'),
      })
      expect(inserted).toBeDefined()
      expect(inserted?.eventDate).toBe('2030-06-15')
      expect(inserted?.feeJpy).toBe(3500)
      expect(inserted?.capacityA).toBe(16)
      expect(inserted?.location).toBe('札幌市民会館')
      expect(inserted?.createdBy).toBe(admin.id)

      const after = await getDraft(draft.id)
      expect(after?.status).toBe('approved')
      expect(after?.eventId).toBe(inserted?.id ?? null)
      expect(after?.approvedByUserId).toBe(admin.id)
      expect(after?.approvedAt).toBeInstanceOf(Date)
    })

    it('未認証は Unauthorized を投げる', async () => {
      await setAuthSession(null)
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await expect(
        approveDraft(draft.id, buildApproveFormData()),
      ).rejects.toThrow('Unauthorized')
    })

    it('member ロールは Forbidden を投げる', async () => {
      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await expect(
        approveDraft(draft.id, buildApproveFormData()),
      ).rejects.toThrow('Forbidden')
    })

    it('既に approved な draft は再承認できない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        status: 'approved',
      })

      await expect(
        approveDraft(draft.id, buildApproveFormData()),
      ).rejects.toThrow('draft is not approvable')
    })

    it('superseded な draft も承認できない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        status: 'superseded',
      })

      await expect(
        approveDraft(draft.id, buildApproveFormData()),
      ).rejects.toThrow('draft is not approvable')
    })

    it('ai_failed な draft は救済承認できる (recovery path)', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        status: 'ai_failed',
      })

      await approveDraft(
        draft.id,
        buildApproveFormData({ title: '救済承認した大会' }),
      )

      const after = await getDraft(draft.id)
      expect(after?.status).toBe('approved')
      expect(after?.eventId).not.toBeNull()
    })

    it('rejected な draft は再承認できない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        status: 'rejected',
      })

      await expect(
        approveDraft(draft.id, buildApproveFormData()),
      ).rejects.toThrow('draft is not approvable')

      // Speculative event insert is rolled back with the transaction.
      const eventRows = await testDb.select().from(events)
      expect(eventRows).toHaveLength(0)
    })

    it('feeJpy=0 は無料大会として承認できる (非負整数を許可)', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await approveDraft(
        draft.id,
        buildApproveFormData({ title: '無料大会', feeJpy: '0' }),
      )

      const inserted = await testDb.query.events.findFirst({
        where: eq(events.title, '無料大会'),
      })
      expect(inserted?.feeJpy).toBe(0)
    })

    it('grade_X チェックボックスを eligibleGrades として保存する', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await approveDraft(
        draft.id,
        buildApproveFormData({
          title: '級別承認テスト',
          grade_A: 'on',
          grade_C: 'on',
          grade_E: 'on',
        }),
      )

      const inserted = await testDb.query.events.findFirst({
        where: eq(events.title, '級別承認テスト'),
      })
      expect(inserted).toBeDefined()
      expect(inserted?.eligibleGrades).toEqual(['A', 'C', 'E'])
    })

    it('grade_X が一切 on でない場合 eligibleGrades は NULL', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await approveDraft(
        draft.id,
        buildApproveFormData({ title: '級指定なし' }),
      )

      const inserted = await testDb.query.events.findFirst({
        where: eq(events.title, '級指定なし'),
      })
      expect(inserted?.eligibleGrades).toBeNull()
    })

    it('承認後、対応する mail_messages.status が archived になる', async () => {
      // Regression for worklog 2026-05-12 session 3: approveDraft only
      // updated tournament_drafts.status, so an `ai_failed` mail rescued
      // through manual approval stayed at status='ai_failed' on the mail
      // row, fooling the reextract CLI's filter into retargeting it.
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ status: 'ai_failed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        status: 'ai_failed',
      })

      await approveDraft(
        draft.id,
        buildApproveFormData({ title: '救済承認 + アーカイブ' }),
      )

      const afterMail = await getMail(mail.id)
      expect(afterMail?.status).toBe('archived')
    })
  })

  describe('rejectDraft', () => {
    it('trim 済みの理由で却下状態に遷移する', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      const fd = new FormData()
      fd.set('rejection_reason', '  内容が異なる  ')
      await rejectDraft(draft.id, fd)

      const after = await getDraft(draft.id)
      expect(after?.status).toBe('rejected')
      expect(after?.rejectionReason).toBe('内容が異なる')
      expect(after?.rejectedByUserId).toBe(admin.id)
      expect(after?.rejectedAt).toBeInstanceOf(Date)
    })

    it('rejection_reason が無い場合は必須エラー', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      const fd = new FormData()
      await expect(rejectDraft(draft.id, fd)).rejects.toThrow(/必須/)
    })

    it('空白のみの rejection_reason も必須エラー', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      const fd = new FormData()
      fd.set('rejection_reason', '   ')
      await expect(rejectDraft(draft.id, fd)).rejects.toThrow(/必須/)
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })
      const fd = new FormData()
      fd.set('rejection_reason', 'x')

      await setAuthSession(null)
      await expect(rejectDraft(draft.id, fd)).rejects.toThrow('Unauthorized')

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(rejectDraft(draft.id, fd)).rejects.toThrow('Forbidden')
    })

    it.each([['approved'], ['rejected'], ['superseded']] as const)(
      '%s な draft は再却下できない',
      async (status) => {
        const admin = await createAdmin()
        await setAuthSession({ id: admin.id, role: 'admin' })
        const mail = await createMailMessage()
        const draft = await createTournamentDraft({
          messageId: mail.id,
          status,
        })
        const fd = new FormData()
        fd.set('rejection_reason', '再却下しようとする')

        await expect(rejectDraft(draft.id, fd)).rejects.toThrow(
          'draft is not rejectable',
        )

        // Status must be unchanged (no silent overwrite of finalized state).
        const after = await getDraft(draft.id)
        expect(after?.status).toBe(status)
      },
    )

    it('却下後、対応する mail_messages.status が archived になる', async () => {
      // Companion to approveDraft's archive test — rejection is also an
      // operator-closed terminal state and must sync the mail row.
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ status: 'ai_done' })
      const draft = await createTournamentDraft({ messageId: mail.id })

      const fd = new FormData()
      fd.set('rejection_reason', '対象外の通知')
      await rejectDraft(draft.id, fd)

      const afterMail = await getMail(mail.id)
      expect(afterMail?.status).toBe('archived')
    })
  })

  describe('linkDraftToEvent', () => {
    it('既存 events に draft を紐付ける', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })
      const eventA = await createEvent({ title: 'Existing A' })
      await createEvent({ title: 'Existing B' })

      await linkDraftToEvent(draft.id, eventA.id)

      const after = await getDraft(draft.id)
      expect(after?.status).toBe('approved')
      expect(after?.eventId).toBe(eventA.id)
      expect(after?.approvedByUserId).toBe(admin.id)
      expect(after?.approvedAt).toBeInstanceOf(Date)
    })

    it('対象 event が存在しない場合は Event not found', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await expect(linkDraftToEvent(draft.id, 999999)).rejects.toThrow(
        'Event not found',
      )
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })
      const event = await createEvent({ title: 'L' })

      await setAuthSession(null)
      await expect(linkDraftToEvent(draft.id, event.id)).rejects.toThrow(
        'Unauthorized',
      )

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(linkDraftToEvent(draft.id, event.id)).rejects.toThrow(
        'Forbidden',
      )
    })

    it.each([['approved'], ['rejected'], ['superseded']] as const)(
      '%s な draft は既存 events に紐付け直せない',
      async (status) => {
        const admin = await createAdmin()
        await setAuthSession({ id: admin.id, role: 'admin' })
        const mail = await createMailMessage()
        const draft = await createTournamentDraft({
          messageId: mail.id,
          status,
        })
        const event = await createEvent({ title: 'Target' })

        await expect(linkDraftToEvent(draft.id, event.id)).rejects.toThrow(
          'draft is not linkable',
        )

        const after = await getDraft(draft.id)
        expect(after?.status).toBe(status)
      },
    )

    it('既存 events 紐付け後、対応する mail_messages.status が archived になる', async () => {
      // Companion to approveDraft's archive test — linking is also an
      // operator-closed terminal state and must sync the mail row.
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ status: 'ai_done' })
      const draft = await createTournamentDraft({ messageId: mail.id })
      const target = await createEvent({ title: 'Link target' })

      await linkDraftToEvent(draft.id, target.id)

      const afterMail = await getMail(mail.id)
      expect(afterMail?.status).toBe('archived')
    })
  })

  describe('reextractDraft', () => {
    it('対象メールの id を classifyMail に force=true で渡し、persistOutcome に転送する', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ subject: 'reextract subject' })
      const draft = await createTournamentDraft({ messageId: mail.id })

      await reextractDraft(draft.id)

      expect(classifyMailMock).toHaveBeenCalledTimes(1)
      const classifyArgs = classifyMailMock.mock.calls[0] as unknown as
        | [unknown, number, unknown, { force?: boolean }]
        | undefined
      expect(classifyArgs?.[1]).toBe(mail.id)
      expect(classifyArgs?.[3]).toEqual({ force: true })

      expect(persistOutcomeMock).toHaveBeenCalledTimes(1)
      const persistArgs = persistOutcomeMock.mock.calls[0] as unknown as
        | [unknown, number, unknown]
        | undefined
      expect(persistArgs?.[1]).toBe(mail.id)
    })

    it('draft が無いと draft not found を投げる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      await expect(reextractDraft(999999)).rejects.toThrow('draft not found')
      expect(classifyMailMock).not.toHaveBeenCalled()
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await setAuthSession(null)
      await expect(reextractDraft(draft.id)).rejects.toThrow('Unauthorized')

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(reextractDraft(draft.id)).rejects.toThrow('Forbidden')

      expect(classifyMailMock).not.toHaveBeenCalled()
    })

    it.each([['approved'], ['rejected'], ['superseded']] as const)(
      '%s な draft は再抽出できない (classifyMail を呼ばない)',
      async (status) => {
        const admin = await createAdmin()
        await setAuthSession({ id: admin.id, role: 'admin' })
        const mail = await createMailMessage()
        const draft = await createTournamentDraft({
          messageId: mail.id,
          status,
        })

        await expect(reextractDraft(draft.id)).rejects.toThrow(
          'draft is not reextractable',
        )
        expect(classifyMailMock).not.toHaveBeenCalled()
      },
    )

    it('ai_failed な draft は再抽出できる (recovery path)', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        status: 'ai_failed',
      })

      await reextractDraft(draft.id)
      expect(classifyMailMock).toHaveBeenCalledTimes(1)
    })

    it('materialize 済みイベントがある draft は再抽出できない (新ガード)', async () => {
      // tournament-title-grade-split: re-extraction rewrites the payload and
      // would orphan events already created from this draft.
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        status: 'pending_review',
      })
      await createEvent({
        title: '大阪B',
        tournamentDraftId: draft.id,
        tournamentDraftUnitKey: 'u1',
      })

      await expect(reextractDraft(draft.id)).rejects.toThrow(
        '既にイベントが作成済みのため再抽出できません',
      )
      expect(classifyMailMock).not.toHaveBeenCalled()
    })
  })

  describe('approveDraftUnits (複数イベント承認)', () => {
    it('全単位 register → 全 events 作成 + draft approved + mail archived/processed', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['B'], '2031-01-11'),
          unit('u2', ['C'], '2031-01-12'),
        ]),
      })

      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([
          { unitKey: 'u1', title: '大阪B', eventDate: '2031-01-11', grades: ['B'] },
          { unitKey: 'u2', title: '大阪C', eventDate: '2031-01-12', grades: ['C'] },
        ]),
      )

      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(2)
      const byKey = new Map(rows.map((r) => [r.tournamentDraftUnitKey, r]))
      expect(byKey.get('u1')?.title).toBe('大阪B')
      expect(byKey.get('u1')?.eligibleGrades).toEqual(['B'])
      expect(byKey.get('u1')?.createdBy).toBe(admin.id)
      expect(byKey.get('u2')?.title).toBe('大阪C')
      expect(byKey.get('u2')?.eligibleGrades).toEqual(['C'])

      const after = await getDraft(draft.id)
      expect(after?.status).toBe('approved')
      expect(after?.approvedByUserId).toBe(admin.id)
      // 分割承認では eventId は使わない (events.tournament_draft_id が正)。
      expect(after?.eventId).toBeNull()

      const afterMail = await getMail(mail.id)
      expect(afterMail?.status).toBe('archived')
      expect(afterMail?.triageStatus).toBe('processed')
    })

    // tournament-entry-rosters flow①: 開催(edition) 紐付け ─────────────────
    it('editionLink ON + 既存系列 → 既存 edition に全 events を紐付ける', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['B'], '2031-01-11'),
          unit('u2', ['C'], '2031-01-12'),
        ]),
      })
      // 既存系列＋既存 edition を seed。
      const [series] = await testDb
        .insert(tournamentSeries)
        .values({ name: 'こばえちゃ山形酒田大会', kind: 'individual' })
        .returning({ id: tournamentSeries.id })
      const [edition] = await testDb
        .insert(tournamentSeriesEditions)
        .values({ seriesId: series!.id, editionNumber: 28, year: 2031, status: 'held' })
        .returning({ id: tournamentSeriesEditions.id })

      const fd = buildUnitsFormData([
        { unitKey: 'u1', grades: ['B'], eventDate: '2031-01-11' },
        { unitKey: 'u2', grades: ['C'], eventDate: '2031-01-12' },
      ])
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', 'こばえちゃ山形酒田大会')
      fd.set('editionNumber', '28')

      await approveDraftUnits(draft.id, fd)

      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.editionId === edition!.id)).toBe(true)
      // 既存 edition を解決しただけ＝新規作成していない（1 行のまま）。
      const allEditions = await testDb.select().from(tournamentSeriesEditions)
      expect(allEditions).toHaveLength(1)
    })

    it('editionLink ON + 未知系列 → 新規 series+edition を作成して紐付ける', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([unit('u1', ['A'], '2031-03-20')]),
      })

      const fd = buildUnitsFormData([
        { unitKey: 'u1', grades: ['A'], eventDate: '2031-03-20' },
      ])
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', '新設テスト大会')
      fd.set('editionNumber', '1')
      // Codex R3: 新規系列作成は明示フラグが必要
      fd.set('editionCreateNewSeries', 'on')

      await approveDraftUnits(draft.id, fd)

      const series = await testDb
        .select()
        .from(tournamentSeries)
        .where(eq(tournamentSeries.name, '新設テスト大会'))
      expect(series).toHaveLength(1)
      const ed = await testDb
        .select()
        .from(tournamentSeriesEditions)
        .where(eq(tournamentSeriesEditions.seriesId, series[0]!.id))
      expect(ed).toHaveLength(1)
      expect(ed[0]?.editionNumber).toBe(1)
      // year は event_date の年から導出、status は案内由来＝unconfirmed。
      expect(ed[0]?.year).toBe(2031)
      expect(ed[0]?.status).toBe('unconfirmed')
      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows[0]?.editionId).toBe(ed[0]!.id)
    })

    it('editionLink ON + 未知系列 + 新規作成フラグなし → 入力エラー（Codex R3 blocker）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([unit('u1', ['A'], '2031-03-20')]),
      })
      const fd = buildUnitsFormData([{ unitKey: 'u1', grades: ['A'], eventDate: '2031-03-20' }])
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', 'どこにもない大会')
      fd.set('editionNumber', '1')
      // editionCreateNewSeries を付けない → 新規系列を silent 作成しないため throw
      await expect(approveDraftUnits(draft.id, fd)).rejects.toThrow(/新規系列として作成/)
      // tx rollback で events も series も作られない
      expect(
        await testDb.select().from(events).where(eq(events.tournamentDraftId, draft.id)),
      ).toHaveLength(0)
      expect(await testDb.select().from(tournamentSeries)).toHaveLength(0)
    })

    it('editionLink ON + team unit で新規系列 → series.kind=team（Codex R4 should_fix）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([unit('u1', ['A'], '2031-03-20')]),
      })
      const fd = buildUnitsFormData([
        { unitKey: 'u1', grades: ['A'], eventDate: '2031-03-20', extra: { kind: 'team' } },
      ])
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', '団体新設大会')
      fd.set('editionNumber', '1')
      fd.set('editionCreateNewSeries', 'on')
      await approveDraftUnits(draft.id, fd)
      const series = await testDb
        .select()
        .from(tournamentSeries)
        .where(eq(tournamentSeries.name, '団体新設大会'))
      expect(series[0]?.kind).toBe('team')
    })

    it('editionLink ON + 個人/団体 混在 → 入力エラー（Codex R4）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['A'], '2031-03-20'),
          unit('u2', ['B'], '2031-03-21'),
        ]),
      })
      const fd = buildUnitsFormData([
        { unitKey: 'u1', grades: ['A'], extra: { kind: 'individual' } },
        { unitKey: 'u2', grades: ['B'], extra: { kind: 'team' } },
      ])
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', '混在大会')
      fd.set('editionNumber', '1')
      fd.set('editionCreateNewSeries', 'on')
      await expect(approveDraftUnits(draft.id, fd)).rejects.toThrow(/混在/)
    })

    it('部分承認: 既存 individual event + 後から team unit を editionLink ON → 混在エラー（R5 blocker）', async () => {
      // batch2 で team unit だけ送る（u1 は登録済みで再送されない）。parsedUnits だけ見ると
      // team 単一で見逃すが、既存 events の kind も含めて検証するので弾けることを確認。
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['A'], '2031-03-20'),
          unit('u2', ['B'], '2031-03-21'),
        ]),
      })
      // batch1: u1 を individual で承認（editionLink なし）
      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([
          { unitKey: 'u1', grades: ['A'], eventDate: '2031-03-20', extra: { kind: 'individual' } },
          { unitKey: 'u2', grades: ['B'], eventDate: '2031-03-21', register: false },
        ]),
      )
      // batch2: u2 を team で editionLink ON（u1 は再送しない）
      const fd2 = buildUnitsFormData([
        { unitKey: 'u1', grades: ['A'], eventDate: '2031-03-20', register: false },
        { unitKey: 'u2', grades: ['B'], eventDate: '2031-03-21', extra: { kind: 'team' } },
      ])
      fd2.set('editionLink', 'on')
      fd2.set('editionSeriesName', '混在テスト大会')
      fd2.set('editionNumber', '1')
      fd2.set('editionCreateNewSeries', 'on')
      await expect(approveDraftUnits(draft.id, fd2)).rejects.toThrow(/混在/)
    })

    it('editionLink OFF → events.edition_id は null（非破壊）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([unit('u1', ['A'], '2031-03-20')]),
      })
      const fd = buildUnitsFormData([{ unitKey: 'u1', grades: ['A'] }])
      // editionLink を付けない
      await approveDraftUnits(draft.id, fd)
      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows[0]?.editionId).toBeNull()
      expect(await testDb.select().from(tournamentSeriesEditions)).toHaveLength(0)
    })

    it('editionLink ON + 回次空 → 入力エラーで弾く', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([unit('u1', ['A'], '2031-03-20')]),
      })
      const fd = buildUnitsFormData([{ unitKey: 'u1', grades: ['A'] }])
      fd.set('editionLink', 'on')
      fd.set('editionSeriesName', '新設テスト大会')
      // editionNumber を付けない
      await expect(approveDraftUnits(draft.id, fd)).rejects.toThrow(/回次/)
      // tx 前の検証なので events は作られていない
      expect(
        await testDb.select().from(events).where(eq(events.tournamentDraftId, draft.id)),
      ).toHaveLength(0)
    })

    it('部分承認で後から editionLink ON → 既存 event も同じ edition に backfill（Codex R1 blocker）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['B'], '2031-01-11'),
          unit('u2', ['C'], '2031-01-12'),
        ]),
      })
      // batch1: u1 のみ承認・editionLink なし → edition_id null
      const fd1 = buildUnitsFormData([
        { unitKey: 'u1', grades: ['B'], eventDate: '2031-01-11' },
        { unitKey: 'u2', grades: ['C'], eventDate: '2031-01-12', register: false },
      ])
      await approveDraftUnits(draft.id, fd1)
      const afterBatch1 = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(afterBatch1).toHaveLength(1)
      expect(afterBatch1[0]?.editionId).toBeNull()

      // batch2: u2 を editionLink ON で承認 → 既存 u1 も同じ edition に収束する
      const fd2 = buildUnitsFormData([
        { unitKey: 'u1', grades: ['B'], eventDate: '2031-01-11' },
        { unitKey: 'u2', grades: ['C'], eventDate: '2031-01-12' },
      ])
      fd2.set('editionLink', 'on')
      fd2.set('editionSeriesName', 'こばえちゃ山形酒田大会')
      fd2.set('editionNumber', '28')
      fd2.set('editionCreateNewSeries', 'on') // R3: 未 seed のため新規作成を明示
      await approveDraftUnits(draft.id, fd2)

      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(2)
      const editionIds = new Set(rows.map((r) => r.editionId))
      expect(editionIds.size).toBe(1) // 全 events が同一 edition
      expect([...editionIds][0]).not.toBeNull()
    })

    it('一部 register (2 中 1) → 1 event 作成・draft pending・mail 据え置き、残りを後から承認すると approved に遷移', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['B'], '2031-01-11'),
          unit('u2', ['C'], '2031-01-12'),
        ]),
      })

      // u2 のチェックを外して u1 だけ登録。
      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([
          { unitKey: 'u1', title: '大阪B', grades: ['B'] },
          { unitKey: 'u2', register: false, title: '大阪C', grades: ['C'] },
        ]),
      )

      let rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.tournamentDraftUnitKey).toBe('u1')

      let after = await getDraft(draft.id)
      expect(after?.status).toBe('pending_review')
      let afterMail = await getMail(mail.id)
      // 据え置き: archived にしない、triage も unprocessed のまま。
      expect(afterMail?.status).not.toBe('archived')
      expect(afterMail?.triageStatus).toBe('unprocessed')

      // 残りの u2 を後から登録 → 全 materialize で approved に遷移。
      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([
          { unitKey: 'u1', title: '大阪B', grades: ['B'] },
          { unitKey: 'u2', title: '大阪C', grades: ['C'] },
        ]),
      )

      rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(2)

      after = await getDraft(draft.id)
      expect(after?.status).toBe('approved')
      afterMail = await getMail(mail.id)
      expect(afterMail?.status).toBe('archived')
      expect(afterMail?.triageStatus).toBe('processed')
    })

    it('同一単位を二重 approveDraftUnits してもイベントが重複作成されない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([unit('u1', ['B'], '2031-01-11')]),
      })

      const fd1 = buildUnitsFormData([{ unitKey: 'u1', title: '大阪B', grades: ['B'] }])
      await approveDraftUnits(draft.id, fd1)
      // 全単位 materialize → draft は approved になるので、二度目は status guard で
      // 弾かれる (draft is not approvable)。重複 INSERT が起きないことを確認する。
      await expect(
        approveDraftUnits(
          draft.id,
          buildUnitsFormData([{ unitKey: 'u1', title: '大阪B', grades: ['B'] }]),
        ),
      ).rejects.toThrow('draft is not approvable')

      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(1)
    })

    it('部分承認後の同一単位再送はイベントを重複作成しない (idempotency)', async () => {
      // pending のまま残る部分承認で、同じ単位を 2 回登録しても 1 行だけ。
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['B'], '2031-01-11'),
          unit('u2', ['C'], '2031-01-12'),
        ]),
      })

      // 1 回目: u1 のみ。
      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([{ unitKey: 'u1', title: '大阪B', grades: ['B'] }]),
      )
      // 2 回目: u1 を再送 (誤操作)。重複しないこと。
      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([{ unitKey: 'u1', title: '大阪B(再)', grades: ['B'] }]),
      )

      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(1)
      // 最初の値が保持される (重複 INSERT もスキップも上書きしない)。
      expect(rows[0]?.title).toBe('大阪B')
      // draft はまだ pending (u2 未登録)。
      expect((await getDraft(draft.id))?.status).toBe('pending_review')
    })

    it('register が 0 件なら throw (登録するイベントが選択されていません)', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([unit('u1', ['B'], '2031-01-11')]),
      })

      await expect(
        approveDraftUnits(
          draft.id,
          buildUnitsFormData([{ unitKey: 'u1', register: false }]),
        ),
      ).rejects.toThrow('登録するイベントが選択されていません')
      const rows = await testDb.select().from(events)
      expect(rows).toHaveLength(0)
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([unit('u1', ['B'], '2031-01-11')]),
      })
      const fd = buildUnitsFormData([{ unitKey: 'u1', grades: ['B'] }])

      await setAuthSession(null)
      await expect(approveDraftUnits(draft.id, fd)).rejects.toThrow('Unauthorized')

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(approveDraftUnits(draft.id, fd)).rejects.toThrow('Forbidden')
    })

    it.each([['approved'], ['rejected'], ['superseded']] as const)(
      '%s な draft は承認できない',
      async (status) => {
        const admin = await createAdmin()
        await setAuthSession({ id: admin.id, role: 'admin' })
        const mail = await createMailMessage()
        const draft = await createTournamentDraft({
          messageId: mail.id,
          status,
          extractedPayload: newPayload([unit('u1', ['B'], '2031-01-11')]),
        })

        await expect(
          approveDraftUnits(
            draft.id,
            buildUnitsFormData([{ unitKey: 'u1', grades: ['B'] }]),
          ),
        ).rejects.toThrow('draft is not approvable')
        const rows = await testDb.select().from(events)
        expect(rows).toHaveLength(0)
      },
    )

    it('旧形式 payload (extracted) を 1 単位 u1 として承認できる (後方互換)', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: {
          is_tournament_announcement: true,
          confidence: 0.8,
          reason: 'legacy',
          extracted: { title: '旧形式大会', event_date: '2031-02-02' },
        },
      })

      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([
          { unitKey: 'u1', title: '旧形式大会', eventDate: '2031-02-02' },
        ]),
      )

      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.tournamentDraftUnitKey).toBe('u1')
      // 旧形式は u1 のみなので 1 単位 materialize で approved に遷移する。
      expect((await getDraft(draft.id))?.status).toBe('approved')
    })
  })

  describe('completeDraft (残りは作らず完了)', () => {
    it('残単位を作らず draft approved + mail processed にする', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['B'], '2031-01-11'),
          unit('u2', ['C'], '2031-01-12'),
        ]),
      })

      // u1 だけ登録 (pending のまま)。
      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([{ unitKey: 'u1', title: '大阪B', grades: ['B'] }]),
      )
      expect((await getDraft(draft.id))?.status).toBe('pending_review')

      // 残り (u2) を作らず完了。
      await completeDraft(draft.id)

      const after = await getDraft(draft.id)
      expect(after?.status).toBe('approved')
      expect(after?.approvedByUserId).toBe(admin.id)
      const afterMail = await getMail(mail.id)
      expect(afterMail?.status).toBe('archived')
      expect(afterMail?.triageStatus).toBe('processed')
      // u2 は作られないまま。
      const rows = await testDb
        .select()
        .from(events)
        .where(eq(events.tournamentDraftId, draft.id))
      expect(rows).toHaveLength(1)
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await setAuthSession(null)
      await expect(completeDraft(draft.id)).rejects.toThrow('Unauthorized')

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(completeDraft(draft.id)).rejects.toThrow('Forbidden')
    })

    it.each([['approved'], ['rejected'], ['superseded']] as const)(
      '%s な draft は完了できない',
      async (status) => {
        const admin = await createAdmin()
        await setAuthSession({ id: admin.id, role: 'admin' })
        const mail = await createMailMessage()
        const draft = await createTournamentDraft({ messageId: mail.id, status })

        await expect(completeDraft(draft.id)).rejects.toThrow(
          'draft is not approvable',
        )
        expect((await getDraft(draft.id))?.status).toBe(status)
      },
    )
  })

  describe('approveDraftUnits — LINE 配信の重複排除', () => {
    it('同一 lineGroupId に紐づく 2 イベントで broadcast は 1 回だけ', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['B'], '2031-01-11'),
          unit('u2', ['C'], '2031-01-12'),
        ]),
      })

      // 両イベントとも同じ大阪グループに紐付くと仮定する。
      loadActiveBindingMock.mockResolvedValue({ lineGroupId: 'G_OSAKA' })
      // after() の callback は fire-and-forget。テストでは捕捉して明示的に
      // await し、broadcast 完了後に発火回数を検証する (microtask 競合回避)。
      let afterCb: (() => void | Promise<void>) | null = null
      afterMock.mockImplementation((cb: () => void | Promise<void>) => {
        afterCb = cb
      })

      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([
          { unitKey: 'u1', title: '大阪B', grades: ['B'] },
          { unitKey: 'u2', title: '大阪C', grades: ['C'] },
        ]),
      )
      expect(afterCb).not.toBeNull()
      await afterCb!()

      // 2 イベント作成・同一グループ → broadcastMailToEvent は 1 回だけ。
      expect(broadcastMailToEventMock).toHaveBeenCalledTimes(1)
    })

    it('異なる lineGroupId なら 2 イベントで broadcast 2 回', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({
        messageId: mail.id,
        extractedPayload: newPayload([
          unit('u1', ['B'], '2031-01-11'),
          unit('u2', ['C'], '2031-01-12'),
        ]),
      })

      // eventId ごとに別グループを返す。
      let call = 0
      loadActiveBindingMock.mockImplementation(async () => {
        call += 1
        return { lineGroupId: `G_${call}` }
      })
      let afterCb: (() => void | Promise<void>) | null = null
      afterMock.mockImplementation((cb: () => void | Promise<void>) => {
        afterCb = cb
      })

      await approveDraftUnits(
        draft.id,
        buildUnitsFormData([
          { unitKey: 'u1', title: '大阪B', grades: ['B'] },
          { unitKey: 'u2', title: '大阪C', grades: ['C'] },
        ]),
      )
      expect(afterCb).not.toBeNull()
      await afterCb!()

      expect(broadcastMailToEventMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('triggerMailFetch', () => {
    function buildFormData(
      preset: '24h' | '3d' | '7d' | 'custom',
      customDate?: string,
    ) {
      const fd = new FormData()
      fd.set('preset', preset)
      if (customDate !== undefined) fd.set('customDate', customDate)
      return fd
    }

    it('admin が 7d preset で job を予約できる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const before = Date.now()
      const result = await triggerMailFetch(buildFormData('7d'))

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      expect(typeof result.jobId).toBe('number')

      const job = await testDb.query.mailWorkerJobs.findFirst({
        where: eq(mailWorkerJobs.id, result.jobId),
      })
      expect(job?.status).toBe('pending')
      expect(job?.requestedByUserId).toBe(admin.id)
      // since should land roughly 7 days before "now" (within a few seconds
      // of the call). Use a generous window so a slow CI host doesn't flake.
      const sevenDaysMs = 7 * 24 * 3600 * 1000
      const sinceMs = job?.since?.getTime() ?? -1
      expect(sinceMs).toBeGreaterThanOrEqual(before - sevenDaysMs - 5000)
      expect(sinceMs).toBeLessThanOrEqual(before - sevenDaysMs + 5000)
    })

    it('vice_admin も予約できる', async () => {
      const vice = await createUser({ role: 'vice_admin' })
      await setAuthSession({ id: vice.id, role: 'vice_admin' })

      const result = await triggerMailFetch(buildFormData('7d'))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')

      const job = await testDb.query.mailWorkerJobs.findFirst({
        where: eq(mailWorkerJobs.id, result.jobId),
      })
      expect(job?.requestedByUserId).toBe(vice.id)
    })

    it('未認証は Unauthorized を投げる (job は作られない)', async () => {
      await setAuthSession(null)

      await expect(triggerMailFetch(buildFormData('7d'))).rejects.toThrow(
        'Unauthorized',
      )
      const jobs = await testDb.select().from(mailWorkerJobs)
      expect(jobs).toHaveLength(0)
    })

    it('member ロールは Forbidden を投げる (job は作られない)', async () => {
      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })

      await expect(triggerMailFetch(buildFormData('7d'))).rejects.toThrow(
        'Forbidden',
      )
      const jobs = await testDb.select().from(mailWorkerJobs)
      expect(jobs).toHaveLength(0)
    })

    it('preset=24h で since が ~24h 前', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const before = Date.now()

      const result = await triggerMailFetch(buildFormData('24h'))
      if (!result.ok) throw new Error('expected ok')
      const job = await testDb.query.mailWorkerJobs.findFirst({
        where: eq(mailWorkerJobs.id, result.jobId),
      })
      const expected = before - 24 * 3600 * 1000
      const sinceMs = job?.since?.getTime() ?? -1
      expect(sinceMs).toBeGreaterThanOrEqual(expected - 5000)
      expect(sinceMs).toBeLessThanOrEqual(expected + 5000)
    })

    it('preset=3d で since が ~3 days 前', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const before = Date.now()

      const result = await triggerMailFetch(buildFormData('3d'))
      if (!result.ok) throw new Error('expected ok')
      const job = await testDb.query.mailWorkerJobs.findFirst({
        where: eq(mailWorkerJobs.id, result.jobId),
      })
      const expected = before - 3 * 24 * 3600 * 1000
      const sinceMs = job?.since?.getTime() ?? -1
      expect(sinceMs).toBeGreaterThanOrEqual(expected - 5000)
      expect(sinceMs).toBeLessThanOrEqual(expected + 5000)
    })

    it('preset=custom + customDate=2026-04-20 で since が JST 0:00', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await triggerMailFetch(
        buildFormData('custom', '2026-04-20'),
      )
      if (!result.ok) throw new Error('expected ok')

      const job = await testDb.query.mailWorkerJobs.findFirst({
        where: eq(mailWorkerJobs.id, result.jobId),
      })
      // 2026-04-20T00:00:00+09:00 === 2026-04-19T15:00:00Z
      expect(job?.since?.toISOString()).toBe('2026-04-19T15:00:00.000Z')
    })

    it('preset=custom で customDate 欠如だと invalid form input', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await triggerMailFetch(buildFormData('custom'))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected error')
      expect(result.error).toBe('invalid form input')

      const jobs = await testDb.select().from(mailWorkerJobs)
      expect(jobs).toHaveLength(0)
    })

    it('preset=custom で customDate が regex 違反だと invalid form input', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await triggerMailFetch(
        buildFormData('custom', '2026/04/20'),
      )
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected error')
      expect(result.error).toBe('invalid form input')

      const jobs = await testDb.select().from(mailWorkerJobs)
      expect(jobs).toHaveLength(0)
    })

    it('未知の preset は invalid form input', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const fd = new FormData()
      fd.set('preset', 'bogus')
      const result = await triggerMailFetch(fd)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected error')
      expect(result.error).toBe('invalid form input')
    })

    it('未来日付の customDate は弾く', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      // Pick a date safely in the future so the test stays valid as the
      // current date marches forward.
      const future = new Date(Date.now() + 365 * 24 * 3600 * 1000)
      const yyyy = future.getUTCFullYear()
      const mm = String(future.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(future.getUTCDate()).padStart(2, '0')
      const result = await triggerMailFetch(
        buildFormData('custom', `${yyyy}-${mm}-${dd}`),
      )
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected error')
      expect(result.error).toMatch(/未来/)

      const jobs = await testDb.select().from(mailWorkerJobs)
      expect(jobs).toHaveLength(0)
    })

    it('mail_worker_jobs に INSERT され status=pending、戻り値 { ok: true, jobId }', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await triggerMailFetch(buildFormData('24h'))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok')
      expect(result.jobId).toBeGreaterThan(0)

      const jobs = await testDb.select().from(mailWorkerJobs)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]?.id).toBe(result.jobId)
      expect(jobs[0]?.status).toBe('pending')
    })
  })

  describe('triage actions (mail-triage-badge)', () => {
    it('dismissMail: メールを processed にし triaged_at/by を記録する', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      await dismissMail(mail.id)

      const after = await getMail(mail.id)
      expect(after?.triageStatus).toBe('processed')
      expect(after?.triagedAt).toBeInstanceOf(Date)
      expect(after?.triagedByUserId).toBe(admin.id)
    })

    // mail-inbox-mailer: deferMail / deferred 状態は廃止。
    // 「保留」は処理せず放置することが暗黙の保留である、というモデルに統合。

    // Codex r4 blocker: dismissMail は未完了 draft があるメールを processed に
    // しない (AI 抽出中 / レビュー待ち draft を未処理キューから隠さない)。
    it.each([
      ['ai_processing'],
      ['pending_review'],
      ['ai_failed'],
    ] as const)(
      'dismissMail は %s draft があるメールでは拒否される',
      async (status) => {
        const admin = await createAdmin()
        await setAuthSession({ id: admin.id, role: 'admin' })
        const mail = await createMailMessage({ triageStatus: 'unprocessed' })
        await createTournamentDraft({
          messageId: mail.id,
          status,
        })

        await expect(dismissMail(mail.id)).rejects.toThrow(
          /未完了の AI 抽出 draft/,
        )

        // triage は unprocessed のまま。
        const after = await getMail(mail.id)
        expect(after?.triageStatus).toBe('unprocessed')
      },
    )

    it('dismissMail は terminal draft (approved/rejected/superseded) なら通る', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createTournamentDraft({
        messageId: mail.id,
        status: 'rejected',
      })

      await dismissMail(mail.id)

      const after = await getMail(mail.id)
      expect(after?.triageStatus).toBe('processed')
    })

    it('undoTriage: unprocessed に戻し triaged_at/by をクリアする', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'processed' })

      await undoTriage(mail.id)

      const after = await getMail(mail.id)
      expect(after?.triageStatus).toBe('unprocessed')
      expect(after?.triagedAt).toBeNull()
      expect(after?.triagedByUserId).toBeNull()
    })

    it('存在しない mail は mail not found を投げる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      await expect(dismissMail(999999)).rejects.toThrow('mail not found')
      await expect(undoTriage(999999)).rejects.toThrow('mail not found')
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()

      await setAuthSession(null)
      await expect(dismissMail(mail.id)).rejects.toThrow('Unauthorized')

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(dismissMail(mail.id)).rejects.toThrow('Forbidden')
    })

    it('approveDraft はメールを triage_status=processed にする', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({ messageId: mail.id })

      await approveDraft(draft.id, buildApproveFormData({ title: 'triage 承認検証' }))

      const after = await getMail(mail.id)
      expect(after?.triageStatus).toBe('processed')
      expect(after?.triagedByUserId).toBe(admin.id)
    })

    it('rejectDraft はメールを triage_status=processed にする', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({ messageId: mail.id })

      const fd = new FormData()
      fd.set('rejection_reason', 'triage 却下検証')
      await rejectDraft(draft.id, fd)

      const after = await getMail(mail.id)
      expect(after?.triageStatus).toBe('processed')
    })

    it('linkDraftToEvent はメールを triage_status=processed にする', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const draft = await createTournamentDraft({ messageId: mail.id })
      const event = await createEvent({ title: 'triage link 検証' })

      await linkDraftToEvent(draft.id, event.id)

      const after = await getMail(mail.id)
      expect(after?.triageStatus).toBe('processed')
    })
  })

  // ── mail-inbox-mailer task3: triggerExtractDraft / linkMailToEvent / unlinkMailFromEvent ──
  describe('triggerExtractDraft (mail-inbox-mailer)', () => {
    it('draft なし: 新規 tournament_drafts(status=ai_processing) + manual_extract job を作る', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      const result = await triggerExtractDraft(mail.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const draft = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.id, result.draftId))
      expect(draft).toHaveLength(1)
      expect(draft[0]!.status).toBe('ai_processing')
      expect(draft[0]!.messageId).toBe(mail.id)
      expect(draft[0]!.promptVersion).toBe('')
      expect(draft[0]!.aiModel).toBe('')
      expect(draft[0]!.extractedPayload).toEqual({})

      const job = await testDb
        .select()
        .from(mailWorkerJobs)
        .where(eq(mailWorkerJobs.id, result.jobId))
      expect(job).toHaveLength(1)
      expect(job[0]!.kind).toBe('manual_extract')
      expect(job[0]!.status).toBe('pending')
      expect(job[0]!.payload).toEqual({ mail_message_id: mail.id })
      expect(job[0]!.requestedByUserId).toBe(admin.id)

      // 未処理バッジには残す（draft 作成だけで processed にはしない）。
      const afterMail = await getMail(mail.id)
      expect(afterMail?.triageStatus).toBe('unprocessed')
    })

    it('既存 ai_failed draft: status=ai_processing にリセット + 新ジョブ enqueue', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const existing = await createTournamentDraft({
        messageId: mail.id,
        status: 'ai_failed',
        promptVersion: '1.0.0',
        aiModel: 'claude-sonnet-4-5',
        extractedPayload: { dummy: true },
      })

      const result = await triggerExtractDraft(mail.id)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // 同じ draft 行が UPDATE される (UNIQUE 制約より)。
      expect(result.draftId).toBe(existing.id)

      const after = await testDb
        .select()
        .from(tournamentDrafts)
        .where(eq(tournamentDrafts.id, existing.id))
      expect(after[0]!.status).toBe('ai_processing')
      expect(after[0]!.promptVersion).toBe('')
      expect(after[0]!.aiModel).toBe('')
      expect(after[0]!.extractedPayload).toEqual({})
    })

    it('pending_review draft が既にある場合は error を返す（再抽出は別経路）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      await createTournamentDraft({
        messageId: mail.id,
        status: 'pending_review',
      })

      const result = await triggerExtractDraft(mail.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/既に AI 抽出済み/)
    })

    // Codex r3 blocker: 状態検証ガードのテスト。詳細画面は unprocessed のときだけ
    // ボタンを出すが、別タブ / 別管理者で stale 状態のまま呼び出されるケースを
    // サーバー側でも拒否する。
    it('既に processed のメールは triggerExtractDraft できない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'processed' })

      const result = await triggerExtractDraft(mail.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/既に処理済み/)

      const jobs = await testDb.select().from(mailWorkerJobs)
      expect(jobs).toHaveLength(0)
    })

    it('linked_event_id がある mail は triggerExtractDraft できない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'evt' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await testDb
        .update(mailMessages)
        .set({ linkedEventId: event.id })
        .where(eq(mailMessages.id, mail.id))

      const result = await triggerExtractDraft(mail.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/既存イベントに紐付け済み/)
    })

    // Codex r2 should-fix: ai_processing 中の再 trigger は重複ジョブを生むので拒否する。
    it('ai_processing draft がある場合は重複ジョブを enqueue しない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      await createTournamentDraft({
        messageId: mail.id,
        status: 'ai_processing',
      })

      const result = await triggerExtractDraft(mail.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/既に AI 抽出中/)

      // 新規 job は作られない（pending な manual_extract が積まれていない）。
      const jobs = await testDb.select().from(mailWorkerJobs)
      expect(jobs).toHaveLength(0)
    })

    it('存在しない mail は error を返す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })

      const result = await triggerExtractDraft(999_999)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/mail not found/)
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()
      await setAuthSession(null)
      await expect(triggerExtractDraft(mail.id)).rejects.toThrow('Unauthorized')

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(triggerExtractDraft(mail.id)).rejects.toThrow('Forbidden')
    })
  })

  describe('linkMailToEvent (mail-inbox-mailer)', () => {
    it('linked_event_id を立て、triage processed、after() で broadcastMailToEvent を起動', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const event = await createEvent({ title: '結びつけ先大会' })

      afterMock.mockImplementationOnce((cb) => {
        return cb()
      })
      broadcastMailToEventMock.mockClear()

      const result = await linkMailToEvent(mail.id, event.id)
      expect(result.ok).toBe(true)

      const after = await getMail(mail.id)
      expect(after?.linkedEventId).toBe(event.id)
      expect(after?.triageStatus).toBe('processed')
      expect(after?.triagedByUserId).toBe(admin.id)
      expect(after?.triagedAt).toBeInstanceOf(Date)

      // broadcastMailToEvent が isCorrection=false で呼ばれる。
      expect(broadcastMailToEventMock).toHaveBeenCalledTimes(1)
      // hoisted mock の signature は引数なしだが、実引数は (db, { eventId, ... })。
      // 型を緩めて payload オブジェクトを直接検証する。
      const callArgs = (
        broadcastMailToEventMock.mock.calls[0] as unknown as [
          unknown,
          {
            eventId: number
            mailMessageId: number
            isCorrection: boolean
            leadText: string | null
          },
        ]
      )
      expect(callArgs[1]).toEqual({
        eventId: event.id,
        mailMessageId: mail.id,
        isCorrection: false,
        leadText: null,
      })
    })

    it('leadText を渡すと trim して broadcastMailToEvent に渡す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const event = await createEvent({ title: '冒頭メッセージ大会' })

      afterMock.mockImplementationOnce((cb) => cb())
      broadcastMailToEventMock.mockClear()

      const result = await linkMailToEvent(mail.id, event.id, '  抽選結果が出ました！  ')
      expect(result.ok).toBe(true)

      expect(broadcastMailToEventMock).toHaveBeenCalledTimes(1)
      const callArgs = broadcastMailToEventMock.mock.calls[0] as unknown as [
        unknown,
        { leadText: string | null },
      ]
      // 前後空白は trim される。
      expect(callArgs[1].leadText).toBe('抽選結果が出ました！')
    })

    it('201 文字以上の leadText はエラーを返し、紐付け・配信を行わない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const event = await createEvent({ title: 'E' })

      broadcastMailToEventMock.mockClear()

      const result = await linkMailToEvent(mail.id, event.id, 'あ'.repeat(201))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/200文字以内/)

      // 紐付け・triage 更新・配信のいずれも起きない。
      const after = await getMail(mail.id)
      expect(after?.linkedEventId).toBeNull()
      expect(after?.triageStatus).toBe('unprocessed')
      expect(broadcastMailToEventMock).not.toHaveBeenCalled()
    })

    it('空白のみの leadText は null 扱いで配信される (冒頭なし)', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const event = await createEvent({ title: 'E' })

      afterMock.mockImplementationOnce((cb) => cb())
      broadcastMailToEventMock.mockClear()

      const result = await linkMailToEvent(mail.id, event.id, '   ')
      expect(result.ok).toBe(true)

      const callArgs = broadcastMailToEventMock.mock.calls[0] as unknown as [
        unknown,
        { leadText: string | null },
      ]
      expect(callArgs[1].leadText).toBeNull()
    })

    // Codex r5 should-fix: UI 候補条件 (cancelled 除外 / 過去 30 日以内) を
    // Server Action 側でも verify する。
    it('cancelled イベントへの linkMailToEvent は拒否される', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({
        title: 'キャンセル済',
        status: 'cancelled',
      })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      const result = await linkMailToEvent(mail.id, event.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/キャンセル済み/)
    })

    it('過去 31 日より古いイベントへの linkMailToEvent は拒否される', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      // 60 日前の日付。
      const old = new Date(Date.now() - 60 * 24 * 3600 * 1000)
      const oldStr = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-${String(old.getDate()).padStart(2, '0')}`
      const event = await createEvent({
        title: '過去のイベント',
        status: 'done',
        eventDate: oldStr,
      })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      const result = await linkMailToEvent(mail.id, event.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/過去 30 日/)
    })

    // Codex r3 blocker: 状態検証ガード。
    it('既に processed のメールは linkMailToEvent できない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage({ triageStatus: 'processed' })

      const result = await linkMailToEvent(mail.id, event.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/既に処理済み/)
    })

    it('ai_processing draft があるメールは linkMailToEvent できない (AI 抽出と排他)', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'E' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createTournamentDraft({
        messageId: mail.id,
        status: 'ai_processing',
      })

      const result = await linkMailToEvent(mail.id, event.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/AI 抽出フロー中/)
    })

    it('既に紐付け済みの mail は二重紐付け不可', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: 'A' })
      const event2 = await createEvent({ title: 'B' })
      const mail = await createMailMessage()
      await linkMailToEvent(mail.id, event.id)

      // Codex r3 blocker: 状態検証ガード追加で、2 回目は triage=processed のため
      // 「既に処理済み」エラーで先に弾かれる（旧仕様: 「既に別イベントに紐付け済」）。
      // どちらにせよ二重紐付け不可という不変条件は満たされる。
      const result = await linkMailToEvent(mail.id, event2.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/既に処理済み/)
    })

    it('存在しない event は error を返す（mail は変更しない）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      const result = await linkMailToEvent(mail.id, 999_999)
      expect(result.ok).toBe(false)

      const after = await getMail(mail.id)
      expect(after?.linkedEventId).toBeNull()
      expect(after?.triageStatus).toBe('unprocessed')
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()
      const event = await createEvent({ title: 'E' })

      await setAuthSession(null)
      await expect(linkMailToEvent(mail.id, event.id)).rejects.toThrow('Unauthorized')

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(linkMailToEvent(mail.id, event.id)).rejects.toThrow('Forbidden')
    })
  })

  describe('unlinkMailFromEvent (mail-inbox-mailer)', () => {
    it('linked_event_id を NULL に戻し triage_status を unprocessed に戻す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const event = await createEvent({ title: '解除元' })
      const mail = await createMailMessage()
      await linkMailToEvent(mail.id, event.id)

      await unlinkMailFromEvent(mail.id)

      const after = await getMail(mail.id)
      expect(after?.linkedEventId).toBeNull()
      expect(after?.triageStatus).toBe('unprocessed')
      expect(after?.triagedAt).toBeNull()
      expect(after?.triagedByUserId).toBeNull()
    })

    it('存在しない mail は throw する', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      await expect(unlinkMailFromEvent(999_999)).rejects.toThrow('mail not found')
    })

    it('未認証 / member は呼べない', async () => {
      const mail = await createMailMessage()

      await setAuthSession(null)
      await expect(unlinkMailFromEvent(mail.id)).rejects.toThrow('Unauthorized')

      const member = await createUser()
      await setAuthSession({ id: member.id, role: 'member' })
      await expect(unlinkMailFromEvent(mail.id)).rejects.toThrow('Forbidden')
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // triggerResultParse — tournament-results Task3
  // ───────────────────────────────────────────────────────────────────────

  async function createMailAttachment(mailId: number, overrides: { filename?: string } = {}) {
  const [att] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mailId,
      filename: overrides.filename ?? 'result.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1024,
      data: Buffer.from('dummy'),
      extractionStatus: 'pending',
    })
    .returning()
  if (!att) throw new Error('Failed to insert test mail attachment')
  return att
}

async function createResultDraft(
  mailId: number,
  status: 'pending_review' | 'parse_failed' | 'approved' | 'rejected' = 'pending_review',
  extractedPayload: Record<string, unknown> = {},
) {
  const [draft] = await testDb
    .insert(resultDrafts)
    .values({
      messageId: mailId,
      status,
      parserVersion: '1.0.0',
      extractedPayload,
    })
    .returning()
  if (!draft) throw new Error('Failed to insert test result draft')
  return draft
}

// A minimal valid ParsedResultPayload for approve tests: one class, two players
// who play each other (so opponent resolution runs).
function buildResultPayload(): Record<string, unknown> {
  return {
    parserVersion: '1.0.0',
    classes: [
      {
        className: 'D1級',
        grade: 'D',
        sheetName: '対戦結果表_D1級',
        participants: [
          {
            seqNo: 1,
            name: '田中太郎',
            nameKana: null,
            affiliation: '札幌',
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: '優勝',
            matches: [
              {
                round: 1,
                roundLabel: '1回戦',
                opponentName: '佐藤花子',
                scoreDiff: 5,
                result: 'win',
                status: 'normal',
              },
            ],
          },
          {
            seqNo: 2,
            name: '佐藤花子',
            nameKana: null,
            affiliation: '東京',
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: '準優勝',
            matches: [
              {
                round: 1,
                roundLabel: '1回戦',
                opponentName: '田中太郎',
                scoreDiff: 5,
                result: 'lose',
                status: 'normal',
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('triggerResultParse', () => {
  it('Excel 添付があるとき result_parse ジョブを作成する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const att = await createMailAttachment(mail.id)

    const result = await triggerResultParse(mail.id, att.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const job = await testDb.query.mailWorkerJobs.findFirst({
      where: eq(mailWorkerJobs.id, result.jobId),
    })
    expect(job).toBeDefined()
    expect(job?.kind).toBe('result_parse')
    expect(job?.payload).toEqual({
      mail_message_id: mail.id,
      attachment_id: att.id,
    })
    expect(job?.status).toBe('pending')
  })

  it('.xls ファイルも受け付ける', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const att = await createMailAttachment(mail.id, { filename: 'result.xls' })

    const result = await triggerResultParse(mail.id, att.id)
    expect(result.ok).toBe(true)
  })

  it('Excel でない添付はエラー', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const [att] = await testDb
      .insert(mailAttachments)
      .values({
        mailMessageId: mail.id,
        filename: 'document.pdf',
        contentType: 'application/pdf',
        sizeBytes: 512,
        data: Buffer.from('pdf'),
        extractionStatus: 'pending',
      })
      .returning()

    const result = await triggerResultParse(mail.id, att!.id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Excel/)
  })

  it('別 mail の添付は拒否', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail1 = await createMailMessage()
    const mail2 = await createMailMessage()
    const att = await createMailAttachment(mail2.id) // belongs to mail2

    const result = await triggerResultParse(mail1.id, att.id) // but called with mail1
    expect(result.ok).toBe(false)
  })

  it('pending_review ドラフトがある場合はエラー', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const att = await createMailAttachment(mail.id)
    await createResultDraft(mail.id, 'pending_review')

    const result = await triggerResultParse(mail.id, att.id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/承認待ち/)
  })

  it('approved ドラフトがある場合はエラー', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const att = await createMailAttachment(mail.id)
    await createResultDraft(mail.id, 'approved')

    const result = await triggerResultParse(mail.id, att.id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/承認済み/)
  })

  it('parse_failed ドラフトがあっても再キューできる', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const att = await createMailAttachment(mail.id)
    await createResultDraft(mail.id, 'parse_failed')

    const result = await triggerResultParse(mail.id, att.id)
    expect(result.ok).toBe(true)
  })

  it('未認証 / member は呼べない', async () => {
    const mail = await createMailMessage()
    const att = await createMailAttachment(mail.id)

    await setAuthSession(null)
    await expect(triggerResultParse(mail.id, att.id)).rejects.toThrow('Unauthorized')

    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(triggerResultParse(mail.id, att.id)).rejects.toThrow('Forbidden')
  })
})

// ───────────────────────────────────────────────────────────────────────
// approveResultDraft / rejectResultDraft — tournament-results Task4
// ───────────────────────────────────────────────────────────────────────

describe('approveResultDraft', () => {
  it('pending_review を承認して大会を確定保存し、メールを processed にする', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    const draft = await createResultDraft(mail.id, 'pending_review', buildResultPayload())

    const fd = new FormData()
    fd.set('tournamentName', '第5回テスト大会')
    fd.set('eventDate', '2026-05-01')
    fd.set('venue', '札幌市民会館')

    const result = await approveResultDraft(draft.id, fd)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // tournament row created
    const t = await testDb.query.tournaments.findFirst({
      where: eq(tournaments.id, result.tournamentId),
    })
    expect(t?.name).toBe('第5回テスト大会')

    // draft → approved with tournamentId
    const updated = await testDb.query.resultDrafts.findFirst({
      where: eq(resultDrafts.id, draft.id),
    })
    expect(updated?.status).toBe('approved')
    expect(updated?.tournamentId).toBe(result.tournamentId)
    expect(updated?.approvedByUserId).toBe(admin.id)

    // mail → processed
    const m = await testDb.query.mailMessages.findFirst({
      where: eq(mailMessages.id, mail.id),
    })
    expect(m?.triageStatus).toBe('processed')

    // players + matches materialized
    const playerRows = await testDb.select().from(players)
    expect(playerRows).toHaveLength(2)
    const matchRows = await testDb.select().from(matches)
    expect(matchRows).toHaveLength(2)
  })

  it('大会名が空だとエラー', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'pending_review', buildResultPayload())

    const fd = new FormData()
    fd.set('tournamentName', '   ')

    const result = await approveResultDraft(draft.id, fd)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/大会名/)

    // No tournament created
    const ts = await testDb.select().from(tournaments)
    expect(ts).toHaveLength(0)
  })

  it('eventDate/venue は空なら null で保存される', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'pending_review', buildResultPayload())

    const fd = new FormData()
    fd.set('tournamentName', '日付なし大会')
    fd.set('eventDate', '')
    fd.set('venue', '')

    const result = await approveResultDraft(draft.id, fd)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const t = await testDb.query.tournaments.findFirst({
      where: eq(tournaments.id, result.tournamentId),
    })
    expect(t?.eventDate).toBeNull()
    expect(t?.venue).toBeNull()
  })

  it('pending_review でない draft は承認できない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'parse_failed', buildResultPayload())

    const fd = new FormData()
    fd.set('tournamentName', 'failした大会')

    const result = await approveResultDraft(draft.id, fd)
    expect(result.ok).toBe(false)
  })

  it('未認証 / member は呼べない', async () => {
    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'pending_review', buildResultPayload())
    const fd = new FormData()
    fd.set('tournamentName', 'x')

    await setAuthSession(null)
    await expect(approveResultDraft(draft.id, fd)).rejects.toThrow('Unauthorized')

    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(approveResultDraft(draft.id, fd)).rejects.toThrow('Forbidden')
  })
})

describe('rejectResultDraft', () => {
  it('pending_review を却下できる', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'pending_review', buildResultPayload())

    const result = await rejectResultDraft(draft.id, '誤った大会の結果のため')
    expect(result.ok).toBe(true)

    const updated = await testDb.query.resultDrafts.findFirst({
      where: eq(resultDrafts.id, draft.id),
    })
    expect(updated?.status).toBe('rejected')
    expect(updated?.rejectionReason).toBe('誤った大会の結果のため')
    expect(updated?.rejectedByUserId).toBe(admin.id)
  })

  it('parse_failed も却下できる', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'parse_failed')

    const result = await rejectResultDraft(draft.id, '読み取り不能')
    expect(result.ok).toBe(true)

    const updated = await testDb.query.resultDrafts.findFirst({
      where: eq(resultDrafts.id, draft.id),
    })
    expect(updated?.status).toBe('rejected')
  })

  it('理由が空だとエラー', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'pending_review')

    const result = await rejectResultDraft(draft.id, '   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/却下理由/)
  })

  it('approved な draft は却下できない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'approved')

    const result = await rejectResultDraft(draft.id, '却下したい')
    expect(result.ok).toBe(false)
  })

  it('未認証 / member は呼べない', async () => {
    const mail = await createMailMessage()
    const draft = await createResultDraft(mail.id, 'pending_review')

    await setAuthSession(null)
    await expect(rejectResultDraft(draft.id, 'x')).rejects.toThrow('Unauthorized')

    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(rejectResultDraft(draft.id, 'x')).rejects.toThrow('Forbidden')
  })
})
})
