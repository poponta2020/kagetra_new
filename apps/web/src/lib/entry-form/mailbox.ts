/**
 * entry-form-autofill: メールアドレス（表示名なしの単一メールボックス）の検証を
 * 一本化する。
 *
 * 設定の保存・プレビューの入力・MIME 組立の3箇所で規則が食い違うと、「保存はできた
 * のに以後の下書き作成が必ず失敗する設定」を作れてしまう（カンマ区切りなど）。
 * `import 'server-only'` を付けないのは、クライアント側の入力チェックからも
 * 同じ規則を使うため。
 */

/** 制御文字（C0 全域と DEL）。ヘッダ注入の防止。 */
const CONTROL_CHAR_RE = new RegExp('[\\u0000-\\u001f\\u007f]')
/** 単一メールボックス。カンマ・セミコロン・山括弧・空白は許さない。 */
const MAILBOX_RE = new RegExp('^[^\\s@,;<>]+@[^\\s@,;<>]+\\.[^\\s@,;<>]+$')

export function isValidMailbox(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  if (CONTROL_CHAR_RE.test(trimmed)) return false
  return MAILBOX_RE.test(trimmed)
}

/** 検証に失敗した理由を日本語で返す（通れば `null`）。 */
export function mailboxError(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'メールアドレスが入力されていません'
  if (CONTROL_CHAR_RE.test(trimmed)) {
    return 'メールアドレスに改行や制御文字を含めることはできません'
  }
  if (!MAILBOX_RE.test(trimmed)) {
    return 'メールアドレスの形式が正しくありません（1件だけ・表示名なしで入力してください）'
  }
  return null
}
