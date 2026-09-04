import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

const mockFindFirst = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      mailAttachments: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}))

const mockGetCachedPreviewMeta = vi.fn()
const mockRenderAttachmentPreview = vi.fn()
vi.mock('@/lib/attachment-preview', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/attachment-preview')>()
  return {
    ...actual,
    getCachedPreviewMeta: (...args: unknown[]) =>
      mockGetCachedPreviewMeta(...args),
    renderAttachmentPreview: (...args: unknown[]) =>
      mockRenderAttachmentPreview(...args),
  }
})

const { default: MemberAttachmentViewerPage } = await import('./page')

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    filename: '第46回九段大会要項.pdf',
    contentType: 'application/pdf',
    data: Buffer.from('dummy'),
    ...overrides,
  }
}

async function renderViewer(
  id: number | string,
  searchParams: Record<string, string> = {},
) {
  const ui = await MemberAttachmentViewerPage({
    params: Promise.resolve({ id: String(id) }),
    searchParams: Promise.resolve(searchParams),
  })
  return render(ui)
}

describe('mail/attachments/[id] 会員向け添付ビューア', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
    mockGetCachedPreviewMeta.mockReset()
    mockRenderAttachmentPreview.mockReset()
    mockGetCachedPreviewMeta.mockReturnValue(null)
  })

  it('未ログインは /auth/signin へ redirect する', async () => {
    await setAuthSession(null)
    await expect(renderViewer(1)).rejects.toThrow(
      'NEXT_REDIRECT:/auth/signin',
    )
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('role=member では redirect されない', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockFindFirst.mockResolvedValue(
      makeRow({ contentType: 'application/zip', filename: '一式.zip' }),
    )

    await renderViewer(1)

    expect(
      screen.getByText('アプリ内では表示できない形式です'),
    ).toBeTruthy()
  })

  // codex pr479 r1 blocker: `Number('1e5')` は 100000、`Number('0x10')` は 16 を
  // 返すため、素の Number 変換だと URL とは別の添付が開く。`01` も `1` と同じ行を
  // 指す別 URL になる。int4 上限超過はクエリに載ると pg の範囲外エラーで 500 に
  // なる。API ルートと同じ境界であることを固定する。
  it('不正な id (0 / 負数 / abc / 1.5 / 1e5 / 0x10 / 01 / int4超過) は notFound', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    for (const bad of [
      '0',
      '-1',
      'abc',
      '1.5',
      '1e5',
      '0x10',
      '01',
      '2147483648',
    ]) {
      await expect(renderViewer(bad)).rejects.toThrow('NEXT_NOT_FOUND')
    }
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('存在しない添付は notFound', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockFindFirst.mockResolvedValue(undefined)
    await expect(renderViewer(999)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  describe('4種の振り分け', () => {
    it('document: ページ画像を pageCount 枚、会員用 preview ルートで表示', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(makeRow({ contentType: 'application/pdf' }))
      mockRenderAttachmentPreview.mockResolvedValue({
        pageCount: 3,
        truncated: false,
      })

      const { container } = await renderViewer(1)

      const imgs = container.querySelectorAll('img')
      expect(imgs.length).toBe(3)
      expect(imgs[0]!.getAttribute('src')).toBe(
        '/api/mail/attachments/1/preview/1',
      )
      expect(imgs[2]!.getAttribute('src')).toBe(
        '/api/mail/attachments/1/preview/3',
      )
      // 管理者ルートを指していないこと
      for (const img of Array.from(imgs)) {
        expect(img.getAttribute('src')).not.toMatch(/\/api\/admin\//)
      }
    })

    it('image: バイナリルートを <img src> にそのまま表示', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'image/jpeg', filename: '会場図.jpg' }),
      )

      const { container } = await renderViewer(1)

      const img = container.querySelector('img')
      expect(img).not.toBeNull()
      expect(img!.getAttribute('src')).toBe('/api/mail/attachments/1')
      expect(img!.getAttribute('src')).not.toMatch(/\/api\/admin\//)
    })

    it('text: UTF-8 で <pre> 表示し、10万文字を超える場合は先頭で打ち切る', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      const longText = 'あ'.repeat(100_050)
      mockFindFirst.mockResolvedValue(
        makeRow({
          contentType: 'text/plain',
          filename: 'memo.txt',
          data: Buffer.from(longText, 'utf8'),
        }),
      )

      const { container } = await renderViewer(1)

      const pre = container.querySelector('pre')
      expect(pre).not.toBeNull()
      expect(pre!.textContent!.length).toBe(100_000)
      expect(
        screen.getByText(
          '長すぎるため先頭のみ表示しています。全文は元ファイルを参照してください。',
        ),
      ).toBeTruthy()
    })

    it('text: 上限未満の本文はそのまま全文表示し、打ち切り注記は出ない', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({
          contentType: 'text/plain',
          filename: 'memo.txt',
          data: Buffer.from('日本語の本文です', 'utf8'),
        }),
      )

      const { container } = await renderViewer(1)

      expect(container.querySelector('pre')!.textContent).toBe(
        '日本語の本文です',
      )
      expect(
        screen.queryByText(/長すぎるため先頭のみ表示しています/),
      ).toBeNull()
    })

    it('その他 (zip 等): 表示不可カード +「開く・保存」', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip', filename: '組合せ表.zip' }),
      )

      await renderViewer(1)

      expect(
        screen.getByText('アプリ内では表示できない形式です'),
      ).toBeTruthy()
      // ヘッダとカードの2箇所に出る（ヘッダ = 長い画面でも常に届く役、
      // カード = この画面で何をすればいいかを言う役）
      expect(screen.getAllByRole('button', { name: /開く・保存/ })).toHaveLength(
        2,
      )
    })

    it('spreadsheet (xlsx): ページ画像を1枚も出さず Excel 案内カードを出す', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: '第46回札幌大会申込名簿.xlsx',
        }),
      )

      const { container } = await renderViewer(1)

      expect(screen.getByText('Excel ファイルです')).toBeTruthy()
      expect(container.querySelectorAll('img')).toHaveLength(0)
      // 変換経路にも入らない
      expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
      expect(mockGetCachedPreviewMeta).not.toHaveBeenCalled()
    })
  })

  describe('AC-9 / AC-9b: 導線と削除された但し書き', () => {
    it('旧「元ファイル」リンクは残っていない', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip' }),
      )

      const { container } = await renderViewer(1)

      expect(screen.queryByText('元ファイル')).toBeNull()
      expect(screen.queryByText('元ファイルをダウンロード')).toBeNull()
      expect(
        container.querySelector('a[href="/api/mail/attachments/1"]'),
      ).toBeNull()
    })

    it('「PC からダウンロードしてください」の但し書きが出ない', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip' }),
      )

      const { container } = await renderViewer(1)

      expect(container.textContent).not.toContain('PC からダウンロード')
      expect(container.textContent).not.toContain('iPhone のアプリ内からは')
    })
  })

  it('AC-22: プレビュー生成失敗 (renderAttachmentPreview が throw) でも 500 にならずダウンロード導線つきカードが出る', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockFindFirst.mockResolvedValue(makeRow({ contentType: 'application/pdf' }))
    mockRenderAttachmentPreview.mockRejectedValue(new Error('soffice crashed'))

    await renderViewer(1)

    expect(
      screen.getByText('このファイルのプレビューを生成できませんでした'),
    ).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: /開く・保存/ }).length,
    ).toBeGreaterThan(0)
  })

  it('docMeta.pageCount === 0 でも同じカードに倒れる', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockFindFirst.mockResolvedValue(makeRow({ contentType: 'application/pdf' }))
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 0,
      truncated: false,
    })

    await renderViewer(1)

    expect(
      screen.getByText('このファイルのプレビューを生成できませんでした'),
    ).toBeTruthy()
  })

  describe('?from= の許可プレフィックス (AC-26)', () => {
    it('/mail/12 はそのまま ✕ の href になる', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip' }),
      )

      await renderViewer(1, { from: '/mail/12' })

      const close = screen.getByLabelText('閉じる')
      expect(close.getAttribute('href')).toBe('/mail/12')
    })

    it('/admin/mail-inbox は /mail に倒れる', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip' }),
      )

      await renderViewer(1, { from: '/admin/mail-inbox' })

      expect(screen.getByLabelText('閉じる').getAttribute('href')).toBe(
        '/mail',
      )
    })

    it('未指定でも /mail に倒れる', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip' }),
      )

      await renderViewer(1)

      expect(screen.getByLabelText('閉じる').getAttribute('href')).toBe(
        '/mail',
      )
    })

    it('//evil.example (プロトコル相対URL) も /mail に倒れる', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip' }),
      )

      await renderViewer(1, { from: '//evil.example' })

      expect(screen.getByLabelText('閉じる').getAttribute('href')).toBe(
        '/mail',
      )
    })

    // codex pr479 r1 blocker: `startsWith('/mail')` だと `/mail` で始まるだけの
    // 別パスを通してしまい、閉じる操作で許可対象外の内部パスへ飛ぶ。
    // 判定はセグメント境界（`/mail` 完全一致 / `/mail/` 配下 / `/mail?` クエリ付き）
    // で行う。
    it.each(['/mailbox', '/mail-archive', '/mailicious', '//mail/12'])(
      '%s は /mail に倒れる（セグメント境界で判定）',
      async (from) => {
        await setAuthSession({ id: 'u1', role: 'member' })
        mockFindFirst.mockResolvedValue(
          makeRow({ contentType: 'application/zip' }),
        )

        await renderViewer(1, { from })

        expect(screen.getByLabelText('閉じる').getAttribute('href')).toBe(
          '/mail',
        )
      },
    )

    it('/mail?q=九段&att=1 のようなクエリ付きはそのまま戻り先になる', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip' }),
      )

      await renderViewer(1, { from: '/mail?q=九段&att=1' })

      expect(screen.getByLabelText('閉じる').getAttribute('href')).toBe(
        '/mail?q=九段&att=1',
      )
    })
  })
})
