/**
 * 保存済みオープンチャット行から LINE Flex Message JSON を組み立てる
 * (openchat-broadcast §3.2.5)。
 *
 * design-spec.md 「Flex はトークンの外」の通り、LINE Flex は LINE アプリ側の
 * レンダラで描画されるためこちらの CSS も --kg-* トークンも一切届かない。
 * 色は design-spec の色表の値をそのまま Flex JSON にリテラルで書く
 * (line-flex-attachment.ts と同じ流儀)。このモジュールも同モジュールと同じ
 * pure 制約 (fetch を呼ばない・node: import を使わない・@kagetra/shared /
 * drizzle-orm / @/lib/db を import しない・sharp や libreoffice 等の重依存を
 * 持ち込まない) を守る。line-flex-attachment.ts を import せず自前で型・
 * ヘルパーを持つのは、添付カードとオープンチャットカードは無関係な文脈で
 * あり、どちらかが将来重依存を持ち込んでももう一方を巻き込まないため。
 */

/** LINE Flex Message (push API にそのまま JSON 送信できる形)。 */
export interface OpenChatFlexMessage {
  type: 'flex'
  /** トーク一覧・プッシュ通知に表示される代替テキスト (LINE 仕様: 最大 400 字)。 */
  altText: string
  contents: Record<string, unknown>
}

/**
 * 配信対象の保存済みオープンチャット1行。
 * label は自動生成規則 (§3.2.1) を適用済みの最終ラベル文字列を渡すこと
 * (この関数は自動生成ロジックを持たない)。
 */
export interface OpenChatFlexRow {
  url: string
  label: string
  password: string | null
}

const ALT_TEXT_MAX = 400

/**
 * altText を UTF-16 単位で上限まで切り詰める。line-flex-attachment.ts の
 * truncateToUtf16Units と同一実装 (コメント冒頭に記載の理由でこのファイルは
 * あちらを import しない)。`slice` を直接使うと、上限位置がサロゲートペアの
 * 途中に当たったとき単独サロゲートが末尾に残り、通知・トーク一覧に不正な
 * 文字が出る (大会名に使われうる 𠮟・𩸽 等の JIS 第3・第4水準漢字で実際に
 * 起こる)。コードポイント境界で止めることでこれを防ぐ。
 */
function truncateToUtf16Units(text: string, limit: number): string {
  if (text.length <= limit) return text
  let out = ''
  for (const ch of text) {
    if (out.length + ch.length > limit) break
    out += ch
  }
  return out
}

// design-spec.md 「Flex はトークンの外」の色表 (--oc-flex-*) をそのまま転記。
// このファイル内でのみ使う値のためモジュール外へは export しない。
const FLEX_FG = '#111111' // 大会名
const FLEX_FG_2 = '#6E7B8A' // 「大会オープンチャット」・パスワード文字
const FLEX_SEP = '#E7EBF0' // 区切り線
const FLEX_BTN_BG = '#2B4E8C' // ボタン背景
const FLEX_PW_BG = '#F4F6F9' // パスワード行の背景

/**
 * 保存済みオープンチャット行から Flex Message を1通組み立てる。
 *
 * ★rows は呼び出し側が `ORDER BY sort_order, id` で並べて渡すこと。この関数は
 * 一切並べ替えない (AC-52: 大会詳細の並び順と Flex のボタン順を一致させる契約。
 * ローカル再ソートは禁止)。
 *
 * ★0件で呼ばない前提。呼び出し側は保存済み行が1件以上あるときだけこの関数を
 * 呼ぶこと (この関数自身は0件をガードしない — ボタン0個の空バブルになる)。
 */
export function buildOpenChatFlexMessage(
  rows: OpenChatFlexRow[],
  tournamentName: string,
): OpenChatFlexMessage {
  const altText = truncateToUtf16Units(
    `オープンチャットのご案内／${tournamentName}`,
    ALT_TEXT_MAX,
  )

  // ボタン (uri アクション) を縦一列に並べる。design-spec: carousel は
  // スワイプしない人が他の級・他の部に気づかないため不採用、5件でも
  // バブル1つに収める。パスワードがある行だけ、そのボタンの直後に
  // (＝直下に) パスワード行を差し込む。
  const rowContents: Record<string, unknown>[] = rows.flatMap((row) => {
    const items: Record<string, unknown>[] = [
      {
        type: 'button',
        style: 'primary',
        height: 'sm',
        color: FLEX_BTN_BG,
        // style: 'primary' はボタン文字色が自動的に白 (#FFFFFF) になるため
        // 個別に文字色を指定する必要は無い。
        action: { type: 'uri', label: row.label, uri: row.url },
      },
    ]
    if (row.password) {
      items.push({
        type: 'box',
        layout: 'vertical',
        backgroundColor: FLEX_PW_BG,
        cornerRadius: 'sm',
        paddingAll: '6px',
        margin: 'xs',
        contents: [
          {
            type: 'text',
            text: `パスワード: ${row.password}`,
            size: 'xs',
            color: FLEX_FG_2,
            align: 'center',
            wrap: true,
            // LINE Flex の text/box コンポーネントには等幅フォントを指定する
            // プロパティが存在しない (fontFamily 相当が仕様に無い)。design-spec
            // のモックは表示上モノスペースにしているが、Flex JSON では色と
            // 背景だけを忠実に再現し、フォントは LINE アプリ標準のまま送る。
          },
        ],
      })
    }
    return items
  })

  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          // バブル内のテキストは「大会オープンチャット」と大会名の2つだけ。
          // 当初あった説明文・注意書きはユーザー判断で全削除された
          // (design-spec §意図と、採用／不採用の理由「LINE Flex バブル」/
          // requirements.md §3.2.5)。ボタンを見れば用途は自明で、文が増える
          // ほどボタンが下へ押し出されるため、ここに文言を足さないこと。
          {
            type: 'text',
            text: '大会オープンチャット',
            size: 'xxs',
            weight: 'bold',
            color: FLEX_FG_2,
          },
          {
            type: 'text',
            text: tournamentName,
            size: 'md',
            weight: 'bold',
            color: FLEX_FG,
            wrap: true,
            margin: 'xs',
          },
          { type: 'separator', margin: 'md', color: FLEX_SEP },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: rowContents,
          },
        ],
      },
    },
  }
}
