import Link from 'next/link'
import { Card } from '@/components/ui'

/**
 * /tournaments/[id] — 大会詳細（入賞者タブ＋級クロス表）。プッシュ表示のため
 * SectionTabs は出さず戻る導線のみ（requirements §3.1）。senseki-stats PR-5 で実装予定。
 */
export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="flex flex-col gap-4 p-4">
      <Link href="/tournaments" className="text-sm text-brand">
        ‹ 大会結果へ戻る
      </Link>
      <h1 className="font-display text-xl font-bold text-ink">大会詳細</h1>
      <Card>
        <p className="py-10 text-center text-sm text-ink-meta">
          大会 #{id} の詳細（入賞者＋級クロス表）は準備中です（PR-5 で実装）。
        </p>
      </Card>
    </div>
  )
}
