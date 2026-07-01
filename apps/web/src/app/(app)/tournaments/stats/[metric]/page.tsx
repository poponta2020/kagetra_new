import Link from 'next/link'
import { Card } from '@/components/ui'

/**
 * /tournaments/stats/[metric] — 大会統計の図詳細（級別比較スモールマルチプル）。
 * metric = score / competitors / participations。プッシュ表示のため SectionTabs は
 * 出さず戻る導線のみ。senseki-stats PR-4 で実装予定。
 */
export default async function StatsDetailPage({
  params,
}: {
  params: Promise<{ metric: string }>
}) {
  const { metric } = await params
  return (
    <div className="flex flex-col gap-4 p-4">
      <Link href="/tournaments/stats" className="text-sm text-brand">
        ‹ 大会統計へ戻る
      </Link>
      <h1 className="font-display text-xl font-bold text-ink">
        級別比較（{metric}）
      </h1>
      <Card>
        <p className="py-10 text-center text-sm text-ink-meta">
          「{metric}」の級別比較は準備中です（PR-4 で実装）。
        </p>
      </Card>
    </div>
  )
}
