import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  eventGroups,
  events,
  mailMessages,
  mailWorkerJobs,
  tournamentDrafts,
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

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Stub the mail-worker classifier surface so reextractDraft does not actually
// call Anthropic. The action only needs `classifyMail` + `persistOutcome` to
// resolve; we capture the call shape for assertions.
const classifyMailMock = vi.fn(async () => ({ kind: 'noise' as const, result: {} }))
const persistOutcomeMock = vi.fn(async () => ({}))
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
  rejectDraft,
  linkDraftToEvent,
  reextractDraft,
  triggerMailFetch,
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

describe('admin/mail-inbox actions', () => {
  beforeEach(async () => {
    await truncateAll()
    classifyMailMock.mockClear()
    persistOutcomeMock.mockClear()
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

    it('存在しない eventGroupId が指定されると入力エラーで弾く', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })

      await expect(
        approveDraft(
          draft.id,
          buildApproveFormData({ eventGroupId: '999999' }),
        ),
      ).rejects.toThrow(/大会グループ/)

      // Validation runs before the transaction, so neither events nor draft
      // status should change.
      const eventRows = await testDb.select().from(events)
      expect(eventRows).toHaveLength(0)
      const after = await getDraft(draft.id)
      expect(after?.status).toBe('pending_review')
    })

    it('既存 eventGroupId 指定なら通常通り events に紐付く', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage()
      const draft = await createTournamentDraft({ messageId: mail.id })
      const [group] = await testDb
        .insert(eventGroups)
        .values({ name: 'テストグループ' })
        .returning()
      if (!group) throw new Error('eventGroups insert failed')

      await approveDraft(
        draft.id,
        buildApproveFormData({
          title: 'グループ付き大会',
          eventGroupId: String(group.id),
        }),
      )

      const inserted = await testDb.query.events.findFirst({
        where: eq(events.title, 'グループ付き大会'),
      })
      expect(inserted?.eventGroupId).toBe(group.id)
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
})
