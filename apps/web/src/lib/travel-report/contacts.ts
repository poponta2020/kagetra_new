import type { UserRole } from '@kagetra/shared'

/**
 * travel-report: 「遠征先 連絡者」「留守連絡先」の既定値を決める**純関数**
 * （requirements R9・AC-25）。S6 でいつでも修正できる補助であり、外した候補が
 * 出せなくなるわけではない。
 */

export interface ContactCandidate {
  userId: string
  /** 届に出す氏名（`rosterFullName` の結果）。 */
  name: string
  phone: string | null
  role: UserRole
  isCircleLeader: boolean
  isTravelReportSubmitter: boolean
  isTreasurer: boolean
  /** `YYYY-MM-DD`。最年長フォールバックに使う。 */
  birthDate: string | null
}

/** 役職の優先順（R9）: サークル長 → 管理者 → 副管理者 → 副連絡責任者 → 会計。 */
const ROLE_PRIORITY: readonly ((c: ContactCandidate) => boolean)[] = [
  (c) => c.isCircleLeader,
  (c) => c.role === 'admin',
  (c) => c.role === 'vice_admin',
  (c) => c.isTravelReportSubmitter,
  (c) => c.isTreasurer,
]

const byUserId = (a: ContactCandidate, b: ContactCandidate) => a.userId.localeCompare(b.userId)

/**
 * 遠征先 連絡者の既定（R9）。
 *
 * そのファイルの**出場者のうち**、役職の優先順で最初に見つかった1人。
 * 誰も該当しなければ**生年月日が最も早い人**（同日なら全員。運用上2人までを想定）。
 * 生年月日が誰にも無ければ userId 順の先頭1人。出場者が0人なら空配列。
 */
export function pickDestinationContacts(
  participants: readonly ContactCandidate[],
): ContactCandidate[] {
  if (participants.length === 0) return []

  for (const matches of ROLE_PRIORITY) {
    const hit = participants.filter(matches).sort(byUserId)
    // 同じ役職に複数いても連絡者は1人（先に見つかった順＝userId 順の先頭）。
    if (hit.length > 0) return [hit[0]]
  }

  const withBirth = participants.filter((c) => c.birthDate !== null)
  if (withBirth.length === 0) return [[...participants].sort(byUserId)[0]]
  const earliest = withBirth.reduce((min, c) => ((c.birthDate ?? '') < (min.birthDate ?? '') ? c : min))
  // 同じ生年月日が並んだら全員出す（R9）。
  return withBirth.filter((c) => c.birthDate === earliest.birthDate).sort(byUserId)
}

export interface HomeContactInput {
  /** サークル長。未設定なら `null`。 */
  circleLeader: ContactCandidate | null
  /** このファイルの出場者の userId。 */
  participantIds: ReadonlySet<string>
  /** 会内の副連絡責任者すべて（出場者かどうかは問わない）。 */
  submitters: readonly ContactCandidate[]
}

/**
 * 留守連絡先の既定（R9・AC-25）。
 *
 * - サークル長が**出場しない**なら サークル長
 * - サークル長が出場者に含まれるなら **出場しない副連絡責任者**（複数なら userId 順の先頭）
 * - それもいなければ空（＝届の欄は空欄。R13 のとおり作成は成功する）
 *
 * ★サークル長が**未設定**のときも空にする。R9 の代替は「サークル長が出場者に
 * 含まれる」ときの規則としてだけ書かれているため、literal に従う。
 */
export function pickHomeContact(input: HomeContactInput): ContactCandidate | null {
  const leader = input.circleLeader
  if (!leader) return null
  if (!input.participantIds.has(leader.userId)) return leader
  const absentSubmitters = input.submitters
    .filter((s) => !input.participantIds.has(s.userId))
    .sort(byUserId)
  return absentSubmitters[0] ?? null
}
