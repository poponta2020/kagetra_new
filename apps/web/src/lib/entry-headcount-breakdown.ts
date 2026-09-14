import type { GroupHeadcountFacts, HeadcountRoleHolder } from '@/lib/entry-headcount'
import type { MentionValue } from '@/lib/line-mention'

/**
 * entry-headcount-breakdown: ③「グループの人数確認」の内訳を組み立てる
 * （event-line-broadcast §3.1.3a / §3.1.3b）。
 *
 * **このモジュールは pure**。事実の収集は `entry-headcount.ts`（DB 層）の仕事で、
 * ここは受け取った facts から「誰をどの行に数えるか」だけを決める
 * （`entry-fee.ts` ↔ `entry-fee-tally.ts` と同じ流儀）。分岐が多いので、
 * Docker の test DB 無しで網羅できるようにしてある。
 *
 * ★この内訳が答えている問いは「**LINE グループにいるはずの人は何人か**」であって
 * 「誰に知らせるか」ではない。③のメンション先（`role='admin'`）とは別物で、
 * 管理者行が `0名（大会参加のため）` になってもメンションは飛ぶ。
 *
 * ★**1人はどこか1行にだけ数える**（§3.1.3a）。優先順位は
 * 大会参加者 ＞ 会計 ＞ 副連絡責任者 ＞ 管理者。先に確定した行へ寄せ、
 * 後の行からは外す。外れて0名になった行には理由を注記する。
 */

/** 行が0名になった理由。1名以上残る行には付かない（§3.1.3a）。 */
const NOTE_UNSET = '未設定'
const NOTE_COUNTED_AS_ENTRANT = '大会参加のため'
const NOTE_COUNTED_AS_TREASURER = '会計として計上のため'
const NOTE_COUNTED_AS_SUBMITTER = '副連絡責任者として計上のため'
/** 副連絡責任者の行だけの特則（§3.1.3b）。 */
const NOTE_NO_TRAVEL_REPORT = '遠征届不要のため'
const NOTE_HAS_GUEST_ENTRANT = '他会参加者ありのため'

/**
 * ③の本文テンプレート。**静的なリテラル**であること
 * （`buildMentionMessage` が `template` の中括弧を禁止しているため、
 * 名字や注記は `%s` ＋ `{ text }` で差し込む）。
 */
const BREAKDOWN_TEMPLATE = [
  'グループの人数が%s名であることを確認してください。',
  '',
  '内訳',
  '大会参加者：%s名',
  '管理者：%s名（%s）',
  '会計：%s名（%s）',
  '副連絡責任者：%s名（%s）',
  'Bot：1名',
].join('\n')

/** Bot 自身の1名。合計に必ず足す（§3.1.3a）。 */
const BOT_HEADCOUNT = 1

/** 1行ぶんの結果（人数と括弧の中身）。 */
interface BreakdownRow {
  count: number
  /** 名字の並び（`酒井・飯塚`）か、0名になった理由。 */
  note: string
}

/** どの行がその人を取ったか（注記の選択に使う）。優先順位の高い順。 */
interface AssignedBuckets {
  entrants: ReadonlySet<string>
  treasurers: ReadonlySet<string>
  submitters: ReadonlySet<string>
}

/** `users.id` 昇順のまま中黒で並べる（§3.1.3a）。 */
function joinNames(holders: readonly HeadcountRoleHolder[]): string {
  return holders.map((h) => h.displayName).join('・')
}

/** 自分より優先順位が高い行に取られていない候補（＝この行に残る人）。 */
function remaining(
  candidates: readonly HeadcountRoleHolder[],
  assigned: ReadonlySet<string>,
): HeadcountRoleHolder[] {
  return candidates.filter((h) => !assigned.has(h.userId))
}

/**
 * 候補が全員どこへ寄ったのかを示す注記を選ぶ。寄せ先が混ざったときは
 * **バケットの優先順位**（大会参加者 ＞ 会計 ＞ 副連絡責任者）で決める
 * — 要件は単一の寄せ先しか例示していないので、決定的な規則をここで1つに定める。
 */
function absorbedNote(
  candidates: readonly HeadcountRoleHolder[],
  buckets: AssignedBuckets,
): string {
  if (candidates.some((h) => buckets.entrants.has(h.userId))) return NOTE_COUNTED_AS_ENTRANT
  if (candidates.some((h) => buckets.treasurers.has(h.userId))) return NOTE_COUNTED_AS_TREASURER
  if (candidates.some((h) => buckets.submitters.has(h.userId))) return NOTE_COUNTED_AS_SUBMITTER
  // 全員寄ったときにだけ呼ばれるので到達しないが、注記を捏造しない安全側の既定。
  return NOTE_UNSET
}

/** 管理者・会計の行（特則の無い普通の役割行）。 */
function buildRoleRow(
  candidates: readonly HeadcountRoleHolder[],
  kept: readonly HeadcountRoleHolder[],
  buckets: AssignedBuckets,
): BreakdownRow {
  if (kept.length > 0) return { count: kept.length, note: joinNames(kept) }
  // 該当者がそもそも居ない（フラグ未設定・全員 LINE 未紐付け）のか、
  // 上位の行へ寄ったのかで注記が変わる（§3.1.3a）。
  return {
    count: 0,
    note: candidates.length === 0 ? NOTE_UNSET : absorbedNote(candidates, buckets),
  }
}

/**
 * 副連絡責任者の行（§3.1.3b の5分岐）。判定の順序に意味がある:
 *
 * 1. 該当者が1人以上いて**全員が上位の行へ寄った** → 寄せ先の注記
 * 2. **遠征届が不要** → `0名（遠征届不要のため）`（要らない大会で「未設定です」と
 *    無用な警告を出さないため、3より先に見る）
 * 3. 残り0人 → `0名（未設定）`（＝遠征届が要るのにフラグ未設定・全員 LINE 未紐付け）
 * 4. ゲスト参加者がいる → `N名（名字・他会参加者ありのため）`
 * 5. それ以外 → `N名（名字）`
 */
function buildSubmitterRow(
  candidates: readonly HeadcountRoleHolder[],
  unabsorbed: readonly HeadcountRoleHolder[],
  buckets: AssignedBuckets,
  travelReportRequired: boolean,
  hasGuestEntrant: boolean,
): BreakdownRow {
  if (candidates.length > 0 && unabsorbed.length === 0) {
    return { count: 0, note: absorbedNote(candidates, buckets) }
  }
  if (!travelReportRequired) return { count: 0, note: NOTE_NO_TRAVEL_REPORT }
  if (unabsorbed.length === 0) return { count: 0, note: NOTE_UNSET }

  const names = joinNames(unabsorbed)
  return {
    count: unabsorbed.length,
    note: hasGuestEntrant ? `${names}・${NOTE_HAS_GUEST_ENTRANT}` : names,
  }
}

/**
 * ③の `{ template, values }` を組み立てる。`buildMentionMessage` へそのまま渡せる。
 *
 * 合計は5行の単純和（Bot の1名込み）で、排他のおかげで
 * 「グループにいるはずの実人数」と一致する（AC-H2）。
 */
export function buildHeadcountBreakdown(facts: GroupHeadcountFacts): {
  template: string
  values: MentionValue[]
} {
  // 遠征届の要否（§3.1.3b）。ゲストは北大かるた会サークル員なので
  // `is_circle_member` に関係なく無条件で対象。確定状況は**参照しない**（AC-H15）。
  const travelReportRequired = facts.hasCircleMemberEntrant || facts.hasGuestEntrant

  // 優先順位の高い行から順に確定させ、取った人を assigned へ積む。
  const assigned = new Set<string>(facts.entrantUserIds)

  const treasurerKept = remaining(facts.treasurers, assigned)
  for (const h of treasurerKept) assigned.add(h.userId)

  // ★**遠征届が不要なら、この行は人を1人も抱えない**（副連絡責任者は遠征届が
  // 要るときだけグループに入る）。寄っていない該当者は下位の管理者行へ落ちる —
  // ここで抱え込むと、副連絡責任者を兼ねる管理者が**どの行にも計上されず**
  // 合計が実人数より少なくなる（AC-H2）。
  // 一方、注記の判定（分岐1）は「寄ったかどうか」で決まるので、
  // 遠征届の要否で絞る**前**の unabsorbed を別に取っておく。
  const submitterUnabsorbed = remaining(facts.travelReportSubmitters, assigned)
  const submitterKept = travelReportRequired ? submitterUnabsorbed : []
  for (const h of submitterKept) assigned.add(h.userId)

  const adminKept = remaining(facts.admins, assigned)

  const buckets: AssignedBuckets = {
    entrants: facts.entrantUserIds,
    treasurers: new Set(treasurerKept.map((h) => h.userId)),
    submitters: new Set(submitterKept.map((h) => h.userId)),
  }

  const treasurerRow = buildRoleRow(facts.treasurers, treasurerKept, buckets)
  const submitterRow = buildSubmitterRow(
    facts.travelReportSubmitters,
    submitterUnabsorbed,
    buckets,
    travelReportRequired,
    facts.hasGuestEntrant,
  )
  const adminRow = buildRoleRow(facts.admins, adminKept, buckets)

  const entrantCount = facts.entrantUserIds.size
  const total =
    entrantCount + adminRow.count + treasurerRow.count + submitterRow.count + BOT_HEADCOUNT

  return {
    template: BREAKDOWN_TEMPLATE,
    values: [
      total,
      entrantCount,
      adminRow.count,
      { text: adminRow.note },
      treasurerRow.count,
      { text: treasurerRow.note },
      submitterRow.count,
      { text: submitterRow.note },
    ],
  }
}
