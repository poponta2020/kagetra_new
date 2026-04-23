import { auth } from '@/auth'
import { Card, Pill, SectionLabel } from '@/components/ui'
import { roleLabel } from '@/lib/role-label'

export default async function DashboardPage() {
  const session = await auth()
  const name = session?.user?.name ?? 'ゲスト'
  const { label, tone } = roleLabel(session?.user?.role)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold text-ink">
        ようこそ、{name}さん
      </h1>

      <div>
        <SectionLabel>プロフィール</SectionLabel>
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-meta">権限</span>
            <Pill tone={tone}>{label}</Pill>
          </div>
        </Card>
      </div>

      <div>
        <SectionLabel>今後の予定</SectionLabel>
        <Card>
          <p className="text-sm text-ink-meta">
            今後の予定はまもなく表示されます
          </p>
        </Card>
      </div>
    </div>
  )
}
