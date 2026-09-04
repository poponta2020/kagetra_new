import { formatEventDate } from '@/lib/event-date'

/**
 * line-mention: LINE `textV2` メンション付きメッセージの組み立て基盤（要件 §3.2.2 / §6）。
 *
 * **このモジュールは pure**。`node:` import・`@kagetra/shared` import・`@/lib/db` import を
 * 一切行わない。webhook の①〜④・会計向け通知・振込連絡など、メンションを送る全経路が
 * 共通で使う契約になるため、DB や重依存（sharp / libreoffice 等）を持ち込むと
 * それらのユニットテストが DB 依存になってしまう（`line-flex-attachment.ts` と同じ流儀）。
 *
 * ★中核の制約（要件 §3.2.2）: `textV2` は本文中の中括弧 `{}` をプレースホルダ構文として
 * 解釈するため、大会名・支払情報などの自由記述文字列をメンション付きメッセージへ混ぜると
 * 本文が壊れる。そのため差し込める値を `number`（人数・金額）と `{ dateIso }`（日付）だけに
 * **型で**制限し、さらに `template` / `label` に中括弧が含まれていないかを**実行時にも**検証する
 * （AC-8）。自由記述（`payment_info` 等）は `buildTextMessage` でメンションを持たない
 * 別メッセージとして送る。
 */

/** LINE の送信メッセージ（このリポジトリで使う2形式のユニオン）。
 *  push / reply の両トランスポートがこの型を受け取る契約になる。 */
export type LineMessage = LineTextMessage | LineTextV2Message | LineImageMessage

export interface LineTextMessage {
  type: 'text'
  text: string
}

/**
 * payment-receipt-broadcast: 画像メッセージ（支払報告の証憑）。
 *
 * `originalContentUrl` / `previewImageUrl` は **https 絶対 URL の JPEG** でなければ
 * LINE 側が取得に失敗する（本体 10MB・4096x4096 以内、プレビュー 1MB 以内）。URL の
 * 組み立てと画像の正規化は呼び出し側の責務で、この型は push / reply の両トランスポートが
 * テキストと同じ配列に混ぜて渡せるようにするためだけに union へ加えている。
 *
 * ★`lib/line-broadcast.ts` にも同名のローカル `LineMessage` interface があるが**別物**。
 * あちらは要綱配信パイプライン専用（flex も持つ）で、こちらはライフサイクル通知・
 * 振込連絡・支払報告が使う共通契約。
 */
export interface LineImageMessage {
  type: 'image'
  originalContentUrl: string
  previewImageUrl: string
}

export interface LineTextV2Message {
  type: 'textV2'
  text: string
  substitution: Record<string, LineMentionSubstitution>
}

export interface LineMentionSubstitution {
  type: 'mention'
  mentionee: { type: 'all' } | { type: 'user'; userId: string }
}

/** メンションの宛先。`users` は解決済みの `users.line_user_id` の配列（id 昇順で渡される前提）。 */
export type MentionTarget =
  | { kind: 'all' }
  | { kind: 'users'; userIds: readonly string[] }

/** 本文テンプレートへ差し込める値。**自由記述の string は受け取らない**（AC-8）。 */
export type MentionValue = number | { dateIso: string }

export interface MentionMessageInput {
  /** メンション対象。 */
  mention: MentionTarget
  /** メンションが解決できないときに1行目へ出す素テキスト（例 `@会計` / `@管理者` / `@All`）。 */
  label: string
  /** 本文（メンション行の**下**に置かれる）。呼び出し側のリテラル定数であること。
   *  `%s` を values で順に置換する。中括弧を含むと throw する。 */
  template: string
  /** `%s` へ順に差し込む値。number はそのまま10進表記、`{ dateIso }` は `formatEventDate` で `M/D(曜)` へ。 */
  values?: readonly MentionValue[]
}

/**
 * LINE のメンション上限（1メッセージあたり最大20件）。
 *
 * `substitution` 全体の上限は100オブジェクトだが、**メンションはそれとは別に20件**という
 * 制約がある。超過するとメッセージ全体が拒否されるので、厳しい側（20）で切る
 * （会計・管理者はいずれも数名の運用なので実際には到達しない）。
 */
const MAX_MENTIONS = 20

/** `template` / `label` の中括弧禁止を検証する（AC-8）。 */
function assertNoBraces(value: string, fieldName: string): void {
  if (value.includes('{') || value.includes('}')) {
    throw new Error(
      `line-mention: ${fieldName} に中括弧を含めることはできません（textV2 のプレースホルダ構文と衝突するため）: ${value}`,
    )
  }
}

/** `values[i]` を本文へ差し込む文字列へ変換する。number は桁区切り無し。 */
function formatMentionValue(value: MentionValue): string {
  if (typeof value === 'number') return String(value)
  return formatEventDate(value.dateIso)
}

/** `template` 中の `%s` を左から順に `values` で置換する。個数不一致は throw する。 */
function renderTemplate(template: string, values: readonly MentionValue[]): string {
  const placeholderCount = (template.match(/%s/g) ?? []).length
  if (placeholderCount !== values.length) {
    throw new Error(
      `line-mention: template の %s の数（${placeholderCount}）と values の数（${values.length}）が一致しません`,
    )
  }
  let i = 0
  // `noUncheckedIndexedAccess` 下では values[i] が undefined 型を含むため、
  // 個数一致を検証済みでも明示的に取り出してから渡す。
  return template.replace(/%s/g, () => {
    const value = values[i++]
    return value === undefined ? '' : formatMentionValue(value)
  })
}

/**
 * メンション付きメッセージを組み立てる。
 * - `mention.kind === 'all'` → 常に textV2（`mentionee.type='all'`）
 * - `mention.kind === 'users'` かつ userIds が1件以上 → textV2。**1件につき1つの substitution**
 *   （`m0` `m1` …）を作り、1行目はそれらを**半角スペース区切り**で並べる。
 *   LINE のメンション上限（20件）を超える分は黙って捨てる
 * - `mention.kind === 'users'` かつ userIds が空 → メンションを付けず `{ type:'text' }` を返す。
 *   1行目は `label` の素テキスト（AC-5: 会計0人でも文面は崩さない）
 */
export function buildMentionMessage(input: MentionMessageInput): LineMessage {
  const { mention, label, template, values = [] } = input
  assertNoBraces(template, 'template')
  assertNoBraces(label, 'label')
  const body = renderTemplate(template, values)

  if (mention.kind === 'users' && mention.userIds.length === 0) {
    const mentionLine = label
    return { type: 'text', text: body === '' ? mentionLine : `${mentionLine}\n${body}` }
  }

  const substitution: Record<string, LineMentionSubstitution> = {}
  const placeholders: string[] = []

  if (mention.kind === 'all') {
    substitution.m0 = { type: 'mention', mentionee: { type: 'all' } }
    placeholders.push('{m0}')
  } else {
    const userIds = mention.userIds.slice(0, MAX_MENTIONS)
    userIds.forEach((userId, i) => {
      const key = `m${i}`
      substitution[key] = { type: 'mention', mentionee: { type: 'user', userId } }
      placeholders.push(`{${key}}`)
    })
  }

  const mentionLine = placeholders.join(' ')
  const text = body === '' ? mentionLine : `${mentionLine}\n${body}`
  return { type: 'textV2', text, substitution }
}

/**
 * メンションを持たない素のテキストメッセージ。自由記述（`payment_info` 等）はこちらで送る。
 * 中括弧の検証は**しない**（textV2 ではないので解釈されない）。
 */
export function buildTextMessage(text: string): LineTextMessage {
  return { type: 'text', text }
}
