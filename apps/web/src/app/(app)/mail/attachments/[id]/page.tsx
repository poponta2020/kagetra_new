import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailAttachments } from '@kagetra/shared/schema'
import {
  detectPreviewKind,
  getCachedPreviewMeta,
  renderAttachmentPreview,
  type AttachmentPreviewMeta,
} from '@/lib/attachment-preview'
import { pickAttachmentIcon } from '../../../admin/mail-inbox/components/AttachmentList'

/**
 * /mail/attachments/[id] — 会員向け添付ビューア。
 *
 * 管理者ビューア (`/admin/mail-inbox/attachments/[id]`) の複製。共通化はせず
 * 独立実装にする（管理者側は Non-goal で一切変更しない方針のため）。差分は
 * 認可（role を見ずログイン済みかのみ）・URL（会員ルート）・`?from=` の許可
 * プレフィックス（`/mail`）の3点のみで、表示ロジックは同一。
 *
 * 添付チップから同一ウィンドウで遷移してくる。バイナリルートへ直接遷移する
 * 動線は iOS ホーム画面 PWA で「QuickLook 表示 → 戻る UI が一切ない」行き止
 * まりになる (same-origin は manifest scope 内なので target="_blank" でも
 * 同一 WebView を遷移する)。ヘッダの ✕ はチップが `?from=` で明示した元の
 * 画面 (メール一覧 / メール詳細) へ Link replace で戻る。history back /
 * window.history.length での推測は deep link やコールドスタートで誤動作
 * するため使わない (管理者ビューアと同じ判断)。
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

export default async function MemberAttachmentViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  // 正規な 10 進正整数だけを受ける。`Number('1e5')` は 100000、`Number('0x10')` は
  // 16 を返すため、素の Number 変換だと URL とは別の添付を開いてしまう。API ルート
  // （`api/mail/attachments/[id]`）と同じ境界に揃える。
  if (!/^[1-9]\d*$/.test(id)) notFound()
  const attachmentId = Number.parseInt(id, 10)
  // `mail_attachments.id` は serial（int4）。上限超過はその列にあり得ないが、
  // そのままクエリに載せると pg が範囲外エラーを投げて 500 になるので境界で 404 に倒す。
  if (attachmentId > 2147483647) notFound()

  // ✕ の戻り先。チップが付与した from を使うが、URL は共有・改変できるので
  // `/mail` 配下のパスだけ許可し、それ以外は一覧に倒す。`startsWith('/mail')`
  // だけだと `//mail.evil.example` のようなプロトコル相対 URL が通ってしまう
  // ため、`//` 始まりも明示的に弾く（オープンリダイレクト対策）。
  const { from } = await searchParams
  const fromParam = typeof from === 'string' ? from : undefined
  // 判定はパスセグメント境界で行う。単なる `startsWith('/mail')` だと
  // `/mailbox` や `/mail-archive` のような別パスまで通ってしまい、AC-26 の
  // 「`/mail` 配下でなければ `/mail` に倒す」を満たさない。この形なら
  // `//evil.example` も自動的に弾ける（`/mail` で始まらないため）。
  const closeHref =
    fromParam &&
    (fromParam === '/mail' ||
      fromParam.startsWith('/mail/') ||
      fromParam.startsWith('/mail?'))
      ? fromParam
      : '/mail'

  // 権限判定は role を見ずログイン済みかのみ (会員は完全な読み取り専用)。
  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')

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
  const binaryUrl = `/api/mail/attachments/${row.id}`
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
        // ここで例外を外へ投げると 500 になる (AC-22)。
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
      className="text-xs text-brand-fg underline"
    >
      元ファイルをダウンロード
    </a>
  )

  const fallbackCard = (message: string) => (
    <div className="m-4 flex flex-col items-center gap-[7px] rounded-lg border border-border-soft bg-surface px-[18px] py-8 text-center">
      <span className="text-[28px]">{icon}</span>
      <span className="text-[13px] text-ink-2">{message}</span>
      <span className="text-[10px] leading-[1.55] text-ink-meta">
        iPhone のアプリ内からは元ファイルを開けないことがあります。必要な場合は
        PC からダウンロードしてください。
      </span>
      {downloadLink}
    </div>
  )

  let body: React.ReactNode
  if (kind === 'image') {
    body = (
      // 認証つき動的ルートの生バイト表示。next/image の optimizer は
      // Cookie なしでサーバー側 fetch するため 401 になり使えない。
      // 背景は意図的に純白（和紙トークンにしない）。透過 PNG や紙面より
      // 小さい画像で、白い紙面の周囲だけ和紙色が覗くのを避けるため。
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={binaryUrl}
        alt={row.filename}
        className="w-full rounded-md border border-border-soft bg-white"
      />
    )
  } else if (kind === 'text') {
    const capped = (textBody ?? '').slice(0, TEXT_PREVIEW_CHAR_LIMIT)
    body = (
      <div className="p-2">
        <pre className="whitespace-pre-wrap break-words text-xs text-ink">
          {capped}
        </pre>
        {(textBody ?? '').length > TEXT_PREVIEW_CHAR_LIMIT && (
          <div className="pt-1 text-xs text-ink-meta">
            長すぎるため先頭のみ表示しています。全文は元ファイルを参照してください。
          </div>
        )}
      </div>
    )
  } else if (kind === 'document' && docMeta && docMeta.pageCount > 0) {
    body = (
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: docMeta.pageCount }, (_, i) => (
          // 認証つき動的ルートの生バイト表示・純白背景とも上の image kind と同じ理由。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i + 1}
            src={`/api/mail/attachments/${row.id}/preview/${i + 1}`}
            alt={`${row.filename} ${i + 1}ページ目`}
            loading={i < 2 ? undefined : 'lazy'}
            className="w-full rounded-md border border-border-soft bg-white"
          />
        ))}
        {docMeta.truncated && (
          <div className="p-2 text-center text-xs text-ink-meta">
            ページ数が多いため途中まで表示しています。続きは元ファイルを参照してください。
          </div>
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
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-base leading-none text-ink-2 hover:bg-surface-alt"
        >
          ✕
        </Link>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
          <span className="mr-1">{icon}</span>
          {row.filename}
        </span>
        <a
          href={binaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-1.5 text-[10px] text-brand-fg underline"
        >
          元ファイル
        </a>
      </div>
      {body}
    </div>
  )
}
