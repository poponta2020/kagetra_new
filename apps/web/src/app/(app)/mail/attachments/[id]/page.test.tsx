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
      screen.getByText('このファイル形式はアプリ内でプレビューできません。'),
    ).toBeTruthy()
  })

  it('不正な id (0 / 負数 / abc / 1.5) は notFound', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    for (const bad of ['0', '-1', 'abc', '1.5']) {
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

    it('その他 (zip 等): プレビュー不可カード + ダウンロードリンク', async () => {
      await setAuthSession({ id: 'u1', role: 'member' })
      mockFindFirst.mockResolvedValue(
        makeRow({ contentType: 'application/zip', filename: '組合せ表.zip' }),
      )

      await renderViewer(1)

      expect(
        screen.getByText('このファイル形式はアプリ内でプレビューできません。'),
      ).toBeTruthy()
      const link = screen.getByText('元ファイルをダウンロード')
      expect(link.closest('a')!.getAttribute('href')).toBe(
        '/api/mail/attachments/1',
      )
    })
  })

  it('AC-22: プレビュー生成失敗 (renderAttachmentPreview が throw) でも 500 にならずダウンロード導線つきカードが出る', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockFindFirst.mockResolvedValue(makeRow({ contentType: 'application/pdf' }))
    mockRenderAttachmentPreview.mockRejectedValue(new Error('soffice crashed'))

    await renderViewer(1)

    expect(
      screen.getByText('このファイルのプレビューを生成できませんでした。'),
    ).toBeTruthy()
    expect(screen.getByText('元ファイルをダウンロード')).toBeTruthy()
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
      screen.getByText('このファイルのプレビューを生成できませんでした。'),
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
  })
})
