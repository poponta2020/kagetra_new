import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mailAttachments, mailBodyShareTokens } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createMailMessage } from '@/test-utils/seed'

const { default: MailSharePage, metadata, dynamic } = await import('./page')

async function createToken(
  mailMessageId: number,
  overrides: { token?: string; expiresAt?: Date } = {},
) {
  const [row] = await testDb
    .insert(mailBodyShareTokens)
    .values({
      mailMessageId,
      token: overrides.token ?? 'a'.repeat(32),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 86_400_000),
    })
    .returning()
  if (!row) throw new Error('Failed to insert test mail body share token')
  return row
}

async function renderShare(token: string) {
  const ui = await MailSharePage({ params: Promise.resolve({ token }) })
  return render(ui)
}

describe('/mail-share/[token] 公開の全文ページ', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('module の robots/dynamic 設定（AC-16）', () => {
    expect(dynamic).toBe('force-dynamic')
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('AC-13: 有効トークンで件名・受信日時・本文全文が表示される', async () => {
    const receivedAt = new Date('2026-08-01T21:07:00+09:00')
    const mail = await createMailMessage({
      subject: '第48回大会のお知らせ',
      bodyText: '本文の全文です。\n2行目もあります。',
      receivedAt,
    })
    const share = await createToken(mail.id)

    await renderShare(share.token)

    expect(screen.getByText('第48回大会のお知らせ')).toBeTruthy()
    expect(screen.getByText('2026年8月1日(土) 21:07')).toBeTruthy()
    expect(
      screen.getByText((_, node) => node?.textContent === '本文の全文です。\n2行目もあります。'),
    ).toBeTruthy()
  })

  it('AC-14: Google Groups フッターが除去され、改行が保持される', async () => {
    const mail = await createMailMessage({
      bodyText:
        '本文本体です。\n続きの行。\n-- \nこのメールは Google グループのフッターです。',
    })
    const share = await createToken(mail.id)

    const { container } = await renderShare(share.token)

    expect(
      screen.getByText((_, node) => node?.textContent === '本文本体です。\n続きの行。'),
    ).toBeTruthy()
    expect(screen.queryByText(/Google グループ/)).toBeNull()
    // 改行は CSS white-space で見た目上保持される（textContent の \n だけでは
    // レンダリング上の改行保持を担保しないため、クラスも直接検証する）。
    expect(container.querySelector('pre')?.className).toContain('whitespace-pre-wrap')
  })

  it('AC-14: <script> を含む本文はテキストとして表示され、実行されない', async () => {
    const mail = await createMailMessage({
      bodyText: '注意事項です。<script>alert(1)</script>続き',
    })
    const share = await createToken(mail.id)

    const { container } = await renderShare(share.token)

    expect(container.querySelector('script')).toBeNull()
    expect(
      screen.getByText((_, node) =>
        node?.textContent === '注意事項です。<script>alert(1)</script>続き',
      ),
    ).toBeTruthy()
  })

  it('AC-15: 期限切れトークンは同一の案内ページ', async () => {
    const mail = await createMailMessage({})
    const share = await createToken(mail.id, {
      expiresAt: new Date(Date.now() - 1000),
    })

    await renderShare(share.token)

    expect(screen.getByText('有効期限が切れました')).toBeTruthy()
    expect(
      screen.getByText('このリンクは無効か、有効期限（60日）が切れています。'),
    ).toBeTruthy()
    expect(
      screen.getByText('北溟の会員は、アプリの「受信メール」から同じメールを検索できます。'),
    ).toBeTruthy()
  })

  it('AC-15: 存在しないトークンは同一の案内ページ', async () => {
    await renderShare('b'.repeat(32))
    expect(screen.getByText('有効期限が切れました')).toBeTruthy()
  })

  it('AC-15: 形式不正なトークンは同一の案内ページ（DB へ問い合わせない）', async () => {
    for (const bad of ['abc', '!!!', '']) {
      const { unmount } = await renderShare(bad)
      expect(screen.getByText('有効期限が切れました')).toBeTruthy()
      unmount()
    }
  })

  it('AC-17: 添付ファイル名・大会名が表示されない', async () => {
    const mail = await createMailMessage({
      subject: '第48回大会のお知らせ',
      bodyText: '本文です。',
    })
    await testDb.insert(mailAttachments).values({
      mailMessageId: mail.id,
      filename: '秘密の添付ファイル.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1024,
      data: Buffer.from('x'),
    })
    const share = await createToken(mail.id)

    await renderShare(share.token)

    expect(screen.queryByText(/秘密の添付ファイル/)).toBeNull()
    expect(screen.queryByText(/添付/)).toBeNull()
  })

  it('件名が空なら (件名なし) と表示する', async () => {
    const mail = await createMailMessage({ subject: null })
    const share = await createToken(mail.id)

    await renderShare(share.token)

    expect(screen.getByText('(件名なし)')).toBeTruthy()
  })

  it('本文が空なら (本文なし) と表示する', async () => {
    const mail = await createMailMessage({ bodyText: null })
    const share = await createToken(mail.id)

    await renderShare(share.token)

    expect(screen.getByText('(本文なし)')).toBeTruthy()
  })

  it('access_count が加算される', async () => {
    const mail = await createMailMessage({})
    const share = await createToken(mail.id)

    await renderShare(share.token)

    const rows = await testDb.query.mailBodyShareTokens.findMany({
      where: (t, { eq }) => eq(t.id, share.id),
    })
    expect(rows[0]?.accessCount).toBe(1)
  })
})
