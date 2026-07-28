import { describe, it, expect } from 'vitest'
import { isValidMailbox, mailboxError } from './mailbox'

/**
 * 設定保存・プレビュー入力・MIME 組立で規則が食い違うと、「保存はできたのに
 * 以後の下書き作成が必ず失敗する設定」を作れてしまう。1箇所で固定する。
 */
describe('isValidMailbox', () => {
  it('単一のメールアドレスを受理する', () => {
    expect(isValidMailbox('entry@example.invalid')).toBe(true)
    expect(isValidMailbox('  entry@example.invalid  ')).toBe(true)
  })

  it('複数アドレス・表示名つきは受理しない', () => {
    expect(isValidMailbox('a@example.invalid,b@example.invalid')).toBe(false)
    expect(isValidMailbox('a@example.invalid;b@example.invalid')).toBe(false)
    expect(isValidMailbox('名前 <a@example.invalid>')).toBe(false)
  })

  it('形式不備・空欄・制御文字を受理しない', () => {
    expect(isValidMailbox('entry')).toBe(false)
    expect(isValidMailbox('entry@')).toBe(false)
    expect(isValidMailbox('')).toBe(false)
    expect(isValidMailbox('a@example.invalid\r\nBcc: leak@example.invalid')).toBe(false)
  })
})

describe('mailboxError', () => {
  it('通れば null、通らなければ日本語の理由を返す', () => {
    expect(mailboxError('entry@example.invalid')).toBeNull()
    expect(mailboxError('')).toContain('入力されていません')
    expect(mailboxError('a@example.invalid\r\nX: y')).toContain('制御文字')
    expect(mailboxError('a,b@example.invalid')).toContain('形式が正しくありません')
  })
})
