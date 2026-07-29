/**
 * 名簿ファイルビューアの初回表示は libreoffice / pdftoppm のページ画像生成を
 * サーバー側で待つため数秒かかりうる（2回目以降は image-cache ヒットで即）。
 * 管理者向け /admin/mail-inbox/attachments/[id]/loading.tsx と同じ理由。
 */
export default function RosterFileViewerLoading() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-sm text-ink-meta">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      プレビューを準備しています…
    </div>
  )
}
