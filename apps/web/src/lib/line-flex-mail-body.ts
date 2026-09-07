import {
  ALT_TEXT_MAX,
  truncateToUtf16Units,
  type LineFlexMessage,
} from '@/lib/line-flex-attachment'

/**
 * メール本文カードの Flex Message (mail-body-as-image 2026-09 改修)。
 *
 * 本文を A4 JPEG に描画して 1〜30 通の image message で送っていたのをやめ、
 * 「件名だけを載せた 1 枚のカード」に畳む。カードのタップで公開ページ
 * `/mail-share/[token]` を開き、そこで本文全文をテキストとして読ませる。
 * URL は uri アクションに隠れるのでトークには一切出ない（添付カードと同じ設計）。
 *
 * このモジュールは添付カード (line-flex-attachment.ts) と同じく pure
 * (node builtins にも依存しない)。sharp / libreoffice 等の重依存を持ち込まない。
 */

/** 件名が空・NULL のときの見出し（会員向け /mail/[id] と同じ表記）。 */
const NO_SUBJECT_LABEL = '(件名なし)'

/** 訂正版マーカー。件名の先頭に付く（配信単位の情報。全文ページには出さない）。 */
const CORRECTION_PREFIX = '【訂正】'

/** バッジ背景 = ブランド色 藤（globals.css の `--kg-brand`）。Flex JSON はリテラルしか持てない。 */
const BADGE_COLOR = '#534286'

export interface BuildMailBodyFlexArgs {
  /** メール件名 (`mail_messages.subject`)。空・NULL なら `(件名なし)`。 */
  subject: string | null | undefined
  /** タップで開く公開全文ページの URL (https 必須 — LINE 仕様)。 */
  url: string
  /** 訂正版配信か (`event_broadcast_messages.is_correction`)。 */
  isCorrection: boolean
}

/**
 * メール本文 1 通分のカード (Flex bubble) を組み立てる。
 * 見た目: [✉ バッジ] 件名 / タップして全文を見る。
 */
export function buildMailBodyFlexMessage(
  args: BuildMailBodyFlexArgs,
): LineFlexMessage {
  const subject = args.subject?.trim() || NO_SUBJECT_LABEL
  const title = args.isCorrection ? `${CORRECTION_PREFIX}${subject}` : subject
  const altText = truncateToUtf16Units(`📧 ${title}`, ALT_TEXT_MAX)

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
        action: { type: 'uri', label: '全文を見る', uri: args.url },
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            width: '48px',
            height: '48px',
            cornerRadius: '10px',
            backgroundColor: BADGE_COLOR,
            justifyContent: 'center',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: '✉',
                color: '#FFFFFF',
                size: 'lg',
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
            contents: [
              {
                type: 'text',
                text: title,
                size: 'sm',
                color: '#111111',
                weight: 'bold',
                wrap: true,
                // 長い件名でカードが縦に伸びないよう 3 行で切る。全文は
                // altText と全文ページに残るので情報は失われない。
                maxLines: 3,
              },
              {
                type: 'text',
                text: 'タップして全文を見る',
                size: 'xxs',
                color: '#999999',
              },
            ],
          },
        ],
      },
    },
  }
}
