import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  mailMessages,
  mailWorkerRuns,
  tournamentDrafts,
  users,
} from '@kagetra/shared/schema'
import { runManualExtract } from '../src/pipeline.js'
import {
  FixtureLLMExtractor,
  loadFixturesFromDir,
} from '../src/classify/llm/fixture.js'
import { BrokenLLMExtractor } from '../src/classify/llm/broken.js'
import {
  closeTestDb,
  testDb,
  truncateMailTables,
  truncateMailWorkerTables,
} from './test-db.js'
import { closeDb } from '../src/db.js'

const LLM_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/llm/', import.meta.url))
const ADMIN_USER_ID = 'admin-extract-only'

async function buildExtractor(): Promise<FixtureLLMExtractor> {
  return new FixtureLLMExtractor(await loadFixturesFromDir(LLM_FIXTURE_DIR))
}

async function seedAdmin() {
  await testDb.insert(users).values({
    id: ADMIN_USER_ID,
    name: 'Admin',
    email: 'admin-extract@example.com',
    role: 'admin',
  })
}

/**
 * mail-inbox-mailer: manual_extract dispatcher が呼ぶ AI 抽出専用パスのテスト。
 * IMAP fetch 経路を通らず、既存 mail_messages 行に対して classifyMail + persistOutcome
 * を回し、mail_worker_runs を kind='manual' で残せることを確認する。
 */
async function seedMailMessage(opts: {
  subject?: string
  classification?: 'tournament' | 'noise' | 'unknown' | null
}) {
  const [row] = await testDb
    .insert(mailMessages)
    .values({
      messageId: `<manual-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test>`,
      fromAddress: 'organizer@example.com',
      fromName: '主催者',
      toAddresses: ['kagetra@example.com'],
      subject: opts.subject ?? '[taikai-ajka:829] 第66回標榜大会のご案内',
      receivedAt: new Date(),
      bodyText: 'テスト本文',
      bodyHtml: null,
      status: 'fetched',
      classification: opts.classification ?? null,
      imapUid: null,
      imapBox: null,
    })
    .returning({ id: mailMessages.id })
  return row!.id
}

describe('runManualExtract (mail-inbox-mailer task2)', () => {
  beforeEach(async () => {
    await truncateMailTables()
    await truncateMailWorkerTables()
    await testDb.execute(/* sql */`TRUNCATE TABLE users RESTART IDENTITY CASCADE`)
    await seedAdmin()
  })

  afterAll(async () => {
    await closeDb()
    await closeTestDb()
  })

  it('classifyMail + persistOutcome を流し、mail_worker_runs を kind=manual / status=success で残す', async () => {
    // fixture loader は emailMeta.subject で match するので、payload と同じ
    // subject を mail に持たせる必要がある。tournament-announcement の subject
    // を流用。
    const mailId = await seedMailMessage({
      subject: '[taikai-ajka:829] 第66回標榜大会のご案内',
    })
    const llm = await buildExtractor()

    const result = await runManualExtract({
      mailMessageId: mailId,
      llmExtractor: llm,
      triggeredByUserId: ADMIN_USER_ID,
    })

    expect(result.status).toBe('success')
    expect(result.aiSucceeded).toBe(1)
    expect(result.aiFailed).toBe(0)
    expect(result.draftsInserted).toBe(1)

    // run 行
    const runs = await testDb.select().from(mailWorkerRuns)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.kind).toBe('manual')
    expect(runs[0]!.status).toBe('success')
    expect(runs[0]!.triggeredByUserId).toBe(ADMIN_USER_ID)
    expect(runs[0]!.finishedAt).not.toBeNull()
    expect(runs[0]!.since).toBeNull()

    // draft 行
    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.messageId).toBe(mailId)
    expect(drafts[0]!.status).toBe('pending_review')

    // mail 行は ai_done に遷移
    const mail = await testDb
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, mailId))
    expect(mail[0]!.status).toBe('ai_done')
  })

  it('classification=noise の mail も force:true で AI を回す（pre-filter を上書き）', async () => {
    // mail-inbox-mailer の主旨: 「管理者が AI 抽出を明示要求した時点で、
    // pre-filter の noise 判定は無視する」。runManualExtract は classifyMail
    // に force:true を渡すので、classification='noise' でも skipped_noise には
    // ならず AI が走る。
    const mailId = await seedMailMessage({
      subject: '[taikai-ajka:829] 第66回標榜大会のご案内',
      classification: 'noise',
    })
    const llm = await buildExtractor()

    const result = await runManualExtract({
      mailMessageId: mailId,
      llmExtractor: llm,
      triggeredByUserId: ADMIN_USER_ID,
    })

    expect(result.aiSkipped).toBe(0)
    expect(result.aiSucceeded).toBe(1)
    expect(result.draftsInserted).toBe(1)
  })

  it('LLM が二回失敗すると run.status=ai_failed + ai_failed draft が作られる', async () => {
    const mailId = await seedMailMessage({})
    const result = await runManualExtract({
      mailMessageId: mailId,
      llmExtractor: new BrokenLLMExtractor(),
      triggeredByUserId: ADMIN_USER_ID,
    })

    expect(result.status).toBe('ai_failed')
    expect(result.aiFailed).toBe(1)
    expect(result.aiSucceeded).toBe(0)
    expect(result.aiErrors.length).toBeGreaterThan(0)

    const runs = await testDb.select().from(mailWorkerRuns)
    expect(runs[0]!.status).toBe('ai_failed')

    // draft 行は ai_failed で残る（再試行できる状態）
    const drafts = await testDb.select().from(tournamentDrafts)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.status).toBe('ai_failed')
  })

  it('存在しない mail_message_id を渡すと aiFailed=1 で finish する（top-level に伝播させない）', async () => {
    const result = await runManualExtract({
      mailMessageId: 999_999,
      llmExtractor: new BrokenLLMExtractor(),
      triggeredByUserId: ADMIN_USER_ID,
    })

    // 例外を投げず ai_failed として記録する（dispatcher 側で 1 ジョブごとに
    // try/catch する設計と整合）。
    expect(result.status).toBe('ai_failed')
    expect(result.aiFailed).toBe(1)
    expect(result.aiErrors[0]).toMatch(/not found/)
  })
})
