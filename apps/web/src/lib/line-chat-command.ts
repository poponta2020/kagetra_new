/**
 * line-chat-command: 大会グループでの Bot メンション発言から「申込」「支払」の意図を
 * 読み取る（要件 §3.2.2 / §3.2.4）。
 *
 * **このモジュールは pure**。`node:` import・`@kagetra/shared` import・`@/lib/db` import を
 * 一切行わない。webhook ハンドラの語判定・否定判定だけを DB を起動せずにユニットテスト
 * できるようにするため（`entry-fee.ts` と `entry-fee-tally.ts` の分離と同じ流儀）。
 * DB 側での申込・支払の実行と権限判定は呼び出し側（webhook ハンドラ）の責務。
 */

/** LINE webhook の message.mention の1要素（受け取る最小形）。 */
export interface LineMentionee {
  index: number
  length: number
  userId?: string
  type?: string
  isSelf?: boolean
}

export interface LineMessageMention {
  mentionees?: LineMentionee[]
}

export interface ParseChatCommandInput {
  /** 発言の生テキスト（trim 前でよい）。 */
  text: string
  /** message.mention（無ければ null / undefined）。 */
  mention?: LineMessageMention | null
  /** この Bot の LINE userId（webhook payload の `destination`）。 */
  botUserId: string
}

export interface ChatCommandIntent {
  /** Bot 自身がメンションされているか。false ならこの機能は一切発火しない。 */
  mentionsBot: boolean
  /** 申込語を含むか（メンション文字列を除去した後の本文で判定）。 */
  entry: boolean
  /** 支払語を含むか（同上）。 */
  payment: boolean
  /** 否定表現を含むか。true のときは実行せず「判定できなかった」返信をする。 */
  negated: boolean
}

/**
 * 申込語（要件 §3.2.2 に列挙）。「申込」「申し込み」が他の語を部分文字列として
 * 包含するため実質2語で足りるが、要件に列挙された表記ゆれをそのままテストで
 * 固定できるよう明示的に列挙しておく。
 *
 * ★`申し込ん` は要件の列挙には無いが**必要**。要件 §3.2.2 が両語同時の例として
 * 挙げている「申し込んで振り込みました」（AC-9）は、列挙語のどれにも一致しない
 * （`申し込み` でも `申し込んだ` でもなく `申し込んで`）。連用形の語幹 `申し込ん` を
 * 足して AC-9 を満たす。`申し込んでいません` のような否定形は §3.2.4 の否定判定が
 * 先に弾くので、安全側は保たれる。
 */
const ENTRY_WORDS = [
  '申込',
  '申し込み',
  '申し込ん',
  '申込完了',
  '申込済',
  '申し込みました',
  '申し込んだ',
]

/**
 * 支払語（要件 §3.2.2 に列挙）。「振込」「振り込み」が他を包含するが同様に明示列挙。
 *
 * ★`振り込ん` は申込側の `申し込ん` と対称に足したもの（「振り込んできました」が
 * 申込側だけ通って支払側は通らない、という利用者から見て説明のつかない差を作らない）。
 */
const PAYMENT_WORDS = [
  '振込',
  '振り込み',
  '振り込ん',
  '振込完了',
  '振り込みました',
  '入金しました',
  '支払いました',
  '払いました',
]

/**
 * 否定表現（要件 §3.2.4）。「まだ申し込んでません」のような取り消し不能操作の
 * 事故を防ぐための安全側の判定。「た」「ました」等の肯定完了表現とは重ならない語のみ。
 */
const NEGATION_WORDS = ['ません', 'ない', 'まだ', '未']

/** `mentionees[]` のいずれかが Bot 自身を指しているか。 */
function isBotMentioned(mentionees: LineMentionee[], botUserId: string): boolean {
  return mentionees.some((m) => m.isSelf === true || m.userId === botUserId)
}

/**
 * `mentionees[]` の全 range（`index` 〜 `index + length`）を本文から取り除く。
 *
 * 自分へのメンションだけでなく他人へのメンション range も取り除く（共同メンションされた
 * 人の表示名が「申込Bot」のように語を含む場合の誤判定を防ぐため）。`index` の降順
 * （後ろから前へ）に削除しないと、前方の削除で後続の `index` がずれて誤った範囲を
 * 切り取ってしまう。`index` / `length` が範囲外・負値でも throw しないよう clamp する。
 */
function stripMentionRanges(text: string, mentionees: LineMentionee[]): string {
  const ranges = mentionees
    .map((m) => {
      const start = Math.max(0, Math.min(m.index, text.length))
      const end = Math.max(start, Math.min(m.index + m.length, text.length))
      return { start, end }
    })
    // 降順（end が大きい = 後方のメンションから）で削除する
    .sort((a, b) => b.start - a.start)

  let result = text
  for (const { start, end } of ranges) {
    result = result.slice(0, start) + result.slice(end)
  }
  return result
}

/** 発言テキストとメンション情報から「申込」「支払」の意図・否定・自己メンションを判定する。 */
export function parseChatCommand(input: ParseChatCommandInput): ChatCommandIntent {
  const { text, mention, botUserId } = input
  const mentionees = mention?.mentionees ?? []

  const mentionsBot = isBotMentioned(mentionees, botUserId)
  if (!mentionsBot) {
    return { mentionsBot: false, entry: false, payment: false, negated: false }
  }

  const body = stripMentionRanges(text, mentionees)

  const entry = ENTRY_WORDS.some((word) => body.includes(word))
  const payment = PAYMENT_WORDS.some((word) => body.includes(word))
  const negated = NEGATION_WORDS.some((word) => body.includes(word))

  return { mentionsBot: true, entry, payment, negated }
}
