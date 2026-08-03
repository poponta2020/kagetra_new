/**
 * LINE 添付リンクの Flex Message 化 (line-attachment-flex-card)。
 *
 * 従来は「📎 ファイル名 + 署名 URL」の text 1 通で、長い署名 URL がそのまま
 * トークに露出していた。LINE のテキストメッセージは表示文字列と URL を分離
 * できない (ハイパーリンク非対応) ため、Flex Message のファイルカードに置き
 * 換えて URL をカードのタップアクション (uri) に隠す。Bot はネイティブの
 * ファイルメッセージを送信できない (受信専用) ので、Flex での模倣が唯一の手段。
 *
 * このモジュールは pure (node builtins にも依存しない)。webhook 経路の
 * line-broadcast-guidelines.ts からも import されるため、sharp / libreoffice
 * 等の重依存を絶対に持ち込まないこと。
 */

/** LINE Flex Message (push API にそのまま JSON 送信できる形)。 */
export interface LineFlexAttachmentMessage {
  type: 'flex'
  /** トーク一覧・プッシュ通知に表示される代替テキスト (LINE 仕様: 最大 400 字)。 */
  altText: string
  contents: Record<string, unknown>
}

const ALT_TEXT_MAX = 400

/**
 * altText を UTF-16 単位で上限まで切り詰める。`slice` を直接使うと、上限位置が
 * サロゲートペアの途中に当たったとき単独サロゲートが末尾に残り、通知・トーク
 * 一覧に不正な文字が出る (𠮟・𩸽 等の JIS 第3・第4水準漢字は人名・大会名で
 * 実際に使われる)。コードポイント境界で止めることでこれを防ぐ。
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

/** ファイル種別バッジ: アイコンボックスの背景色とラベル。 */
interface FileBadge {
  label: string
  color: string
}

const BADGE_EXCEL: FileBadge = { label: 'XLSX', color: '#217346' }
const BADGE_PDF: FileBadge = { label: 'PDF', color: '#D93025' }
const BADGE_WORD: FileBadge = { label: 'DOC', color: '#2B579A' }
const BADGE_OTHER_COLOR = '#64707D'

export function fileBadge(filename: string): FileBadge {
  const ext = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase() ?? ''
  switch (ext) {
    case 'xlsx':
    case 'xls':
    case 'xlsm':
    case 'csv':
      return { ...BADGE_EXCEL, label: ext.toUpperCase() }
    case 'pdf':
      return BADGE_PDF
    case 'doc':
    case 'docx':
      return { ...BADGE_WORD, label: ext.toUpperCase() }
    default:
      return {
        // 拡張子が無い/長すぎるときは汎用ラベル。48px ボックスに収まるのは
        // xxs bold でおよそ 5 文字まで。
        label: ext && ext.length <= 5 ? ext.toUpperCase() : 'FILE',
        color: BADGE_OTHER_COLOR,
      }
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export interface BuildAttachmentFlexArgs {
  filename: string
  /** タップで開く署名付きダウンロード URL (https 必須 — LINE 仕様)。 */
  url: string
  /** 添付のバイト数。不明なら省略 (サイズ行を出さない)。 */
  sizeBytes?: number
  /**
   * カードのファイル名上に出す小ラベル (例: '大会要綱')。altText にも
   * 『📎【ラベル】ファイル名』として含める。
   */
  tag?: string
}

/**
 * 添付 1 件を LINE のファイル添付風カード (Flex bubble) にする。
 * 見た目: [色付きバッジ] ファイル名 / サイズ・タップして開く。
 * カード全体が uri アクションで、URL はトークに一切表示されない。
 */
export function buildAttachmentFlexMessage(
  args: BuildAttachmentFlexArgs,
): LineFlexAttachmentMessage {
  const badge = fileBadge(args.filename)
  const size = args.sizeBytes != null ? formatFileSize(args.sizeBytes) : ''
  const subtitle = size ? `${size}・タップして開く` : 'タップして開く'
  const altText = truncateToUtf16Units(
    args.tag ? `📎【${args.tag}】${args.filename}` : `📎 ${args.filename}`,
    ALT_TEXT_MAX,
  )

  const infoContents: Record<string, unknown>[] = []
  if (args.tag) {
    infoContents.push({
      type: 'text',
      text: args.tag,
      size: 'xxs',
      color: '#6E7B8A',
      weight: 'bold',
    })
  }
  infoContents.push(
    {
      type: 'text',
      text: args.filename,
      size: 'sm',
      color: '#111111',
      weight: 'bold',
      wrap: true,
      // 極端に長いファイル名でカードが縦に伸びないよう 3 行で切る。
      // altText 側にフル名が残るので情報は失われない。
      maxLines: 3,
    },
    {
      type: 'text',
      text: subtitle,
      size: 'xxs',
      color: '#999999',
    },
  )

  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        alignItems: 'center',
        paddingAll: '16px',
        action: { type: 'uri', label: '開く', uri: args.url },
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            width: '48px',
            height: '48px',
            cornerRadius: '10px',
            backgroundColor: badge.color,
            justifyContent: 'center',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: badge.label,
                color: '#FFFFFF',
                size: 'xxs',
                weight: 'bold',
                align: 'center',
              },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            spacing: 'xs',
            contents: infoContents,
          },
        ],
      },
    },
  }
}
