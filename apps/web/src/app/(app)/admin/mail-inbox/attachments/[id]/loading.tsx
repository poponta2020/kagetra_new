/**
 * 添付ビューアの初回表示は libreoffice / pdftoppm のページ画像生成を
 * サーバー側で待つため数秒かかりうる。その間の「タップしたのに何も
 * 起きない」を防ぐローディング表示 (2回目以降は image-cache ヒットで即)。
 */
export default function AttachmentViewerLoading() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-sm text-ink-meta">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      プレビューを準備しています…
    </div>
  )
}
