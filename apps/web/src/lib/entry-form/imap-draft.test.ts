// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * ImapFlow は実 IMAP へ接続させず、connect/append/logout の呼出引数だけを
 * 検証する。`vi.hoisted` はこのファイルの既存パターン（line-webhook-handler
 * .test.ts の `sendGuidelinesOnLinkSpy` 等）に倣い、`vi.mock` ファクトリから
 * 参照できるよう hoist の巻き上げ順を明示する。
 */
const { connectMock, appendMock, logoutMock, ImapFlowConstructorMock } = vi.hoisted(() => ({
  connectMock: vi.fn(async () => undefined),
  // append の引数を assert するため、シグネチャ付きで宣言する（引数なしの
  // vi.fn だと mock.calls の要素が空タプル型になり index アクセスできない）。
  appendMock: vi.fn(async (_mailbox: string, _content: string, _flags?: string[]) => undefined),
  logoutMock: vi.fn(async () => undefined),
  ImapFlowConstructorMock: vi.fn(),
}))

vi.mock('imapflow', () => ({
  ImapFlow: ImapFlowConstructorMock.mockImplementation(() => ({
    connect: connectMock,
    append: appendMock,
    logout: logoutMock,
  })),
}))

const { loadImapConfigMock } = vi.hoisted(() => ({
  loadImapConfigMock: vi.fn(),
}))

vi.mock('@kagetra/mail-worker/config', () => ({
  loadImapConfig: loadImapConfigMock,
}))

import { appendDraftToYahoo } from './imap-draft'

const VALID_CONFIG = {
  YAHOO_IMAP_HOST: 'imap.mail.yahoo.co.jp',
  YAHOO_IMAP_PORT: 993,
  YAHOO_IMAP_USER: 'karuta_hokudai@yahoo.co.jp',
  YAHOO_IMAP_APP_PASSWORD: 'test-app-password',
}

beforeEach(() => {
  connectMock.mockClear().mockResolvedValue(undefined)
  appendMock.mockClear().mockResolvedValue(undefined)
  logoutMock.mockClear().mockResolvedValue(undefined)
  ImapFlowConstructorMock.mockClear()
  loadImapConfigMock.mockReset().mockReturnValue({ ...VALID_CONFIG })
})

describe('appendDraftToYahoo', () => {
  it('Draft フォルダへ \\Draft フラグ付きで APPEND し、成功したら logout する', async () => {
    await appendDraftToYahoo('RAW MIME CONTENT')

    expect(ImapFlowConstructorMock).toHaveBeenCalledWith({
      host: 'imap.mail.yahoo.co.jp',
      port: 993,
      secure: true,
      auth: { user: 'karuta_hokudai@yahoo.co.jp', pass: 'test-app-password' },
      logger: false,
    })
    expect(connectMock).toHaveBeenCalledTimes(1)
    expect(appendMock).toHaveBeenCalledTimes(1)
    const [mailbox, content, flags] = appendMock.mock.calls[0]!
    expect(mailbox).toBe('Draft')
    expect(content).toBe('RAW MIME CONTENT')
    expect(flags).toContain('\\Draft')
    expect(logoutMock).toHaveBeenCalledTimes(1)
  })

  it('mailbox オプションで下書きフォルダ名を上書きできる（Drafts 名のアカウント対応）', async () => {
    await appendDraftToYahoo('RAW MIME CONTENT', { mailbox: 'Drafts' })
    const [mailbox] = appendMock.mock.calls[0]!
    expect(mailbox).toBe('Drafts')
  })

  it('YAHOO_IMAP_USER が未設定なら接続前に日本語エラーを投げる（ImapFlow は生成されない）', async () => {
    loadImapConfigMock.mockReturnValue({
      YAHOO_IMAP_HOST: 'imap.mail.yahoo.co.jp',
      YAHOO_IMAP_PORT: 993,
      YAHOO_IMAP_USER: undefined,
      YAHOO_IMAP_APP_PASSWORD: undefined,
    })
    await expect(appendDraftToYahoo('RAW MIME CONTENT')).rejects.toThrow(
      'YAHOO_IMAP_USER / YAHOO_IMAP_APP_PASSWORD が設定されていません。下書き作成には IMAP 資格情報が必要です。',
    )
    expect(ImapFlowConstructorMock).not.toHaveBeenCalled()
  })

  it('append が失敗したら logout を試みたうえで日本語エラーを投げる', async () => {
    appendMock.mockRejectedValue(new Error('Connection closed unexpectedly'))
    await expect(appendDraftToYahoo('RAW MIME CONTENT')).rejects.toThrow(
      'Yahoo メールへの下書き作成に失敗しました: Connection closed unexpectedly',
    )
    expect(logoutMock).toHaveBeenCalledTimes(1)
  })

  it('connect が失敗した場合も logout を試みたうえで日本語エラーを投げる', async () => {
    connectMock.mockRejectedValue(new Error('ETIMEDOUT'))
    await expect(appendDraftToYahoo('RAW MIME CONTENT')).rejects.toThrow(
      'Yahoo メールへの下書き作成に失敗しました: ETIMEDOUT',
    )
    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(appendMock).not.toHaveBeenCalled()
  })

  it('logout 自体が失敗しても（catch で握りつぶし）元のエラーを投げる', async () => {
    appendMock.mockRejectedValue(new Error('Connection closed unexpectedly'))
    logoutMock.mockRejectedValue(new Error('already disconnected'))
    await expect(appendDraftToYahoo('RAW MIME CONTENT')).rejects.toThrow(
      'Yahoo メールへの下書き作成に失敗しました: Connection closed unexpectedly',
    )
  })
})
