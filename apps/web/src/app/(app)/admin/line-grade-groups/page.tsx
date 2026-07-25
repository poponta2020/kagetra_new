import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Card } from '@/components/ui'
import { lineChannels, lineGradeGroupBindings } from '@kagetra/shared/schema'
import { GradeGroupList, type GradeGroupRow } from './GradeGroupList'
import { generateGradeInviteCode, revokeGradeBinding } from './actions'
import { GRADES } from './grades'

export const dynamic = 'force-dynamic'

export default async function LineGradeGroupsAdminPage() {
  const session = await auth()
  // AC-22: この画面は admin のみ。vice_admin も含め非 admin は弾く
  // (Server Action と同じ厳格ガード。requireStrictAdminSession() を参照)。
  if (session?.user?.role !== 'admin') {
    redirect('/403')
  }

  const bindingRows = await db
    .select({
      grade: lineGradeGroupBindings.grade,
      status: lineGradeGroupBindings.status,
      lineGroupId: lineGradeGroupBindings.lineGroupId,
      linkedAt: lineGradeGroupBindings.linkedAt,
      botId: lineChannels.botId,
      note: lineChannels.note,
    })
    .from(lineGradeGroupBindings)
    .leftJoin(lineChannels, eq(lineChannels.id, lineGradeGroupBindings.lineChannelId))

  const byGrade = new Map(bindingRows.map((row) => [row.grade, row]))

  // A〜E の 5 行固定。行が無い級 (未紐付け) と revoked (解除済み = 表示上は
  // 未紐付けと同じ「招待コード発行」導線に戻る) をどちらも 'unbound' に
  // まとめる。
  const rows: GradeGroupRow[] = GRADES.map((grade) => {
    const row = byGrade.get(grade)
    if (!row || row.status === 'revoked') {
      return {
        grade,
        status: 'unbound',
        botLabel: null,
        lineGroupIdTail: null,
        linkedAt: null,
      }
    }
    return {
      grade,
      status: row.status,
      botLabel: row.note ?? row.botId ?? null,
      lineGroupIdTail: row.lineGroupId ? row.lineGroupId.slice(-8) : null,
      linkedAt: row.linkedAt,
    }
  })

  return (
    <div className="flex flex-col gap-4 p-4">
      <header>
        <h1 className="text-base font-semibold text-ink-1">級 LINE グループ管理</h1>
        <p className="text-[11px] text-ink-meta mt-1">
          A〜E 級ごとに常設の LINE グループを紐付けます。招待コードを発行し、Bot をグループへ招待してコードを発言すると紐付けが完了します。
        </p>
      </header>

      <Card className="overflow-hidden">
        <GradeGroupList
          rows={rows}
          generateInviteCodeAction={generateGradeInviteCode}
          revokeBindingAction={revokeGradeBinding}
        />
      </Card>
    </div>
  )
}
