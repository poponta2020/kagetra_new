import { SectionTabs } from '@/components/stats/section-tabs'
import { Card } from '@/components/ui'

/**
 * /tournaments/stats — ④ 大会統計・全体サマリー（統計）。senseki-stats PR-4 で
 * 実装予定。PR-2（ナビ）では 4 セクションシェル配下のプレースホルダ scaffold。
 */
export default function TournamentStatsPage() {
  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-4 p-4">
        <h1 className="font-display text-xl font-bold text-ink">大会統計</h1>
        <Card>
          <p className="py-10 text-center text-sm text-ink-meta">
            大会統計（全体サマリー）は準備中です（PR-4 で実装）。
          </p>
        </Card>
      </div>
    </div>
  )
}
