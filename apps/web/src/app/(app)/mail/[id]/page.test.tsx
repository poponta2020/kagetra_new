import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mailAttachments } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent, createMailMessage, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: MailDetailPage } = await import('./page')

async function renderDetail(id: number | string) {
  const ui = await MailDetailPage({ params: Promise.resolve({ id: String(id) }) })
  return render(ui)
}

async function createAttachment(
  mailId: number,
  overrides: { filename?: string; contentType?: string; sizeBytes?: number } = {},
) {
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mailId,
      filename: overrides.filename ?? 'roster.xlsx',
      contentType:
        overrides.contentType ??
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: overrides.sizeBytes ?? 1024,
      data: Buffer.from('x'),
    })
    .returning()
  return attachment!
}

describe('/mail/[id] 詳細ページ', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('未ログインは /auth/signin へ redirect', async () => {
    await setAuthSession(null)
    const mail = await createMailMessage({})
    await expect(renderDetail(mail.id)).rejects.toThrow('NEXT_REDIRECT:/auth/signin')
  })

  // codex pr479 r1 blocker: `01` は `1` と同じ行を指す別 URL になり、int4 上限
  // 超過はクエリに載ると pg の範囲外エラーで 500 になる。API ルートと同じ境界に
  // 揃えたことを固定する。
  it('不正な id は notFound', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    for (const bad of ['abc', '1.5', '-1', '0', '01', '1e5', '2147483648']) {
      await expect(renderDetail(bad)).rejects.toThrow('NEXT_NOT_FOUND')
    }
  })

  it('存在しない id は notFound', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(renderDetail(999999)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('件名が空なら (件名なし) と表示する', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({ subject: null })
    await renderDetail(mail.id)
    expect(screen.getByText('(件名なし)')).toBeTruthy()
  })

  it('差出人は「名前 <アドレス>」形式で出る', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({
      fromName: '九段大会実行委員会',
      fromAddress: 'kudan@example.jp',
    })
    await renderDetail(mail.id)
    expect(screen.getByText('九段大会実行委員会 <kudan@example.jp>')).toBeTruthy()
  })

  it('fromName が無ければアドレスのみ表示する', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({ fromName: null, fromAddress: 'noreply@example.jp' })
    await renderDetail(mail.id)
    expect(screen.getByText('noreply@example.jp')).toBeTruthy()
  })

  it('添付0件では添付セクションが出ない', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({ bodyText: '本文あり' })
    await renderDetail(mail.id)
    expect(screen.queryByText(/添付ファイル/)).toBeNull()
  })

  it('本文が空なら本文セクションが出ない', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({ bodyText: null, bodyHtml: null })
    await createAttachment(mail.id)
    await renderDetail(mail.id)
    expect(screen.queryByText('本文')).toBeNull()
  })

  it('AC-29: 本文も添付も無いメールは例外を出さず、本文欄・添付欄も出ない', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({
      subject: null,
      bodyText: null,
      bodyHtml: null,
      triageStatus: 'unprocessed',
    })

    await expect(renderDetail(mail.id)).resolves.toBeDefined()
    expect(screen.getByText('このメールには本文と添付がありません')).toBeTruthy()
    expect(
      screen.getByText('取り込みの途中で本文を取得できなかった可能性があります。'),
    ).toBeTruthy()
    expect(screen.queryByText(/添付ファイル/)).toBeNull()
    expect(screen.queryByText('本文')).toBeNull()
  })

  it('履歴0件（未処理）では「処理の記録」の見出しごと出ない', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    await renderDetail(mail.id)
    expect(screen.queryByText('処理の記録')).toBeNull()
    expect(screen.getByText('未処理')).toBeTruthy()
  })

  it('セクション順が ヘッダ → 添付ファイル → 本文 → 処理の記録', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const event = await createEvent({ title: '順序確認大会' })
    const mail = await createMailMessage({
      subject: '順序確認件名',
      bodyText: '順序確認ボディ',
      triageStatus: 'processed',
      triagedAt: new Date('2026-08-02T00:00:00+09:00'),
      linkedEventId: event.id,
    })
    await createAttachment(mail.id, { filename: '順序確認添付.pdf' })

    const { container } = await renderDetail(mail.id)
    const text = container.textContent ?? ''

    const subjectIdx = text.indexOf('順序確認件名')
    const attachmentSectionIdx = text.indexOf('添付ファイル')
    const bodySectionIdx = text.indexOf('本文')
    const historySectionIdx = text.indexOf('処理の記録')

    expect(subjectIdx).toBeGreaterThanOrEqual(0)
    expect(attachmentSectionIdx).toBeGreaterThan(subjectIdx)
    expect(bodySectionIdx).toBeGreaterThan(attachmentSectionIdx)
    expect(historySectionIdx).toBeGreaterThan(bodySectionIdx)
  })

  it('AC-28: 詳細クエリの添付 columns に data を含めない', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({})
    await createAttachment(mail.id)

    // db.query.mailMessages.findFirst は drizzle の重い generics を持つため
    // vi.spyOn 経由だと型推論が壊れやすい（.mock.calls の型が never 化する等）。
    // 呼び出しを直接差し替えて config を捕まえる（実行は必ず元の実装へ委譲する）。
    const holder = db.query.mailMessages as unknown as {
      findFirst: (config: unknown) => unknown
    }
    const original = holder.findFirst
    const configs: unknown[] = []
    holder.findFirst = function (this: unknown, config: unknown) {
      configs.push(config)
      return original.call(this, config)
    }
    try {
      await renderDetail(mail.id)
    } finally {
      holder.findFirst = original
    }

    expect(configs.length).toBeGreaterThan(0)
    const config = configs[0] as {
      with?: { attachments?: { columns?: Record<string, unknown> } }
    }
    expect(config.with?.attachments?.columns?.data).toBeFalsy()
  })
})
