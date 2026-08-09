import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { InferInsertModel } from 'drizzle-orm'
import { mailAttachments } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createMailMessage } from '@/test-utils/seed'
import {
  buildAttachmentsSelectQuery,
  buildExcerpt,
  buildMailListSelectQuery,
  searchMemberMails,
} from './search'

type NewMailAttachment = InferInsertModel<typeof mailAttachments>

/** mail_attachments を1件作る。`data` は bytea NOT NULL なのでダミー Buffer を積む。 */
async function createAttachment(overrides: Partial<NewMailAttachment> & { mailMessageId: number }) {
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      filename: 'attachment.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      data: Buffer.from('dummy'),
      extractionStatus: 'extracted',
      ...overrides,
    })
    .returning()
  if (!attachment) throw new Error('Failed to insert test attachment')
  return attachment
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('searchMemberMails — AC-4 各フィールドでのヒット', () => {
  it('件名でヒットする', async () => {
    await createMailMessage({ subject: '第46回九段大会のご案内' })
    await createMailMessage({ subject: '別の大会' })
    const { rows } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.subject).toBe('第46回九段大会のご案内')
  })

  it('差出人（表示名/アドレス）でヒットする', async () => {
    await createMailMessage({ fromName: '九段大会実行委員会', fromAddress: 'organizer@example.com' })
    await createMailMessage({ fromName: '別会場', fromAddress: 'other@example.com' })
    const byName = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(byName.rows).toHaveLength(1)

    await truncateAll()
    await createMailMessage({ fromName: 'A', fromAddress: 'kudan@example.jp' })
    await createMailMessage({ fromName: 'B', fromAddress: 'other@example.jp' })
    const byAddress = await searchMemberMails({ q: 'kudan', limit: 20, offset: 0 })
    expect(byAddress.rows).toHaveLength(1)
  })

  it('本文でヒットする', async () => {
    await createMailMessage({ bodyText: '第46回九段大会を開催します' })
    await createMailMessage({ bodyText: '別の内容' })
    const { rows } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows).toHaveLength(1)
  })

  it('添付ファイル名でヒットする', async () => {
    const hit = await createMailMessage({ subject: 'A', bodyText: null })
    const miss = await createMailMessage({ subject: 'B', bodyText: null })
    await createAttachment({ mailMessageId: hit.id, filename: '九段大会要項.pdf' })
    await createAttachment({ mailMessageId: miss.id, filename: '別紙.pdf' })
    const { rows } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toEqual([hit.id])
  })

  it('添付の抽出テキストでヒットする', async () => {
    const hit = await createMailMessage({ subject: 'A', bodyText: null })
    const miss = await createMailMessage({ subject: 'B', bodyText: null })
    await createAttachment({
      mailMessageId: hit.id,
      filename: 'a.pdf',
      extractedText: '第46回九段大会 会場：東京武道館',
    })
    await createAttachment({ mailMessageId: miss.id, filename: 'b.pdf', extractedText: '無関係' })
    const { rows } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toEqual([hit.id])
  })
})

describe('searchMemberMails — AC-5 空白区切り AND', () => {
  it('両方の語を含むメールだけを返す（半角スペース）', async () => {
    const both = await createMailMessage({ subject: '第46回九段大会 抽選結果' })
    await createMailMessage({ subject: '第46回九段大会 参加費' })
    await createMailMessage({ subject: '多摩大会 抽選結果' })
    const { rows } = await searchMemberMails({ q: '九段 抽選', limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toEqual([both.id])
  })

  it('全角スペース区切りでも AND になる', async () => {
    const both = await createMailMessage({ subject: '第46回九段大会　抽選結果' })
    await createMailMessage({ subject: '第46回九段大会のみ' })
    const { rows } = await searchMemberMails({ q: '九段　抽選', limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toEqual([both.id])
  })
})

describe('searchMemberMails — AC-6 キーワード未入力', () => {
  it('全件を受信日降順で返す', async () => {
    const old = await createMailMessage({ receivedAt: new Date('2026-01-01T00:00:00Z') })
    const mid = await createMailMessage({ receivedAt: new Date('2026-03-01T00:00:00Z') })
    const newest = await createMailMessage({ receivedAt: new Date('2026-06-01T00:00:00Z') })
    const { rows, total } = await searchMemberMails({ limit: 20, offset: 0 })
    expect(total).toBe(3)
    expect(rows.map((r) => r.id)).toEqual([newest.id, mid.id, old.id])
    expect(rows.every((r) => r.subjectMatched === false && r.excerpt === null)).toBe(true)
  })
})

describe('searchMemberMails — AC-7 添付ありのみ', () => {
  it('添付を持たないメールが結果から消える', async () => {
    const withAttachment = await createMailMessage({})
    await createMailMessage({})
    await createAttachment({ mailMessageId: withAttachment.id })
    const { rows } = await searchMemberMails({ attachmentsOnly: true, limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toEqual([withAttachment.id])
  })
})

describe('searchMemberMails — 除外条件を設けない', () => {
  it('classification=noise が結果に含まれる（AC-9）', async () => {
    const noise = await createMailMessage({ classification: 'noise' })
    const { rows } = await searchMemberMails({ limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toContain(noise.id)
  })

  it('triage_status=unprocessed が結果に含まれる（AC-10）', async () => {
    const unprocessed = await createMailMessage({ triageStatus: 'unprocessed' })
    const { rows } = await searchMemberMails({ limit: 20, offset: 0 })
    const row = rows.find((r) => r.id === unprocessed.id)
    expect(row).toBeDefined()
    expect(row!.triageStatus).toBe('unprocessed')
  })
})

describe('searchMemberMails — ILIKE ワイルドカードのエスケープ', () => {
  it('% がリテラル扱いになる', async () => {
    const hit = await createMailMessage({ subject: '50%大会' })
    await createMailMessage({ subject: '普通大会' })
    const { rows } = await searchMemberMails({ q: '50%', limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toEqual([hit.id])
  })

  it('_ がリテラル扱いになる', async () => {
    const hit = await createMailMessage({ subject: 'A_B大会' })
    await createMailMessage({ subject: 'AXB大会' })
    const { rows } = await searchMemberMails({ q: 'A_B', limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toEqual([hit.id])
  })

  it('\\ がリテラル扱いになる', async () => {
    const hit = await createMailMessage({ subject: 'A\\B大会' })
    await createMailMessage({ subject: 'AB大会' })
    const { rows } = await searchMemberMails({ q: 'A\\B', limit: 20, offset: 0 })
    expect(rows.map((r) => r.id)).toEqual([hit.id])
  })
})

describe('searchMemberMails — 添付の重複排除', () => {
  it('添付が複数あるメールが結果に重複しない', async () => {
    const mail = await createMailMessage({ subject: '九段大会' })
    await createAttachment({ mailMessageId: mail.id, filename: '要項.pdf' })
    await createAttachment({ mailMessageId: mail.id, filename: '申込書.docx' })
    await createAttachment({ mailMessageId: mail.id, filename: '地図.jpg' })
    const { rows, total } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows).toHaveLength(1)
    expect(total).toBe(1)
    expect(rows[0]!.attachments).toHaveLength(3)
  })
})

describe('searchMemberMails — AC-28 projection に data を含まない', () => {
  it('一覧クエリの SELECT 句に "data" が出ない', () => {
    const query = buildMailListSelectQuery(undefined, 20, 0)
    const { sql } = query.toSQL()
    expect(sql).not.toMatch(/"data"/)
  })

  it('添付クエリの SELECT 句に "data" が出ない（extracted_text 有無どちらも）', () => {
    const withText = buildAttachmentsSelectQuery([1, 2], true)
    const withoutText = buildAttachmentsSelectQuery([1, 2], false)
    expect(withText.toSQL().sql).not.toMatch(/"data"/)
    expect(withoutText.toSQL().sql).not.toMatch(/"data"/)
  })

  it('実データでも data カラムを含んだ行が返らない（返却オブジェクトのキー確認は不十分なので toSQL と併用）', async () => {
    const mail = await createMailMessage({})
    await createAttachment({ mailMessageId: mail.id })
    const { rows } = await searchMemberMails({ limit: 20, offset: 0 })
    expect(rows[0]).not.toHaveProperty('data')
    expect(rows[0]!.attachments[0]).not.toHaveProperty('data')
  })
})

describe('searchMemberMails — AC-8 ページング', () => {
  it('offset/limit で重複・欠落なく分割できる', async () => {
    for (let i = 0; i < 25; i++) {
      await createMailMessage({ receivedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) })
    }
    // 受信日降順なので最後に作った (i=24) が先頭
    const page1 = await searchMemberMails({ limit: 20, offset: 0 })
    const page2 = await searchMemberMails({ limit: 20, offset: 20 })
    expect(page1.rows).toHaveLength(20)
    expect(page2.rows).toHaveLength(5)
    const allIds = [...page1.rows, ...page2.rows].map((r) => r.id)
    expect(new Set(allIds).size).toBe(25)
    expect(page1.total).toBe(25)
    expect(page2.total).toBe(25)
  })
})

describe('searchMemberMails — subjectMatched / excerpt の分岐', () => {
  it('件名のみヒット → excerpt は null', async () => {
    await createMailMessage({ subject: '九段大会のご案内', bodyText: '無関係な本文' })
    const { rows } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows[0]!.subjectMatched).toBe(true)
    expect(rows[0]!.excerpt).toBeNull()
  })

  it('本文ヒット → source=body', async () => {
    await createMailMessage({
      subject: '大会案内',
      bodyText: '第46回九段大会を開催いたします。詳細は添付をご確認ください。',
    })
    const { rows } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows[0]!.subjectMatched).toBe(false)
    expect(rows[0]!.excerpt).not.toBeNull()
    expect(rows[0]!.excerpt!.source).toBe('body')
    expect(rows[0]!.excerpt!.attachmentFilename).toBeNull()
    expect(rows[0]!.excerpt!.text).not.toBeNull()
  })

  it('添付抽出テキストヒット → source=attachment + filename', async () => {
    const mail = await createMailMessage({ subject: '大会案内', bodyText: '本文には無い' })
    await createAttachment({
      mailMessageId: mail.id,
      filename: '要項.pdf',
      extractedText: '第46回九段大会を開催します',
    })
    const { rows } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows[0]!.excerpt).not.toBeNull()
    expect(rows[0]!.excerpt!.source).toBe('attachment')
    expect(rows[0]!.excerpt!.attachmentFilename).toBe('要項.pdf')
    expect(rows[0]!.excerpt!.text).not.toBeNull()
  })

  it('添付ファイル名のみヒット → text は null', async () => {
    const mail = await createMailMessage({ subject: '大会案内', bodyText: '本文には無い' })
    await createAttachment({
      mailMessageId: mail.id,
      filename: '九段大会要項.pdf',
      extractedText: '無関係な内容',
    })
    const { rows } = await searchMemberMails({ q: '九段', limit: 20, offset: 0 })
    expect(rows[0]!.excerpt).not.toBeNull()
    expect(rows[0]!.excerpt!.source).toBe('attachment')
    expect(rows[0]!.excerpt!.attachmentFilename).toBe('九段大会要項.pdf')
    expect(rows[0]!.excerpt!.text).toBeNull()
  })
})

describe('searchMemberMails — total', () => {
  it('絞り込み後の総件数を返す', async () => {
    await createMailMessage({ subject: '九段大会A' })
    await createMailMessage({ subject: '九段大会B' })
    await createMailMessage({ subject: '別の大会' })
    const { total } = await searchMemberMails({ q: '九段', limit: 1, offset: 0 })
    expect(total).toBe(2)
  })
})

describe('buildExcerpt — 純関数', () => {
  it('ヒット位置の前後を切り出す', () => {
    const text = 'あ'.repeat(50) + 'キーワード' + 'い'.repeat(150)
    const excerpt = buildExcerpt(text, ['キーワード'])
    expect(excerpt).not.toBeNull()
    expect(excerpt).toContain('キーワード')
    expect(excerpt!.startsWith('…')).toBe(true)
    expect(excerpt!.endsWith('…')).toBe(true)
  })

  it('改行・連続空白を半角スペース1つに畳む', () => {
    const text = '前置き\n\n\tキーワード　　後書き'
    const excerpt = buildExcerpt(text, ['キーワード'])
    expect(excerpt).not.toMatch(/\n|\t/)
    expect(excerpt).not.toMatch(/ {2,}/)
  })

  it('ヒットしなければ null', () => {
    expect(buildExcerpt('関係ない本文', ['九段'])).toBeNull()
  })

  it('terms が空なら null', () => {
    expect(buildExcerpt('本文', [])).toBeNull()
  })
})
