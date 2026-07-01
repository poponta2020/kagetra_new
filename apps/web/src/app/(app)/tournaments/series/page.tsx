import { SectionTabs } from '@/components/stats/section-tabs'
import { Card } from '@/components/ui'

/**
 * /tournaments/series — ② 大会結果の「大会別ビュー」（シリーズ一覧）。
 * 年別（`/tournaments`）とトグルで切り替わる同一セクションのトップなので
 * SectionTabs を出す（大会結果が active）。senseki-stats PR-5 で実装予定。
 */
export default function TournamentSeriesListPage() {
  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-4 p-4">
        <h1 className="font-display text-xl font-bold text-ink">
          大会結果（大会別）
        </h1>
        <Card>
          <p className="py-10 text-center text-sm text-ink-meta">
            シリーズ一覧は準備中です（PR-5 で実装）。
          </p>
        </Card>
      </div>
    </div>
  )
}
