import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { events, tournamentDrafts } from '@kagetra/shared/schema'
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
const { approveDraft, rejectDraft, linkDraftToEvent, reextractDraft } =
  await import('./actions')

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
  fd.set('startTime', '09:30')
  fd.set('endTime', '17:00')
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
  })
})
