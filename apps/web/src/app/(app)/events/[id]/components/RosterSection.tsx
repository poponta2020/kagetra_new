import { Card } from '@/components/ui'
import { RosterUploadForm } from './RosterUploadForm'

export interface RosterEntryView {
  id: number
  rawName: string
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  rawAffiliation: string | null
  status: 'applied' | 'confirmed' | 'carried_up' | 'carry_up_declined' | 'cancelled'
  userId: string | null
  user: { id: string; name: string | null } | null
}
export interface RosterView {
  id: number
  rosterType: 'applicant' | 'confirmed'
  publishedAt: string | null
  entries: RosterEntryView[]
}

const STATUS_LABEL: Record<RosterEntryView['status'], string> = {
  applied: '申込',
  confirmed: '確定',
  carried_up: '繰上',
  carry_up_declined: '繰上辞退',
  cancelled: '取消',
}

function RosterList({
  title,
  roster,
  currentUserId,
}: {
  title: string
  roster: RosterView | undefined
  currentUserId: string | null
}) {
  if (!roster || roster.entries.length === 0) {
    return (
      <div className="text-sm text-ink-meta">
        {title}: <span className="text-ink-2">未取込</span>
      </div>
    )
  }
  // 会員突合: user_id が張られた行（自会員）。
  const members = roster.entries.filter((e) => e.user)
  const youOnIt = currentUserId != null && roster.entries.some((e) => e.userId === currentUserId)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-bold text-ink">
          {title}（{roster.entries.length}名）
        </h3>
        {roster.publishedAt && (
          <span className="text-xs text-ink-meta">発行 {roster.publishedAt}</span>
        )}
      </div>
      {currentUserId != null && (
        <p className={`text-xs font-semibold ${youOnIt ? 'text-success-fg' : 'text-ink-meta'}`}>
          {youOnIt ? '★ あなたはこの名簿に掲載されています' : 'あなたはこの名簿に掲載されていません'}
        </p>
      )}
      <p className="text-xs text-ink-2">
        自会員 {members.length}名
        {members.length > 0 && `：${members.map((m) => m.user?.name ?? '(名前なし)').join('、')}`}
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {roster.entries.map((e) => (
          <li
            key={e.id}
            className={`flex flex-wrap items-center gap-x-2 px-3 py-1.5 text-sm ${
              e.user ? 'bg-success/5' : ''
            }`}
          >
            <span className="font-medium text-ink">{e.rawName}</span>
            {e.grade && <span className="text-xs text-ink-meta">{e.grade}級</span>}
            {e.rawAffiliation && <span className="text-xs text-ink-meta">{e.rawAffiliation}</span>}
            {e.user && (
              <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-semibold text-success-fg">
                会員
              </span>
            )}
            {e.status !== 'applied' && e.status !== 'confirmed' && (
              <span className="text-xs text-accent">{STATUS_LABEL[e.status]}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * tournament-entry-rosters PR-4: 大会詳細の名簿表示＋会員突合（判断3＝読み取り表示のみ）。
 * 確定名簿を上に、申込者名簿を下に。会員(entry.user)はハイライト。一般会員は自分の掲載状況も見える。
 * 管理者には Excel 取込フォームを出す。対象は個人戦のみ（団体戦では非表示）。
 */
export function RosterSection({
  eventId,
  kind,
  rosters,
  isAdmin,
  currentUserId,
}: {
  eventId: number
  kind: 'individual' | 'team'
  rosters: RosterView[]
  isAdmin: boolean
  currentUserId: string | null
}) {
  // 名簿は個人戦のみ（§3.2）。団体戦では出さない。管理者でも非表示。
  if (kind !== 'individual') return null
  // 名簿が一つも無く、かつ管理者でもない（取込導線も無い）なら何も出さない。
  if (rosters.length === 0 && !isAdmin) return null

  const applicant = rosters.find((r) => r.rosterType === 'applicant')
  const confirmed = rosters.find((r) => r.rosterType === 'confirmed')

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-base font-bold text-ink">名簿</h2>
        <RosterList title="確定名簿" roster={confirmed} currentUserId={currentUserId} />
        <RosterList title="申込者名簿" roster={applicant} currentUserId={currentUserId} />
        {isAdmin && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <p className="text-xs text-ink-meta">
              名簿 Excel を取り込みます（同じ種別を再取込すると置換されます。繰上りは確定名簿の再取込で更新）。
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <RosterUploadForm eventId={eventId} rosterType="confirmed" label="確定名簿" />
              <RosterUploadForm eventId={eventId} rosterType="applicant" label="申込者名簿" />
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
