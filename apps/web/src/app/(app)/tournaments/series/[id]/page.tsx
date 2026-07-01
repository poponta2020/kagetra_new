import Link from 'next/link'
import { Card } from '@/components/ui'

/**
 * /tournaments/series/[id] — シリーズ詳細（回次一覧＋参加者数推移）。プッシュ表示
 * のため SectionTabs は出さず戻る導線のみ。senseki-stats PR-5 で実装予定。
 */
export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="flex flex-col gap-4 p-4">
      <Link href="/tournaments/series" className="text-sm text-brand">
        ‹ 大会別一覧へ戻る
      </Link>
      <h1 className="font-display text-xl font-bold text-ink">シリーズ詳細</h1>
      <Card>
        <p className="py-10 text-center text-sm text-ink-meta">
          シリーズ #{id} の詳細（回次一覧＋参加者数推移）は準備中です（PR-5
          で実装）。
        </p>
      </Card>
    </div>
  )
}
