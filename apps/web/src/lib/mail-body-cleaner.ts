/**
 * 配信前のメール本文を LINE 用にクリーンアップするヘルパー。
 *
 * 現状の責務は 2 つ:
 *   1. Google Groups などの ML ソフトウェアが自動付与するフッターを除去
 *   2. 件名と訂正フラグを本文先頭に prefix として埋め込む
 *
 * 主催者の手書き署名は触らない (--  以降全削除は副作用が大きいので、
 * "Google Groups であることを明示しているブロック" だけを保守的に切る)。
 */

const CORRECTION_PREFIX = '【訂正】'

/**
 * Google Groups の典型フッター検出パターン。
 *
 * 検出条件: `-- ` 直後 (RFC 3676 のシグネチャ区切り) もしくは空行直後に、
 * 「このメールは Google グループ」「You received this message because you
 * are subscribed to the Google Groups」のいずれかが現れる。
 *
 * `[\s\S]*$` でその位置から末尾までを丸ごと除去する (Groups footer は
 * 通常メール本文の末尾固定で、複数行に渡る)。
 */
const GOOGLE_GROUPS_FOOTER_PATTERNS = [
  /(?:^|\r?\n)(?:-- ?\r?\n|\r?\n)このメールは Google グループ[\s\S]*$/,
  /(?:^|\r?\n)(?:-- ?\r?\n|\r?\n)You received this message because you are subscribed to the Google Groups[\s\S]*$/,
]

/**
 * 本文末尾の Google Groups footer を除去して trim する。
 * 該当しないメールでは末尾の余分な空白だけ落として返す。
 */
export function stripMailFooter(body: string): string {
  let result = body
  for (const pattern of GOOGLE_GROUPS_FOOTER_PATTERNS) {
    result = result.replace(pattern, '')
  }
  return result.trimEnd()
}

export interface BuildBroadcastBodyInput {
  /** 元のメール本文 (`mail_messages.body_text`) */
  rawBody: string | null | undefined
  /** メール件名 (`mail_messages.subject`)。null なら subject prefix は付かない */
  subject: string | null | undefined
  /** 訂正版かどうか (`tournament_drafts.is_correction`) */
  isCorrection: boolean
}

/**
 * LINE に push する最終的なテキストを組み立てる。
 *
 * 構成:
 *   1. (訂正版のみ) `【訂正】`
 *   2. `【<件名>】\n\n` (件名が空のときはスキップ)
 *   3. footer を除去した本文
 *
 * 例:
 *   通常配信: 「【第48回大会のお知らせ】\n\n本文...」
 *   訂正版:   「【訂正】【第48回大会のお知らせ(訂正版)】\n\n本文...」
 *
 * 全部結合した文字列は呼び出し側で `splitForLine` に渡して 5000 字
 * 上限に分割する前提なので、ここでは結合だけ。
 */
export function buildBroadcastBody(input: BuildBroadcastBodyInput): string {
  const cleanedBody = stripMailFooter(input.rawBody ?? '(本文なし)')
  const subject = input.subject?.trim() ?? ''
  const parts: string[] = []

  if (input.isCorrection) {
    // 訂正版マーカー。件名がある場合は次の `【件名】` と並んで `【訂正】【...】`
    // という二重括弧表記になる (視認性最優先)。
    parts.push(CORRECTION_PREFIX)
  }
  if (subject) {
    // 件名そのものを `【...】` で囲んで本文と視覚的に分離する。
    // ラベル文字 (例:「メール件名」) は付けない。
    parts.push(`【${subject}】\n\n`)
  } else if (input.isCorrection) {
    // 訂正版で件名が空の場合は `【訂正】` 単独でその後に改行を入れる。
    parts.push('\n')
  }
  parts.push(cleanedBody)
  return parts.join('')
}

export const _internal = {
  CORRECTION_PREFIX,
  GOOGLE_GROUPS_FOOTER_PATTERNS,
}
