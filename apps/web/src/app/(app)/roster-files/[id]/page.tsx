import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailAttachments } from '@kagetra/shared/schema'
import { Card } from '@/components/ui'
import { formatFlowDate } from '@/lib/event-date'
import {
  detectPreviewKind,
  getCachedPreviewMeta,
  renderAttachmentPreview,
  type AttachmentPreviewMeta,
} from '@/lib/attachment-preview'
import {
  loadAdoptedRosterFile,
  parseCanonicalRosterFileId,
} from '@/lib/roster-file-access'
import { OpenSaveButton } from '@/components/attachment/OpenSaveButton'

/**
 * /roster-files/[id] — roster-file-adoption タスク3: 会員向け名簿ファイル
 * ビューア。ログイン済みの全会員が対象（role では絞らない）。`:id` は
 * `tournament_entry_roster_files.id`（大会詳細の RosterSection が
 * `/roster-files/{id}` で契約するリンク先）。
 *
 * 認可は `loadAdoptedRosterFile` に一本化してある。採用済みでなければ
 * （未採用・解除済み・添付削除いずれでも）`notFound()` — 管理者向け
 * `/admin/mail-inbox/attachments/[id]` とは完全に別経路で、あちらは
 * 一切変更していない。
 *
 * ★このページへ渡してよい情報はファイル名・採用種別・発表日・ビューア/
 * ダウンロード導線だけ（要件 §3.2.3・§3.2.5）。取込元メール ID・採用者・
 * メモは `loadAdoptedRosterFile` がそもそも select しないので、ここに
 * 変数として存在しえない。
 *
 * 表示方式は既存の管理者向けビューア (/admin/mail-inbox/attachments/[id])
 * と同じ振り分け（contentType + 拡張子）:
 *   - PDF / Word / PowerPoint → libreoffice + pdftoppm でページ JPEG 化して
 *     <img> 縦積み
 *   - 表計算 (xls/xlsx/xlsm) → ページ画像を作らず案内カードのみ。名簿は実
 *     データ上ほぼ Excel なので、この画面は事実上いつもこの姿になる
 *   - ラスタ画像   → バイナリ route をそのまま <img> 表示
 *   - text/csv     → bytea を UTF-8 で <pre> 表示
 *   - その他 (zip 等、detectPreviewKind が 'none') → ページ画像を出さず
 *     案内カードだけ（AC-8 の「閲覧できる」はこの場合「ビューアページが 200
 *     で開く・保存の導線が出る」ことを指す）
 *
 * この画面は他2つのビューアと違い sticky ヘッダ（✕・ファイル名）を持たない
 * ため、OS へファイルを渡す「開く・保存」はタイトルブロックの直下に置く
 * （スクロールせずに必ず見える位置）。
 */
export const dynamic = 'force-dynamic'

/** <pre> に流すテキストの上限。巨大 CSV でページを殺さないための保険。 */
const TEXT_PREVIEW_CHAR_LIMIT = 100_000

const ROSTER_TYPE_LABEL: Record<'applicant' | 'confirmed', string> = {
  applicant: '申込名簿',
  confirmed: '確定名簿',
}

export default async function RosterFileViewerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const rosterFileId = parseCanonicalRosterFileId(id)
  if (rosterFileId === null) notFound()

  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')

  const adopted = await loadAdoptedRosterFile(rosterFileId)
  if (!adopted) notFound()

  const { attachment } = adopted
  const kind = detectPreviewKind(attachment.contentType, attachment.filename)
  const binaryUrl = `/api/roster-files/${adopted.id}`

  let docMeta: AttachmentPreviewMeta | null = null
  if (kind === 'document') {
    docMeta = getCachedPreviewMeta(attachment.id)
    if (!docMeta) {
      const full = await db.query.mailAttachments.findFirst({
        where: eq(mailAttachments.id, attachment.id),
        columns: { id: true, filename: true, contentType: true, data: true },
      })
      if (!full) notFound()
      try {
        docMeta = await renderAttachmentPreview(full)
      } catch {
        // 変換失敗 (壊れたファイル / libreoffice 不在) は docMeta=null の
        // ままにして、ダウンロード導線つきカードに倒す。
      }
    }
  }

  let textBody: string | null = null
  if (kind === 'text') {
    const full = await db.query.mailAttachments.findFirst({
      where: eq(mailAttachments.id, attachment.id),
      columns: { data: true },
    })
    if (!full) notFound()
    textBody = full.data.toString('utf8')
  }

  /**
   * プレビューを出さない種別の案内カード。ボタンはカード内ではなくタイトル
   * 直下にあるので、文言は「上のボタンから」と受ける。かつてここにあった
   * 但し書き「iPhone のアプリ内からは元ファイルを開けないことがあります。
   * 必要な場合は PC からダウンロードしてください。」は削除した — 共有シート
   * 経由で端末へ渡せるようになった今、残すと事実と食い違う案内になる。
   */
  const noticeCard = (icon: string, title: string, description: string) => (
    <Card>
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="text-2xl">{icon}</span>
        <span className="text-base font-bold text-ink">{title}</span>
        <span className="max-w-[292px] text-xs leading-normal text-ink-meta">
          {description}
        </span>
      </div>
    </Card>
  )

  let body: React.ReactNode
  if (kind === 'image') {
    body = (
      // 認証つき動的ルートの生バイト表示。next/image の optimizer は
      // Cookie なしでサーバー側 fetch するため 401 になり使えない。
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={binaryUrl}
        alt={attachment.filename}
        className="w-full rounded-lg border border-border-soft bg-white"
      />
    )
  } else if (kind === 'text') {
    const capped = (textBody ?? '').slice(0, TEXT_PREVIEW_CHAR_LIMIT)
    body = (
      <Card>
        <pre className="whitespace-pre-wrap break-words p-1 text-xs text-ink">
          {capped}
        </pre>
        {(textBody ?? '').length > TEXT_PREVIEW_CHAR_LIMIT && (
          <div className="px-1 pb-1 text-xs text-ink-meta">
            長すぎるため先頭のみ表示しています。全文は元ファイルを参照してください。
          </div>
        )}
      </Card>
    )
  } else if (kind === 'document' && docMeta && docMeta.pageCount > 0) {
    body = (
      <div className="flex flex-col gap-2">
        {Array.from({ length: docMeta.pageCount }, (_, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i + 1}
            src={`${binaryUrl}/preview/${i + 1}`}
            alt={`${attachment.filename} ${i + 1}ページ目`}
            loading={i < 2 ? undefined : 'lazy'}
            className="w-full rounded-lg border border-border-soft bg-white"
          />
        ))}
        {docMeta.truncated && (
          <Card>
            <div className="py-2 text-center text-xs text-ink-meta">
              ページ数が多いため途中まで表示しています。続きは元ファイルを参照してください。
            </div>
          </Card>
        )}
      </div>
    )
  } else if (kind === 'spreadsheet') {
    // 「できない」ではなく「しない」。Excel は表計算アプリで開くのが正しい。
    body = noticeCard(
      '📊',
      'Excel ファイルです',
      'アプリの中では表示しません。上のボタンから Excel などの表計算アプリで開くか、端末に保存してください。',
    )
  } else if (kind === 'document') {
    // 変換失敗、または変換は成功したが 0 ページ (空 PDF 等)。
    body = noticeCard(
      '📎',
      'このファイルのプレビューを生成できませんでした',
      '上のボタンから端末に保存するか、対応するアプリで開いてください。',
    )
  } else {
    body = noticeCard(
      '📎',
      'アプリ内では表示できない形式です',
      '上のボタンから端末に保存するか、対応するアプリで開いてください。',
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold text-brand">
          {ROSTER_TYPE_LABEL[adopted.rosterType]}（原本ファイル）
        </p>
        <h1 className="break-words font-display text-lg font-bold text-ink">
          {attachment.filename}
        </h1>
        {adopted.publishedAt && (
          <p className="text-xs text-ink-meta">
            発表 {formatFlowDate(adopted.publishedAt)}
          </p>
        )}
      </div>
      <OpenSaveButton
        href={binaryUrl}
        filename={attachment.filename}
        variant="block"
      />
      {body}
    </div>
  )
}
