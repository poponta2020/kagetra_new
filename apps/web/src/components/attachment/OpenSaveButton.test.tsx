import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OpenSaveButton, pickShareMimeType } from './OpenSaveButton'

/**
 * jsdom には `navigator.share` / `navigator.canShare` / `URL.createObjectURL`
 * のいずれも存在しない。ここで検証できるのは**ラダーの分岐**であって
 * iOS/Android の実挙動ではない（実機確認は requirements の AC-16/17/18 で
 * manual として分離してある）。
 */

const ERROR_TEXT = /ファイルを取り込めませんでした/

function stubShare(canShare: boolean) {
  const share = vi.fn(async (_data?: { files: File[] }) => {})
  Object.defineProperty(navigator, 'share', {
    value: share,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(navigator, 'canShare', {
    value: vi.fn(() => canShare),
    configurable: true,
    writable: true,
  })
  return share
}

function removeShare() {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'share')
  Reflect.deleteProperty(
    navigator as unknown as Record<string, unknown>,
    'canShare',
  )
}

function okResponse(body = 'xlsx-bytes') {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([body], { type: 'application/octet-stream' }),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => okResponse())
  vi.stubGlobal('fetch', fetchMock)
  createObjectURL = vi.fn(() => 'blob:stub')
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  removeShare()
  vi.restoreAllMocks()
})

function renderButton(filename = '第46回札幌大会申込名簿.xlsx') {
  return render(
    <OpenSaveButton
      href="/api/mail/attachments/12"
      filename={filename}
      variant="block"
    />,
  )
}

describe('pickShareMimeType', () => {
  it('拡張子から Excel の MIME を引く（route が octet-stream を返す .xlsm を含む）', () => {
    expect(pickShareMimeType('名簿.xlsx', 'application/octet-stream')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(pickShareMimeType('集計.XLSM', 'application/octet-stream')).toBe(
      'application/vnd.ms-excel.sheet.macroEnabled.12',
    )
  })

  it('未知の拡張子はレスポンスの Content-Type に倒す', () => {
    expect(pickShareMimeType('archive.rar', 'application/x-rar')).toBe(
      'application/x-rar',
    )
    expect(pickShareMimeType('noext', '')).toBe('application/octet-stream')
  })
})

describe('OpenSaveButton', () => {
  it('共有できる環境ではバイナリを取り込んで共有シートへ File を渡す', async () => {
    const share = stubShare(true)
    renderButton()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/mail/attachments/12', {
      credentials: 'same-origin',
    })
    const [payload] = share.mock.calls[0] as unknown as [{ files: File[] }]
    const { files } = payload
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('第46回札幌大会申込名簿.xlsx')
    expect(files[0]!.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('共有が使えない環境では <a download> のダウンロードに倒す', async () => {
    removeShare()
    renderButton()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:stub'))
    expect(screen.queryByText(ERROR_TEXT)).toBeNull()
  })

  it('canShare が false のときもダウンロードに倒す', async () => {
    const share = stubShare(false)
    renderButton()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    expect(share).not.toHaveBeenCalled()
  })

  it('共有シートのキャンセル（AbortError）ではエラーを出さない', async () => {
    const share = stubShare(true)
    const abort = new Error('user cancelled')
    abort.name = 'AbortError'
    share.mockRejectedValueOnce(abort)
    renderButton()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(ERROR_TEXT)).toBeNull()
    expect(screen.getByRole('button').textContent).toContain('開く・保存')
  })

  it('NotAllowedError では再タップを促し、2回目は再取得しない', async () => {
    const share = stubShare(true)
    const notAllowed = new Error('gesture expired')
    notAllowed.name = 'NotAllowedError'
    share.mockRejectedValueOnce(notAllowed)
    renderButton()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(screen.getByRole('button').textContent).toContain(
        'もう一度タップして開く',
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    // バイトは保持済み。2回目のタップで再ダウンロードしない。
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button').textContent).toContain('開く・保存')
  })

  it('取り込みに失敗したらエラー文言を出し、例外を投げない', async () => {
    stubShare(true)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      blob: async () => new Blob([]),
    } as unknown as Response)
    renderButton()

    fireEvent.click(screen.getByRole('button'))

    expect(await screen.findByText(ERROR_TEXT)).toBeTruthy()
  })

  it('ネットワーク例外でもエラー文言に倒す', async () => {
    stubShare(true)
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    renderButton()

    fireEvent.click(screen.getByRole('button'))

    expect(await screen.findByText(ERROR_TEXT)).toBeTruthy()
  })

  it('取り込み中はボタンを押せない', async () => {
    const share = stubShare(true)
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    renderButton()

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(screen.getByRole('button').textContent).toContain('準備中…'),
    )
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      true,
    )

    release(okResponse())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  })
})
