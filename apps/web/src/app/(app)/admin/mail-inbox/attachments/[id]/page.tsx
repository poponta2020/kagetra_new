import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailAttachments } from '@kagetra/shared/schema'
import { Card } from '@/components/ui'
import {
  detectPreviewKind,
  getCachedPreviewMeta,
  renderAttachmentPreview,
  type AttachmentPreviewMeta,
} from '@/lib/attachment-preview'
import { pickAttachmentIcon } from '../../components/AttachmentList'

/**
 * /admin/mail-inbox/attachments/[id] — 添付ファイルのアプリ内ビューア。
 *
 * 添付チップから同一ウィンドウで遷移してくる。バイナリルートへ直接遷移する
 * 旧動線は iOS ホーム画面 PWA で「QuickLook 表示 → 戻る UI が一切ない」
 * 行き止まりになる (same-origin は manifest scope 内なので target="_blank"
 * でも同一 WebView を遷移する)。ヘッダの ✕ はチップが `?from=` で明示した
 * 元の画面 (受信箱一覧 / メール詳細 / draft 詳細) へ Link replace で戻る。
 * history back / window.history.length での推測は deep link やコールド
 * スタートで誤動作するため使わない (codex pr146 r1 should_fix)。
 *
 * 表示方式は contentType + 拡張子で振り分け:
 *   - PDF / Office → libreoffice + pdftoppm でページ JPEG 化して <img> 縦積み
 *     (iframe は iOS Safari が PDF を 1 ページ目しか描画しない既知制限で不採用)
 *   - ラスタ画像   → バイナリルートをそのまま <img> 表示
 *   - text/csv     → bytea を UTF-8 で <pre> 表示
 *   - その他 (zip 等) → プレビュー不可カード + ダウンロードリンク
 *
 * Server Component。ページ画像の生成 (初回数秒) は loading.tsx がスピナーで
 * 覆い、生成済みなら image-cache ヒットで即表示。
 */
export const dynamic = 'force-dynamic'

/** <pre> に流すテキストの上限。巨大 CSV でページを殺さないための保険。 */
const TEXT_PREVIEW_CHAR_LIMIT = 100_000

export default async function AttachmentViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const attachmentId = Number(id)
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) notFound()

  // ✕ の戻り先。チップ (AttachmentList) が付与した from を使うが、URL は
  // 共有・改変できるので受信箱配下のパスだけ許可し、それ以外は一覧に倒す
  // (先頭 `/admin/mail-inbox` 必須なので `//evil.example` も弾ける)。
  const { from } = await searchParams
  const fromParam = typeof from === 'string' ? from : undefined
  const closeHref = fromParam?.startsWith('/admin/mail-inbox')
    ? fromParam
    : '/admin/mail-inbox'

  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  // bytea を持たないメタ投影。pdf/office で preview が未キャッシュのとき、
  // text 表示のときだけ、必要になった時点で data 込みの行を引き直す。
  const row = await db.query.mailAttachments.findFirst({
    where: eq(mailAttachments.id, attachmentId),
    columns: {
      id: true,
      filename: true,
      contentType: true,
    },
  })
  if (!row) notFound()

  const kind = detectPreviewKind(row.contentType, row.filename)
  const binaryUrl = `/api/admin/mail/attachments/${row.id}`
  const icon = pickAttachmentIcon(row.contentType ?? '', row.filename)

  let docMeta: AttachmentPreviewMeta | null = null
  if (kind === 'document') {
    docMeta = getCachedPreviewMeta(row.id)
    if (!docMeta) {
      const full = await db.query.mailAttachments.findFirst({
        where: eq(mailAttachments.id, attachmentId),
        columns: { id: true, filename: true, contentType: true, data: true },
      })
      if (!full) notFound()
      try {
        docMeta = await renderAttachmentPreview(full)
      } catch {
        // 変換失敗 (壊れたファイル / libreoffice 不在の dev 環境) は
        // docMeta=null のままにして、ダウンロード導線つきカードに倒す。
      }
    }
  }

  let textBody: string | null = null
  if (kind === 'text') {
    const full = await db.query.mailAttachments.findFirst({
      where: eq(mailAttachments.id, attachmentId),
      columns: { data: true },
    })
    if (!full) notFound()
    textBody = full.data.toString('utf8')
  }

  const downloadLink = (
    <a
      href={binaryUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-brand-fg underline"
    >
      元ファイルをダウンロード
    </a>
  )

  const fallbackCard = (message: string) => (
    <Card>
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-ink-2">
        <span className="text-2xl">{icon}</span>
        <span>{message}</span>
        <span className="text-xs text-ink-meta">
          iPhone のアプリ内からは元ファイルを開けないことがあります。必要な場合は
          PC からダウンロードしてください。
        </span>
        {downloadLink}
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
        alt={row.filename}
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
          // 認証つき動的ルートの生バイト表示 (上の image kind と同じ理由)。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i + 1}
            src={`/api/admin/mail/attachments/${row.id}/preview/${i + 1}`}
            alt={`${row.filename} ${i + 1}ページ目`}
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
  } else if (kind === 'document') {
    // 変換失敗、または変換は成功したが 0 ページ (空 PDF 等)。
    body = fallbackCard('このファイルのプレビューを生成できませんでした。')
  } else {
    body = fallbackCard('このファイル形式はアプリ内でプレビューできません。')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        {/* replace: ビューアを履歴に残さないので、戻り先画面からの戻る操作が
            ビューアに巻き戻らない。 */}
        <Link
          replace
          href={closeHref}
          aria-label="閉じる"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl leading-none text-ink-2 hover:bg-surface-alt"
        >
          ✕
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          <span className="mr-1">{icon}</span>
          {row.filename}
        </span>
        <a
          href={binaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-2 text-xs text-brand-fg underline"
        >
          元ファイル
        </a>
      </div>
      {body}
    </div>
  )
}
