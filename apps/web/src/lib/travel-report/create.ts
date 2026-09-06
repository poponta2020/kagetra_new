import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  entryGroupTravelSettings,
  eventAttendances,
  events,
  travelReportBatches,
  travelReportDocuments,
  users,
} from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared'
import { TRAVEL_REPORT_ORGANIZATION_NAME } from '@kagetra/shared'
import { db } from '@/lib/db'
import { todayInJst } from '@/lib/jst-date'
import { getTravelReportSettings } from './settings'
import { pickDestinationContacts, pickHomeContact, type ContactCandidate } from './contacts'
import { fillTravelReportDocx, type TravelReportDocData } from './docx/fill'
import { travelReportTemplateBuffer } from './docx/template.b64'
import { travelReportFilename } from './filename'
import {
  affiliationLine,
  buildRemarks,
  computePeriod,
  rosterFullName,
  sortRosterMembers,
  type TravelReportMember,
  type TravelReportRoute,
} from './render'
import { loadGroupTravelContext } from './targets'
import { getEffectiveSelectionStatuses } from './selection-status'
import { loadTravelRoutesForUnit } from './routes-store'
import { buildTravelUnits, findUnitContainingDate } from './units'
import { LEG_DATE_SLACK_DAYS } from './routes'

/**
 * travel-report: 遠征届の作成（requirements R9・R10・AC-20〜28）。
 *
 * S6 で確定した**ファイル分割**（既定＝遠征単位、日単位で統合・分割できる）ごとに
 * docx を生成し、`travel_report_batches` 1 行 ＋ `travel_report_documents` N 行として
 * 保存する。**追記専用の履歴**で、作り直しても過去の版は残る。
 *
 * ★未入力者がいても作成できる（S6 で警告）。未入力者は名簿に載り、備考には出場行だけが出る。
 */

const GRADE_ORDER: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

/** S6 のファイル1つぶん（既定値。すべて画面で修正できる）。 */
export interface TravelReportFileDefaults {
  /** このファイルに含める開催日（`YYYY-MM-DD`・昇順）。 */
  dates: string[]
  purpose: string
  place: string
  /** 「氏名（電話）」の組。同着で複数になることがある。 */
  destinationContacts: { name: string; phone: string | null }[]
  homeContact: { name: string; phone: string | null } | null
  reportDate: string
  approvalDate: string | null
  /** 名簿人数（＝このファイルの出場者数）。 */
  memberCount: number
  /** 備考の行数（見込み。画面の目安表示に使う）。 */
  remarkLineCount: number
  /** 期間（自〜至・日数）。行が無ければ null。 */
  period: { from: string; to: string; days: number } | null
  /** 経路が未入力の出場者名（S6 の警告）。 */
  pendingNames: string[]
}

/** S6 から送られてくる、ファイルごとの確定値。 */
export interface TravelReportFileInput {
  dates: string[]
  purpose: string
  place: string
  destinationContacts: { name: string; phone: string | null }[]
  homeContact: { name: string; phone: string | null } | null
  reportDate: string
  approvalDate: string | null
}

interface GroupEventRow {
  id: number
  title: string
  formalName: string | null
  location: string | null
  eligibleGrades: Grade[]
}

interface GroupContext {
  entryGroupId: number
  /** 開催日 → その日の events 行。 */
  eventsByDate: Map<string, GroupEventRow[]>
  /** 出場者（サークル所属 ∧ 出欠「参加」∧ 有効な確定状況が確定）: userId → 出場日。 */
  attendanceByUser: Map<string, string[]>
  members: Map<string, TravelReportMember>
  contacts: Map<string, ContactCandidate>
  circleLeader: ContactCandidate | null
  /** サークル長の学部等名・学年（出場者でないこともあるので別に持つ）。 */
  circleLeaderProfile: { faculty: string | null; schoolYear: string | null }
  submitters: ContactCandidate[]
  destinationLabel: string | null
  advisor: { department: string; title: string; name: string }
}

async function loadGroupContext(entryGroupId: number): Promise<GroupContext> {
  const [eventRows, selection, settings, advisor] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        formalName: events.formalName,
        location: events.location,
        eventDate: events.eventDate,
        eligibleGrades: events.eligibleGrades,
        status: events.status,
      })
      .from(events)
      .where(eq(events.entryGroupId, entryGroupId))
      .orderBy(asc(events.eventDate), asc(events.id)),
    getEffectiveSelectionStatuses(entryGroupId),
    db.query.entryGroupTravelSettings.findFirst({
      where: eq(entryGroupTravelSettings.entryGroupId, entryGroupId),
    }),
    getTravelReportSettings(),
  ])

  const eventsByDate = new Map<string, GroupEventRow[]>()
  const eventIds: number[] = []
  for (const row of eventRows) {
    if (row.status === 'cancelled') continue
    eventIds.push(row.id)
    const list = eventsByDate.get(row.eventDate) ?? []
    list.push({
      id: row.id,
      title: row.title,
      formalName: row.formalName,
      location: row.location,
      eligibleGrades: row.eligibleGrades ?? [],
    })
    eventsByDate.set(row.eventDate, list)
  }

  const attendanceRows =
    eventIds.length === 0
      ? []
      : await db
          .select({
            userId: users.id,
            name: users.name,
            familyName: users.familyName,
            givenName: users.givenName,
            familyKana: users.familyKana,
            givenKana: users.givenKana,
            faculty: users.faculty,
            schoolYear: users.schoolYear,
            phone: users.phone,
            birthDate: users.birthDate,
            role: users.role,
            isCircleLeader: users.isCircleLeader,
            isTravelReportSubmitter: users.isTravelReportSubmitter,
            isTreasurer: users.isTreasurer,
            eventDate: events.eventDate,
          })
          .from(eventAttendances)
          .innerJoin(users, eq(users.id, eventAttendances.userId))
          .innerJoin(events, eq(events.id, eventAttendances.eventId))
          .where(
            and(
              inArray(eventAttendances.eventId, eventIds),
              eq(eventAttendances.attend, true),
              eq(users.isCircleMember, true),
            ),
          )
          .orderBy(asc(users.id), asc(events.eventDate))

  const attendanceByUser = new Map<string, string[]>()
  const members = new Map<string, TravelReportMember>()
  const contacts = new Map<string, ContactCandidate>()
  for (const row of attendanceRows) {
    // 有効な確定状況が「確定」の人だけ（Map に無ければ確定）。
    if ((selection.get(row.userId) ?? 'confirmed') !== 'confirmed') continue
    const dates = attendanceByUser.get(row.userId) ?? []
    if (!dates.includes(row.eventDate)) dates.push(row.eventDate)
    attendanceByUser.set(row.userId, dates)
    if (!members.has(row.userId)) {
      const member: TravelReportMember = {
        userId: row.userId,
        displayName: row.name ?? '',
        familyName: row.familyName,
        givenName: row.givenName,
        familyKana: row.familyKana,
        givenKana: row.givenKana,
        faculty: row.faculty,
        schoolYear: row.schoolYear,
        phone: row.phone,
      }
      members.set(row.userId, member)
      contacts.set(row.userId, {
        userId: row.userId,
        name: rosterFullName(member),
        phone: row.phone,
        role: row.role,
        isCircleLeader: row.isCircleLeader,
        isTravelReportSubmitter: row.isTravelReportSubmitter,
        isTreasurer: row.isTreasurer,
        birthDate: row.birthDate,
      })
    }
  }

  // 団体代表者・留守連絡先は出場していない人も候補になるので、会全体から引く。
  const flagRows = await db
    .select({
      userId: users.id,
      name: users.name,
      familyName: users.familyName,
      givenName: users.givenName,
      phone: users.phone,
      role: users.role,
      faculty: users.faculty,
      schoolYear: users.schoolYear,
      isCircleLeader: users.isCircleLeader,
      isTravelReportSubmitter: users.isTravelReportSubmitter,
      isTreasurer: users.isTreasurer,
      birthDate: users.birthDate,
    })
    .from(users)
    .orderBy(asc(users.id))

  let circleLeader: ContactCandidate | null = null
  let circleLeaderProfile: { faculty: string | null; schoolYear: string | null } = {
    faculty: null,
    schoolYear: null,
  }
  const submitters: ContactCandidate[] = []
  for (const row of flagRows) {
    if (!row.isCircleLeader && !row.isTravelReportSubmitter) continue
    const candidate: ContactCandidate = {
      userId: row.userId,
      name: rosterFullName({
        userId: row.userId,
        displayName: row.name ?? '',
        familyName: row.familyName,
        givenName: row.givenName,
        familyKana: null,
        givenKana: null,
        faculty: row.faculty,
        schoolYear: row.schoolYear,
        phone: row.phone,
      }),
      phone: row.phone,
      role: row.role,
      isCircleLeader: row.isCircleLeader,
      isTravelReportSubmitter: row.isTravelReportSubmitter,
      isTreasurer: row.isTreasurer,
      birthDate: row.birthDate,
    }
    if (row.isCircleLeader && circleLeader === null) {
      circleLeader = candidate
      circleLeaderProfile = { faculty: row.faculty, schoolYear: row.schoolYear }
    }
    if (row.isTravelReportSubmitter) submitters.push(candidate)
  }

  return {
    entryGroupId,
    eventsByDate,
    attendanceByUser,
    members,
    contacts,
    circleLeader,
    circleLeaderProfile,
    submitters,
    destinationLabel: settings?.destinationLabel ?? null,
    advisor: {
      department: advisor.advisorDepartment ?? '',
      title: advisor.advisorTitle ?? '',
      name: advisor.advisorName ?? '',
    },
  }
}

/** そのファイルの日に出場する人の userId。 */
function participantsOf(ctx: GroupContext, dates: readonly string[]): string[] {
  const set = new Set(dates)
  return [...ctx.attendanceByUser.entries()]
    .filter(([, days]) => days.some((d) => set.has(d)))
    .map(([userId]) => userId)
}

/** そのファイルの日の対象級（A〜E 順）。 */
function gradesOf(ctx: GroupContext, dates: readonly string[]): Grade[] {
  const set = new Set<Grade>()
  for (const date of dates) {
    for (const ev of ctx.eventsByDate.get(date) ?? []) {
      for (const g of ev.eligibleGrades) set.add(g)
    }
  }
  return GRADE_ORDER.filter((g) => set.has(g))
}

/** そのファイルの日の会場（重複を除いて「・」で連結）。 */
function placeOf(ctx: GroupContext, dates: readonly string[]): string {
  const seen: string[] = []
  for (const date of dates) {
    for (const ev of ctx.eventsByDate.get(date) ?? []) {
      const loc = ev.location?.trim()
      if (loc && !seen.includes(loc)) seen.push(loc)
    }
  }
  return seen.join('・')
}

/** 大会名（正式名称があればそれ）。 */
function tournamentNameOf(ctx: GroupContext, dates: readonly string[]): string {
  for (const date of dates) {
    const ev = ctx.eventsByDate.get(date)?.[0]
    if (ev) return ev.formalName ?? ev.title
  }
  return ''
}

/** 短い大会名（ファイル名用）。 */
function shortNameOf(ctx: GroupContext, dates: readonly string[]): string {
  for (const date of dates) {
    const ev = ctx.eventsByDate.get(date)?.[0]
    if (ev) return ev.title
  }
  return ''
}

/**
 * S6 の既定値を組み立てる（R9）。ファイル分割の既定＝遠征単位（連続開催日）。
 */
export async function loadTravelReportDefaults(
  entryGroupId: number,
  now: Date = new Date(),
): Promise<{ files: TravelReportFileDefaults[]; tournamentName: string }> {
  const [ctx, groupCtx] = await Promise.all([
    loadGroupContext(entryGroupId),
    loadGroupTravelContext(entryGroupId),
  ])
  const reportDate = todayInJst(now)
  const files = await Promise.all(
    groupCtx.units.map((unit) => buildFileDefaults(ctx, unit.dates, reportDate)),
  )
  return { files, tournamentName: tournamentNameOf(ctx, groupCtx.units[0]?.dates ?? []) }
}

async function buildFileDefaults(
  ctx: GroupContext,
  dates: readonly string[],
  reportDate: string,
): Promise<TravelReportFileDefaults> {
  const participantIds = participantsOf(ctx, dates)
  const routes = await loadRoutesFor(ctx, dates, participantIds)
  const members = sortRosterMembers(
    participantIds.flatMap((id) => {
      const m = ctx.members.get(id)
      return m ? [m] : []
    }),
  )
  const grades = gradesOf(ctx, dates)
  const gradeSuffix = grades.length > 0 ? `(${grades.join('')}級)` : ''
  const participants = participantIds.flatMap((id) => {
    const c = ctx.contacts.get(id)
    return c ? [c] : []
  })
  const home = pickHomeContact({
    circleLeader: ctx.circleLeader,
    participantIds: new Set(participantIds),
    submitters: ctx.submitters,
  })
  const remarks = buildRemarks({ members, routes, destinationLabel: ctx.destinationLabel })
  const enteredIds = new Set(routes.filter((r) => r.entered).map((r) => r.userId))

  return {
    dates: [...dates],
    purpose: `${tournamentNameOf(ctx, dates)}${gradeSuffix}への参加`,
    place: placeOf(ctx, dates),
    destinationContacts: pickDestinationContacts(participants).map((c) => ({
      name: c.name,
      phone: c.phone,
    })),
    homeContact: home ? { name: home.name, phone: home.phone } : null,
    reportDate,
    approvalDate: null,
    memberCount: members.length,
    remarkLineCount: remarks.length,
    period: computePeriod(routes),
    pendingNames: members
      .filter((m) => !enteredIds.has(m.userId))
      .map((m) => rosterFullName(m)),
  }
}

/** ファイルに含まれる日から、関係する遠征単位の経路をまとめて引く。 */
async function loadRoutesFor(
  ctx: GroupContext,
  dates: readonly string[],
  participantIds: readonly string[],
): Promise<(TravelReportRoute & { entered: boolean })[]> {
  // `eventsByDate` は cancelled を除いたあとの行だけを持つ（loadGroupContext 参照）。
  const units = buildTravelUnits(
    [...ctx.eventsByDate.entries()].flatMap(([date, evs]) =>
      evs.map((e) => ({ id: e.id, eventDate: date, status: 'published' as const })),
    ),
  )
  const unitKeys = new Set<string>()
  for (const date of dates) {
    const unit = findUnitContainingDate(units, date)
    if (unit) unitKeys.add(unit.startDate)
  }
  const saved = (
    await Promise.all([...unitKeys].map((key) => loadTravelRoutesForUnit(ctx.entryGroupId, key)))
  ).flat()
  const byUser = new Map(saved.map((r) => [r.userId, r]))
  const dateSet = new Set(dates)
  // ★このファイルの日の前後 ±14 日（`LEG_DATE_SLACK_DAYS`）の移動行だけを採る。
  // 統合・分割で日をまたいだとき、別ファイルの行程が混ざらないようにするため。
  const sorted = [...dates].sort()
  const lowerBound = shiftIso(sorted[0] ?? '', -LEG_DATE_SLACK_DAYS)
  const upperBound = shiftIso(sorted.at(-1) ?? '', LEG_DATE_SLACK_DAYS)

  return participantIds.map((userId) => {
    const row = byUser.get(userId)
    const attendanceDates = (ctx.attendanceByUser.get(userId) ?? []).filter((d) => dateSet.has(d))
    return {
      userId,
      departureKind: row?.departureKind ?? 'sapporo',
      // ★このファイルの日の範囲外の移動行は落とす（統合・分割で日をまたいだとき、
      // 別ファイルの行程が混ざらないようにする）。
      legs: (row?.legs ?? []).filter((leg) => leg.date >= lowerBound && leg.date <= upperBound),
      attendanceDates,
      entered: row !== undefined,
    }
  })
}

function shiftIso(iso: string, days: number): string {
  if (iso === '') return iso
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

export interface CreateTravelReportsResult {
  batchId: number
  documents: { id: number; filename: string }[]
  /** 通知の文面に載せる大会名。 */
  tournamentName: string
}

/**
 * 遠征届を作成して保存する（R9・AC-20・AC-27）。**通知は呼び出し側**が行う
 * （batch を保存してから push する。通知が失敗しても作成物は残る）。
 */
export async function createTravelReports(
  entryGroupId: number,
  files: readonly TravelReportFileInput[],
  createdBy: string,
): Promise<CreateTravelReportsResult> {
  if (files.length === 0) throw new Error('作成するファイルがありません')
  const ctx = await loadGroupContext(entryGroupId)
  const template = travelReportTemplateBuffer()

  const built: { filename: string; docx: Buffer; header: Record<string, unknown>; memberCount: number; eventIds: number[] }[] = []
  for (const file of files) {
    const participantIds = participantsOf(ctx, file.dates)
    const routes = await loadRoutesFor(ctx, file.dates, participantIds)
    const members = sortRosterMembers(
      participantIds.flatMap((id) => {
        const m = ctx.members.get(id)
        return m ? [m] : []
      }),
    )
    const remarks = buildRemarks({ members, routes, destinationLabel: ctx.destinationLabel })
    const period = computePeriod(routes)
    const leader = ctx.circleLeader

    const data: TravelReportDocData = {
      purpose: file.purpose,
      place: file.place,
      destinationContacts: file.destinationContacts,
      homeContact: file.homeContact,
      period,
      memberCount: members.length,
      remarks: remarks.map((r) => r.text),
      reportDate: file.reportDate,
      approvalDate: file.approvalDate,
      representative: {
        affiliation: leader ? affiliationLine(ctx.circleLeaderProfile) : '',
        name: leader?.name ?? '',
        phone: leader?.phone ?? '',
      },
      advisor: ctx.advisor,
      roster: members.map((m) => ({
        name: rosterFullName(m),
        faculty: m.faculty ?? '',
        schoolYear: m.schoolYear ?? '',
        phone: m.phone ?? '',
      })),
    }

    const docx = await fillTravelReportDocx(template, data)
    built.push({
      filename: travelReportFilename({
        dates: file.dates,
        tournamentName: shortNameOf(ctx, file.dates),
      }),
      docx,
      header: {
        purpose: data.purpose,
        place: data.place,
        destinationContacts: data.destinationContacts,
        homeContact: data.homeContact,
        period: data.period,
        reportDate: data.reportDate,
        approvalDate: data.approvalDate,
        representative: data.representative,
        advisor: data.advisor,
        organization: TRAVEL_REPORT_ORGANIZATION_NAME,
      },
      memberCount: members.length,
      eventIds: file.dates.flatMap((d) => (ctx.eventsByDate.get(d) ?? []).map((e) => e.id)),
    })
  }

  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(travelReportBatches)
      .values({ entryGroupId, createdBy })
      .returning({ id: travelReportBatches.id })
    if (!batch) throw new Error('遠征届の作成に失敗しました')

    const documents = await tx
      .insert(travelReportDocuments)
      .values(
        built.map((b) => ({
          batchId: batch.id,
          eventIds: b.eventIds,
          filename: b.filename,
          docx: b.docx,
          header: b.header,
          memberCount: b.memberCount,
        })),
      )
      .returning({ id: travelReportDocuments.id, filename: travelReportDocuments.filename })

    return {
      batchId: batch.id,
      documents,
      tournamentName: tournamentNameOf(ctx, files[0]?.dates ?? []),
    }
  })
}

