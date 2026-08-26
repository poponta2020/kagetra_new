import 'server-only'
import { and, eq } from 'drizzle-orm'
import { eventAttendances, users } from '@kagetra/shared/schema'
import type { Grade, UserRole } from '@kagetra/shared/types'
import { db } from '@/lib/db'
import { eligibleUsersWhere } from './eligible-users'

/**
 * admin-attendance-edit: 編集画面の「参加者」セクション用のローダー。
 *
 * ★列は id / name / grade / role の4つだけを取る。このデータは client
 * component（`AttendanceEditSection`）へ渡るため **RSC payload としてブラウザへ
 * 直列化される**。`with: { user: true }` にすると PII 列（メール・LINE ID・
 * 全日協番号など）が丸ごと管理者のブラウザへ載る（`/events/[id]` の
 * `RosterSection` で同種の漏れを踏んでいる）。
 */
export interface AttendanceEditUser {
  id: string
  name: string | null
  grade: Grade | null
  role: UserRole
}

export interface AttendanceEditAttendee extends AttendanceEditUser {
  /**
   * 「詳細ページ・ホームの参加者欄には出ない行」であることの印。
   * 対象級外だけでなく `isInvited=false`（退会等）の旧データ行もここに立つ
   * —— 表示側の除外条件（`eligibleUsersWhere`）と同じ集合の裏返しなので、
   * 定義が2本に割れない。
   */
  outOfScope: boolean
}

export interface AttendanceEditData {
  /** `attend=true` の**全行**（対象外の stale 行も落とさない。AC-8）。 */
  attendees: AttendanceEditAttendee[]
  /** 追加候補 = 対象ユーザー − 既に参加している人（AC-8）。 */
  candidates: AttendanceEditUser[]
}

/** 級の昇順（A < B < ... < E）。級未設定は末尾。詳細ページの参加者欄と同じ規則。 */
function byGradeThenName(a: AttendanceEditUser, b: AttendanceEditUser): number {
  const g = (a.grade ?? 'Z').localeCompare(b.grade ?? 'Z')
  return g !== 0 ? g : (a.name ?? '').localeCompare(b.name ?? '', 'ja')
}

export async function loadAttendanceEditData(
  eventId: number,
  eligibleGrades: readonly Grade[] | null | undefined,
): Promise<AttendanceEditData> {
  const [attendingRows, eligibleRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        grade: users.grade,
        role: users.role,
      })
      .from(eventAttendances)
      .innerJoin(users, eq(users.id, eventAttendances.userId))
      .where(
        and(eq(eventAttendances.eventId, eventId), eq(eventAttendances.attend, true)),
      ),
    db.query.users.findMany({
      columns: { id: true, name: true, grade: true, role: true },
      where: eligibleUsersWhere(eligibleGrades),
    }),
  ])

  const eligibleIdSet = new Set(eligibleRows.map((u) => u.id))
  const attendingIdSet = new Set(attendingRows.map((u) => u.id))

  return {
    attendees: attendingRows
      .map((u) => ({ ...u, outOfScope: !eligibleIdSet.has(u.id) }))
      .sort(byGradeThenName),
    candidates: eligibleRows
      .filter((u) => !attendingIdSet.has(u.id))
      .sort(byGradeThenName),
  }
}
