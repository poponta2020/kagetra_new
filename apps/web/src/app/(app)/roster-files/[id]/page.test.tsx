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

/**
 * ★この画面は `db.query.mailAttachments` を直接引かず
 * `@/lib/roster-file-access` を経由する（採用済みかどうかの認可がそこに
 * 一本化されている）。他2つの添付ビューアのテストからモックブロックを
 * そのまま持ってくると動かない。
 */
const mockLoadAdoptedRosterFile = vi.fn()
vi.mock('@/lib/roster-file-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/roster-file-access')>()
  return {
    ...actual,
    loadAdoptedRosterFile: (...args: unknown[]) =>
      mockLoadAdoptedRosterFile(...args),
  }
})

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

const { default: RosterFileViewerPage } = await import('./page')

function makeAdopted(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    rosterType: 'applicant' as const,
    publishedAt: '2026-08-20',
    attachment: {
      id: 42,
      filename: '第46回札幌大会申込名簿.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    ...overrides,
  }
}

async function renderViewer(id: number | string = 7) {
  const ui = await RosterFileViewerPage({
    params: Promise.resolve({ id: String(id) }),
  })
  return render(ui)
}

beforeEach(() => {
  mockLoadAdoptedRosterFile.mockReset()
  mockFindFirst.mockReset()
  mockGetCachedPreviewMeta.mockReset()
  mockRenderAttachmentPreview.mockReset()
  mockGetCachedPreviewMeta.mockReturnValue(null)
  mockRenderAttachmentPreview.mockResolvedValue({
    pageCount: 1,
    truncated: false,
  })
})

describe('名簿ファイルビューア', () => {
  it('未ログインは /auth/signin へ redirect する', async () => {
    await setAuthSession(null)
    await expect(renderViewer()).rejects.toThrow('NEXT_REDIRECT:/auth/signin')
  })

  it('未採用・解除済み（loadAdoptedRosterFile が null）は notFound（回帰）', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockLoadAdoptedRosterFile.mockResolvedValue(null)
    await expect(renderViewer()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('spreadsheet (xlsx): ページ画像を1枚も出さず Excel 案内カードを出す', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockLoadAdoptedRosterFile.mockResolvedValue(makeAdopted())

    const { container } = await renderViewer()

    expect(screen.getByText('Excel ファイルです')).toBeTruthy()
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(mockRenderAttachmentPreview).not.toHaveBeenCalled()
    expect(mockGetCachedPreviewMeta).not.toHaveBeenCalled()
    // ボタンはカード内ではなくタイトル直下にあるので、カードは「上のボタンから」と受ける
    expect(
      screen.getByText(/上のボタンから Excel などの表計算アプリで開く/),
    ).toBeTruthy()
  })

  it('「開く・保存」はタイトルブロックの直下（プレビュー本体より前）に1つだけ置く', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockLoadAdoptedRosterFile.mockResolvedValue(makeAdopted())

    const { container } = await renderViewer()

    const buttons = screen.getAllByRole('button', { name: /開く・保存/ })
    expect(buttons).toHaveLength(1)

    const title = screen.getByText('第46回札幌大会申込名簿.xlsx')
    const card = screen.getByText('Excel ファイルです')
    const order = Array.from(container.querySelectorAll('*'))
    expect(order.indexOf(title)).toBeLessThan(order.indexOf(buttons[0]!))
    expect(order.indexOf(buttons[0]!)).toBeLessThan(order.indexOf(card))
  })

  it('document (pdf): ページ画像プレビューは従来どおり出る', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockLoadAdoptedRosterFile.mockResolvedValue(
      makeAdopted({
        attachment: {
          id: 42,
          filename: '確定名簿.pdf',
          contentType: 'application/pdf',
        },
      }),
    )
    mockFindFirst.mockResolvedValue({
      id: 42,
      filename: '確定名簿.pdf',
      contentType: 'application/pdf',
      data: Buffer.from('dummy'),
    })
    mockRenderAttachmentPreview.mockResolvedValue({
      pageCount: 2,
      truncated: false,
    })

    const { container } = await renderViewer()

    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs.map((el) => el.getAttribute('src'))).toEqual([
      '/api/roster-files/7/preview/1',
      '/api/roster-files/7/preview/2',
    ])
  })

  it('AC-9 / AC-9b: 旧ダウンロードリンクと但し書きが残っていない', async () => {
    await setAuthSession({ id: 'u1', role: 'member' })
    mockLoadAdoptedRosterFile.mockResolvedValue(makeAdopted())

    const { container } = await renderViewer()

    expect(screen.queryByText('元ファイルをダウンロード')).toBeNull()
    expect(container.querySelector('a[href="/api/roster-files/7"]')).toBeNull()
    expect(container.textContent).not.toContain('PC からダウンロード')
    expect(container.textContent).not.toContain('iPhone のアプリ内からは')
  })
})
