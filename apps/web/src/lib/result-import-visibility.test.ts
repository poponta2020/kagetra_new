import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, type InferInsertModel } from 'drizzle-orm'
import { mailMessages, mailWorkerJobs, resultDrafts } from '@kagetra/shared/schema'
import {
  RESULT_IMPORT_INFLIGHT_WINDOW_MS,
  countUnprocessedMails,
  loadInFlightResultImportMailIds,
  loadResultImportDismissBlock,
  loadStalledResultImportMailIds,
  resultImportBlocksDismiss,
} from '@kagetra/shared/queries'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createMailMessage } from '@/test-utils/seed'

/**
 * tournament-results 2026-09-13 改修 タスク1 — 受信箱の可視性判定（AC-23/24/27/38/39）。
 *
 * モジュール本体は `packages/shared/src/queries/`（web / mail-worker の両方から
 * 使うため）。`packages/shared` には実 DB を使うテスト基盤が無いので、テストだけ
 * web 側の基盤（`@/test-utils/db`）に置く（実装手順書タスク1の但し書き）。
 */

type NewMailWorkerJob = InferInsertModel<typeof mailWorkerJobs>
type NewResultDraft = InferInsertModel<typeof resultDrafts>

const NOW = new Date('2026-09-13T12:00:00Z')
const INSIDE_WINDOW = new Date(NOW.getTime() - 5 * 60 * 1000)
const OUTSIDE_WINDOW = new Date(NOW.getTime() - RESULT_IMPORT_INFLIGHT_WINDOW_MS - 60 * 1000)
const OPTS = { now: NOW }

let adminId: string

async function seedJob(
  mailId: number,
  overrides: Partial<NewMailWorkerJob> = {},
): Promise<void> {
  await testDb.insert(mailWorkerJobs).values({
    requestedByUserId: adminId,
    status: 'pending',
    kind: 'result_parse',
    payload: { mail_message_id: mailId, attachment_id: 1 },
    requestedAt: INSIDE_WINDOW,
    ...overrides,
  })
}

async function seedDraft(
  mailId: number,
  overrides: Partial<NewResultDraft> = {},
): Promise<void> {
  await testDb.insert(resultDrafts).values({
    messageId: mailId,
    status: 'pending_review',
    parserVersion: 'test-1.0',
    ...overrides,
  })
}

describe('result-import-visibility (tournament-results 2026-09-13)', () => {
  beforeEach(async () => {
    await truncateAll()
    const admin = await createAdmin()
    adminId = admin.id
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('loadInFlightResultImportMailIds', () => {
    it('該当ジョブが無ければ空配列を返す（空配列で呼び出し側が壊れない前提）', async () => {
      await createMailMessage({ triageStatus: 'unprocessed' })
      expect(await loadInFlightResultImportMailIds(testDb, OPTS)).toEqual([])
    })

    it.each(['pending', 'claimed'] as const)('未終端ジョブ (%s) のメールを拾う', async (status) => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { status })
      expect(await loadInFlightResultImportMailIds(testDb, OPTS)).toEqual([mail.id])
    })

    it.each(['done', 'failed'] as const)('終端ジョブ (%s) は拾わない', async (status) => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { status })
      expect(await loadInFlightResultImportMailIds(testDb, OPTS)).toEqual([])
    })

    it.each(['manual_extract', 'roster_parse'] as const)(
      '別 kind のジョブ (%s) は拾わない（AC-35: 案内 AI 抽出・名簿取込は未処理に残す）',
      async (kind) => {
        const mail = await createMailMessage({ triageStatus: 'unprocessed' })
        await seedJob(mail.id, { kind })
        expect(await loadInFlightResultImportMailIds(testDb, OPTS)).toEqual([])
      },
    )

    it('30 分の窓を超えた未終端ジョブは拾わない（AC-27: 消えたまま戻らないのを防ぐ）', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { requestedAt: OUTSIDE_WINDOW })
      expect(await loadInFlightResultImportMailIds(testDb, OPTS)).toEqual([])
    })

    it('同一メールに複数ジョブがあっても重複しない', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { requestedAt: OUTSIDE_WINDOW })
      await seedJob(mail.id, { status: 'claimed' })
      expect(await loadInFlightResultImportMailIds(testDb, OPTS)).toEqual([mail.id])
    })

    it('古い滞留ジョブがあっても、より新しい再取込が窓内なら取込中扱い（AC-38）', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedDraft(mail.id, { status: 'parse_failed' })
      await seedJob(mail.id, { requestedAt: OUTSIDE_WINDOW })
      await seedJob(mail.id, { requestedAt: INSIDE_WINDOW })

      expect(await loadInFlightResultImportMailIds(testDb, OPTS)).toEqual([mail.id])
      expect(await loadStalledResultImportMailIds(testDb, OPTS)).toEqual([])
    })
  })

  describe('loadStalledResultImportMailIds', () => {
    it('窓を超えた未終端ジョブでドラフトが無ければ滞留として拾う', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { requestedAt: OUTSIDE_WINDOW })
      expect(await loadStalledResultImportMailIds(testDb, OPTS)).toEqual([mail.id])
    })

    it('窓内の未終端ジョブは滞留にしない（取込中が最優先）', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id)
      expect(await loadStalledResultImportMailIds(testDb, OPTS)).toEqual([])
    })

    it('ジョブ要求より後にドラフトが書かれていれば滞留にしない（AC-39）', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { requestedAt: OUTSIDE_WINDOW })
      await seedDraft(mail.id, {
        updatedAt: new Date(OUTSIDE_WINDOW.getTime() + 60 * 1000),
      })
      expect(await loadStalledResultImportMailIds(testDb, OPTS)).toEqual([])
    })

    it('ジョブ要求より前のドラフトしか無ければ滞留として拾う', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { requestedAt: OUTSIDE_WINDOW })
      await seedDraft(mail.id, {
        status: 'parse_failed',
        updatedAt: new Date(OUTSIDE_WINDOW.getTime() - 60 * 1000),
      })
      expect(await loadStalledResultImportMailIds(testDb, OPTS)).toEqual([mail.id])
    })

    it('終端ジョブだけなら滞留にしない', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { status: 'done', requestedAt: OUTSIDE_WINDOW })
      expect(await loadStalledResultImportMailIds(testDb, OPTS)).toEqual([])
    })
  })

  describe('countUnprocessedMails', () => {
    it('取込中のメールを未処理件数から除く（AC-24）', async () => {
      const inFlight = await createMailMessage({ triageStatus: 'unprocessed' })
      await createMailMessage({ triageStatus: 'unprocessed' })
      await createMailMessage({ triageStatus: 'unprocessed' })
      await createMailMessage({ triageStatus: 'processed' })
      await seedJob(inFlight.id)

      expect(await countUnprocessedMails(testDb, OPTS)).toBe(2)
    })

    it('取込中がゼロなら素の triage != processed と同値（回帰）', async () => {
      await createMailMessage({ triageStatus: 'unprocessed' })
      await createMailMessage({ triageStatus: 'unprocessed' })
      await createMailMessage({ triageStatus: 'processed' })

      const rows = await testDb
        .select({ id: mailMessages.id })
        .from(mailMessages)
        .where(eq(mailMessages.triageStatus, 'unprocessed'))
      expect(await countUnprocessedMails(testDb, OPTS)).toBe(rows.length)
    })

    it('滞留中のメールは未処理件数に数える（復活しているため）', async () => {
      const stalled = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(stalled.id, { requestedAt: OUTSIDE_WINDOW })
      expect(await countUnprocessedMails(testDb, OPTS)).toBe(1)
    })

    it('メールがゼロ件でも 0 を返す', async () => {
      expect(await countUnprocessedMails(testDb, OPTS)).toBe(0)
    })
  })

  describe('resultImportBlocksDismiss / loadResultImportDismissBlock', () => {
    it('純関数: 取込中・pending_review・parse_failed だけを塞ぐ', () => {
      expect(resultImportBlocksDismiss({ draftStatus: null, inFlight: true })).toBe(true)
      expect(resultImportBlocksDismiss({ draftStatus: 'pending_review', inFlight: false })).toBe(
        true,
      )
      expect(resultImportBlocksDismiss({ draftStatus: 'parse_failed', inFlight: false })).toBe(true)
      expect(resultImportBlocksDismiss({ draftStatus: null, inFlight: false })).toBe(false)
      for (const status of ['approved', 'rejected', 'superseded']) {
        expect(resultImportBlocksDismiss({ draftStatus: status, inFlight: false })).toBe(false)
      }
    })

    it('ドラフトもジョブも無いメールは null（対応不要できる）', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      expect(await loadResultImportDismissBlock(testDb, mail.id, OPTS)).toBeNull()
    })

    it('取込中は in_flight', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id)
      expect(await loadResultImportDismissBlock(testDb, mail.id, OPTS)).toBe('in_flight')
    })

    it.each(['pending_review', 'parse_failed'] as const)('%s のドラフトを塞ぐ', async (status) => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedDraft(mail.id, { status })
      expect(await loadResultImportDismissBlock(testDb, mail.id, OPTS)).toBe(status)
    })

    it.each(['approved', 'rejected', 'superseded'] as const)(
      '%s のドラフトは塞がない（回帰）',
      async (status) => {
        const mail = await createMailMessage({ triageStatus: 'unprocessed' })
        await seedDraft(mail.id, { status })
        expect(await loadResultImportDismissBlock(testDb, mail.id, OPTS)).toBeNull()
      },
    )

    it('窓を超えた滞留ジョブだけなら塞がない（警告付きで一覧に出ているため）', async () => {
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(mail.id, { requestedAt: OUTSIDE_WINDOW })
      expect(await loadResultImportDismissBlock(testDb, mail.id, OPTS)).toBeNull()
    })

    it('取込中は他メールの判定に影響しない', async () => {
      const inFlight = await createMailMessage({ triageStatus: 'unprocessed' })
      const other = await createMailMessage({ triageStatus: 'unprocessed' })
      await seedJob(inFlight.id)
      expect(await loadResultImportDismissBlock(testDb, other.id, OPTS)).toBeNull()
    })
  })
})
