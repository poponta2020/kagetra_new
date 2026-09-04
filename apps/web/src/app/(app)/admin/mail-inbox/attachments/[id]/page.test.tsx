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

const { default: AttachmentViewerPage } = await import('./page')

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
  id: number | string = 1,
  searchParams: Record<string, string> = {},
) {
  const ui = await AttachmentViewerPage({
    params: Promise.resolve({ id: String(id) }),
    searchParams: Promise.resolve(searchParams),
  })
  return render(ui)
}

beforeEach(() => {
  mockFindFirst.mockReset()
  mockGetCachedPreviewMeta.mockReset()
  mockRenderAttachmentPreview.mockReset()
  mockGetCachedPreviewMeta.mockReturnValue(null)
  mockRenderAttachmentPreview.mockResolvedValue({
    pageCount: 1,
    truncated: false,
  })
})

describe('管理者添付ビューア', () => {
  it('一般会員は /403 へ redirect する（認可は従来どおり role ベース）', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    await expect(renderViewer(1)).rejects.toThrow('NEXT_REDIRECT:/403')
  })

  it('vice_admin は閲覧できる', async () => {
    await setAuthSession({ id: 'u1', role: 'vice_admin' })
    mockFindFirst.mockResolvedValue(
      makeRow({ contentType: 'application/zip', filename: '一式.zip' }),
    )

    await renderViewer(1)

    expect(screen.getByText('アプリ内では表示できない形式です')).toBeTruthy()
  })

  it('存在しない添付は notFound', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockFindFirst.mockResolvedValue(undefined)
    await expect(renderViewer(999)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('spreadsheet (xlsx): ページ画像を1枚も出さず Excel 案内カードを出す', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
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
    expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
    expect(mockGetCachedPreviewMeta).not.toHaveBeenCalled()
  })

  it('document (pdf): ページ画像プレビューは従来どおり出る', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockFindFirst.mockResolvedValue(makeRow())
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 2,
      truncated: false,
    })

    const { container } = await renderViewer(1)

    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs.map((el) => el.getAttribute('src'))).toEqual([
      '/api/admin/mail/attachments/1/preview/1',
      '/api/admin/mail/attachments/1/preview/2',
    ])
  })

  it('AC-9 / AC-9b: 旧「元ファイル」リンクと但し書きが残っていない', async () => {
    await setAuthSession({ id: 'u1', role: 'admin' })
    mockFindFirst.mockResolvedValue(
      makeRow({ contentType: 'application/zip', filename: '一式.zip' }),
    )

    const { container } = await renderViewer(1)

    expect(screen.queryByText('元ファイル')).toBeNull()
    expect(screen.queryByText('元ファイルをダウンロード')).toBeNull()
    expect(
      container.querySelector('a[href="/api/admin/mail/attachments/1"]'),
    ).toBeNull()
    expect(container.textContent).not.toContain('PC からダウンロード')
    expect(container.textContent).not.toContain('iPhone のアプリ内からは')
    // ヘッダとカードの2箇所
    expect(screen.getAllByRole('button', { name: /開く・保存/ })).toHaveLength(2)
  })
})
