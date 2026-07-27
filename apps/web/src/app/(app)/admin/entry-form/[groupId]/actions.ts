'use server'

import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  entryFormDrafts,
  eventAttendances,
  events,
  mailAttachments,
  mailMessages,
  tournamentDrafts,
  users,
} from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { deriveEntryGroupName } from '@/lib/entry-groups'
import { todayInJst } from '@/lib/jst-date'
import { getAppearanceCounts } from '@/lib/lottery/appearance-counts'
import { estimateCellMap, type CellMap } from '@/lib/entry-form/cell-map'
import type ExcelJS from 'exceljs'
import { loadWorkbook } from '@/lib/entry-form/workbook'
import {
  extractOrganizerInstructions,
  inferCellMap,
  sheetsToPromptText,
  type OrganizerInstructions,
} from '@/lib/entry-form/ai-extract'
import { fillEntryForm, type EntryFormMember } from '@/lib/entry-form/fill'
import { buildDraftMime } from '@/lib/entry-form/mime'
import { appendDraftToYahoo } from '@/lib/entry-form/imap-draft'
import { getEntryFormSettings, type EntryFormSettings } from '@/lib/entry-form/settings'

/**
 * entry-form-autofill タスク7: 申込書作成プレビュー（S2）の Server Actions。
 *
 * 権限は admin / vice_admin のみ（AC-2）。requirements の大原則どおり、
 * Yahoo への書き込みは IMAP APPEND だけで、送信経路はこのファイルにも
 * 依存グラフにも存在しない。
 */

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

// ---------------------------------------------------------------------------
// ① 初期データ
// ---------------------------------------------------------------------------

export interface EntryFormTemplateCandidate {
  attachmentId: number
  filename: string
  sizeBytes: number
  /** 案内メールの受信日時（候補の並び順と「5/8 受信」表示に使う）。 */
  receivedAt: string
  mailSubject: string | null
}

export interface EntryFormMemberRow extends EntryFormMember {
  userId: string
  /** users.name（表示名）。姓名が未登録の会員を画面で指し示すために使う。 */
  displayName: string | null
  /** 姓名・かなのいずれかが未登録（プレビューで入力させ users へ書き戻す）。 */
  needsNameInput: boolean
}

export interface EntryFormContext {
  groupId: number
  groupName: string | null
  /** グループ内イベントの開催日（昇順）。 */
  eventDates: string[]
  entryDeadline: string | null
  /** 主催者名（メール宛名に使う）。グループ内で最初に見つかった非 null 値。 */
  organizer: string | null
  templateCandidates: EntryFormTemplateCandidate[]
  members: EntryFormMemberRow[]
  /** 出場回数の基準日（当日 JST）と、名簿欠落による過少計上の有無。 */
  appearanceReferenceDate: string
  appearanceCompleteness: 'complete' | 'incomplete'
  settings: EntryFormSettings
  /** 案内メールの差出人（宛先プレフィル優先順③）。 */
  sourceMailFrom: string | null
  latestDraft: EntryFormDraftSummary | null
}

export interface EntryFormDraftSummary {
  id: number
  createdAt: string
  createdByName: string | null
  attachmentFilename: string
  memberCount: number
  status: 'created' | 'imap_failed'
  imapError: string | null
}

/** 協会年度（4/1 開始）を JST の暦日から導く。 */
function associationYearOf(date: string): number {
  return Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0)
}

export async function loadEntryFormContext(groupId: number): Promise<EntryFormContext> {
  await requireAdminSession()

  const groupEvents = await db
    .select({
      id: events.id,
      title: events.title,
      eventDate: events.eventDate,
      entryDeadline: events.entryDeadline,
      organizer: events.organizer,
      tournamentDraftId: events.tournamentDraftId,
    })
    .from(events)
    .where(eq(events.entryGroupId, groupId))
    .orderBy(asc(events.eventDate), asc(events.id))

  if (groupEvents.length === 0) {
    throw new Error('申込グループが見つかりません')
  }

  const eventIds = groupEvents.map((e) => e.id)

  // 対象会員 = グループ内全イベントの attend=true の和集合（会員単位で重複排除）。
  const attendees = await db
    .selectDistinctOn([users.id], {
      userId: users.id,
      displayName: users.name,
      grade: users.grade,
      dan: users.dan,
      familyName: users.familyName,
      givenName: users.givenName,
      familyKana: users.familyKana,
      givenKana: users.givenKana,
    })
    .from(eventAttendances)
    .innerJoin(users, eq(users.id, eventAttendances.userId))
    .where(and(inArray(eventAttendances.eventId, eventIds), eq(eventAttendances.attend, true)))
    .orderBy(asc(users.id))

  const appearance = await loadAppearanceCounts(attendees.map((a) => a.userId))

  const members: EntryFormMemberRow[] = attendees
    .map((a) => ({
      userId: a.userId,
      displayName: a.displayName,
      grade: a.grade as Grade | null,
      dan: a.dan,
      familyName: a.familyName,
      givenName: a.givenName,
      familyKana: a.familyKana,
      givenKana: a.givenKana,
      appearanceCount: appearance.byUser.get(a.userId) ?? null,
      note: null,
      needsNameInput: !a.familyName || !a.givenName || !a.familyKana || !a.givenKana,
    }))
    // 表示順は級 → 表示名。級未設定は末尾。
    .sort((x, y) => {
      const gx = x.grade ?? 'Z'
      const gy = y.grade ?? 'Z'
      if (gx !== gy) return gx < gy ? -1 : 1
      return (x.displayName ?? '').localeCompare(y.displayName ?? '', 'ja')
    })

  const draftIds = groupEvents
    .map((e) => e.tournamentDraftId)
    .filter((v): v is number => v != null)

  let templateCandidates: EntryFormTemplateCandidate[] = []
  let sourceMailFrom: string | null = null
  if (draftIds.length > 0) {
    const rows = await db
      .select({
        attachmentId: mailAttachments.id,
        filename: mailAttachments.filename,
        sizeBytes: mailAttachments.sizeBytes,
        receivedAt: mailMessages.receivedAt,
        mailSubject: mailMessages.subject,
        fromAddress: mailMessages.fromAddress,
      })
      .from(tournamentDrafts)
      .innerJoin(mailMessages, eq(mailMessages.id, tournamentDrafts.messageId))
      .innerJoin(mailAttachments, eq(mailAttachments.mailMessageId, mailMessages.id))
      .where(inArray(tournamentDrafts.id, draftIds))
      .orderBy(desc(mailMessages.receivedAt), asc(mailAttachments.id))

    templateCandidates = rows
      .filter((r) => r.filename.toLowerCase().endsWith('.xlsx'))
      .map((r) => ({
        attachmentId: r.attachmentId,
        filename: r.filename,
        sizeBytes: r.sizeBytes,
        receivedAt: r.receivedAt.toISOString(),
        mailSubject: r.mailSubject,
      }))
    sourceMailFrom = rows[0]?.fromAddress ?? null
  }

  return {
    groupId,
    groupName: deriveEntryGroupName(groupEvents.map((e) => e.title)),
    eventDates: groupEvents.map((e) => e.eventDate),
    entryDeadline: groupEvents.find((e) => e.entryDeadline != null)?.entryDeadline ?? null,
    organizer: groupEvents.find((e) => e.organizer != null)?.organizer ?? null,
    templateCandidates,
    members,
    appearanceReferenceDate: appearance.referenceDate,
    appearanceCompleteness: appearance.completeness,
    settings: await getEntryFormSettings(),
    sourceMailFrom,
    latestDraft: await loadLatestDraft(groupId),
  }
}

async function loadLatestDraft(groupId: number): Promise<EntryFormDraftSummary | null> {
  const [row] = await db
    .select({
      id: entryFormDrafts.id,
      createdAt: entryFormDrafts.createdAt,
      createdByName: users.name,
      attachmentFilename: entryFormDrafts.attachmentFilename,
      memberCount: entryFormDrafts.memberCount,
      status: entryFormDrafts.status,
      imapError: entryFormDrafts.imapError,
    })
    .from(entryFormDrafts)
    .leftJoin(users, eq(users.id, entryFormDrafts.createdBy))
    .where(eq(entryFormDrafts.entryGroupId, groupId))
    .orderBy(desc(entryFormDrafts.createdAt), desc(entryFormDrafts.id))
    .limit(1)

  if (!row) return null
  return { ...row, createdAt: row.createdAt.toISOString() }
}

/**
 * 出場回数を会員単位で引く（基準日=当日 JST）。名簿の取込漏れで過少になり得るため、
 * 完全性フラグも一緒に返して呼び出し側が警告を出せるようにする。
 */
async function loadAppearanceCounts(userIds: string[]): Promise<{
  referenceDate: string
  completeness: 'complete' | 'incomplete'
  byUser: Map<string, number>
}> {
  const referenceDate = todayInJst()
  const byUser = new Map<string, number>()
  if (userIds.length === 0) {
    return { referenceDate, completeness: 'complete', byUser }
  }
  const counts = await getAppearanceCounts({
    userIds,
    associationYear: associationYearOf(referenceDate),
    referenceDate,
  })
  for (const row of counts.memberCounts) byUser.set(row.userId, row.count)
  return { referenceDate, completeness: counts.completeness, byUser }
}

/**
 * 出欠が「参加」でない会員も申込書へ手で足せるようにするための候補一覧
 * （requirements §3.2.1「行の追加（会員一覧から選択）」・AC-5）。
 * 対象会員が0名のグループでも、ここから足せば申込書を作れる。
 *
 * `excludeUserIds` には画面が既に持っている行を渡す（初期の和集合＋追加済み）。
 */
export async function listAddableMembersAction(
  excludeUserIds: string[],
): Promise<EntryFormMemberRow[]> {
  await requireAdminSession()

  const rows = await db
    .select({
      userId: users.id,
      displayName: users.name,
      grade: users.grade,
      dan: users.dan,
      familyName: users.familyName,
      givenName: users.givenName,
      familyKana: users.familyKana,
      givenKana: users.givenKana,
    })
    .from(users)
    .orderBy(asc(users.name))

  const excluded = new Set(excludeUserIds)
  const candidates = rows.filter((row) => !excluded.has(row.userId))
  const appearance = await loadAppearanceCounts(candidates.map((c) => c.userId))

  return candidates.map((row) => ({
    userId: row.userId,
    displayName: row.displayName,
    grade: row.grade as Grade | null,
    dan: row.dan,
    familyName: row.familyName,
    givenName: row.givenName,
    familyKana: row.familyKana,
    givenKana: row.givenKana,
    appearanceCount: appearance.byUser.get(row.userId) ?? null,
    note: null,
    needsNameInput:
      !row.familyName || !row.givenName || !row.familyKana || !row.givenKana,
  }))
}

// ---------------------------------------------------------------------------
// ② テンプレ解析
// ---------------------------------------------------------------------------

export interface TemplateAnalysis {
  cellMap: CellMap
  /** セルマップの出所。プレビューの「AI」バッジと告知面の出し分けに使う。 */
  source: 'heuristic' | 'ai' | 'unresolved'
  /** 低信頼・部分的な検出失敗の説明（日本語）。 */
  warnings: string[]
  /** テンプレ xlsx 内から抽出した申込先（宛先プレフィル優先順①）。 */
  organizerEmail: string | null
  templateFilename: string
  /**
   * 案内メール本文から AI が抽出した主催者指定（件名・添付ファイル名・申込先）。
   * 指定が無い／抽出できなかった項目は null で、呼び出し側は定型へフォールバックする
   * （requirements §3.2.6・AC-13）。
   */
  organizerInstructions: OrganizerInstructions | null
}

/** 手動アップロード時に受け取る xlsx。base64 で渡す（Server Action の境界を Buffer が越えないため）。 */
export interface UploadedTemplate {
  filename: string
  base64: string
}

async function readTemplate(
  attachmentId: number | null,
  uploaded: UploadedTemplate | null,
): Promise<{ workbook: ExcelJS.Workbook; filename: string; bytes: Buffer }> {
  let bytes: Buffer
  let filename: string
  if (uploaded) {
    bytes = Buffer.from(uploaded.base64, 'base64')
    filename = uploaded.filename
  } else if (attachmentId != null) {
    const row = await db.query.mailAttachments.findFirst({
      where: eq(mailAttachments.id, attachmentId),
      columns: { data: true, filename: true },
    })
    if (!row) throw new Error('選択されたテンプレートが見つかりません')
    bytes = row.data
    filename = row.filename
  } else {
    throw new Error('テンプレートが選択されていません')
  }

  try {
    return { workbook: await loadWorkbook(bytes), filename, bytes }
  } catch {
    // 壊れた xlsx・xls を xlsx として渡された場合。中断してユーザーに知らせる。
    throw new Error('申込書ファイルを読み込めませんでした。xlsx 形式か確認してください')
  }
}

/**
 * グループに紐付く案内メールの本文。主催者指定（件名・ファイル名・申込先）の
 * 抽出元になる（requirements §3.2.6）。取込メールが無いグループでは null。
 */
async function loadSourceMailBody(groupId: number): Promise<string | null> {
  const [row] = await db
    .select({ bodyText: mailMessages.bodyText })
    .from(events)
    .innerJoin(tournamentDrafts, eq(tournamentDrafts.id, events.tournamentDraftId))
    .innerJoin(mailMessages, eq(mailMessages.id, tournamentDrafts.messageId))
    .where(eq(events.entryGroupId, groupId))
    .orderBy(desc(mailMessages.receivedAt))
    .limit(1)
  return row?.bodyText ?? null
}

export async function analyzeTemplateAction(input: {
  groupId?: number | null
  attachmentId?: number | null
  uploaded?: UploadedTemplate | null
}): Promise<TemplateAnalysis> {
  await requireAdminSession()
  const { workbook, filename } = await readTemplate(
    input.attachmentId ?? null,
    input.uploaded ?? null,
  )

  const estimate = estimateCellMap(workbook)
  const sheetsText = sheetsToPromptText(workbook)

  // 主催者指定の抽出は案内メール本文がある場合だけ（AC-13）。セルマップ推定の
  // 信頼度とは独立した用途なので、高信頼でも呼ぶ。
  const mailBody = input.groupId != null ? await loadSourceMailBody(input.groupId) : null
  const organizerInstructions = mailBody
    ? await extractOrganizerInstructions(mailBody, sheetsText)
    : null

  if (estimate.confidence === 'high') {
    return {
      cellMap: { sheets: estimate.sheets },
      source: 'heuristic',
      warnings: estimate.warnings,
      organizerEmail: estimate.organizerEmail,
      templateFilename: filename,
      organizerInstructions,
    }
  }

  // 低信頼のときだけ Haiku へ回す（requirements §3.2.3 第二段）。
  // AI が推定不可を返してもフロー自体は続行できる（手動マッピングへ誘導）。
  const inferred = await inferCellMap(sheetsText)
  if (!inferred) {
    return {
      cellMap: { sheets: estimate.sheets },
      source: 'unresolved',
      warnings: [...estimate.warnings, '列の対応を自動推定できませんでした。プレビューで指定してください'],
      organizerEmail: estimate.organizerEmail,
      templateFilename: filename,
      organizerInstructions,
    }
  }
  return {
    cellMap: { sheets: inferred },
    source: 'ai',
    warnings: estimate.warnings,
    organizerEmail: estimate.organizerEmail,
    templateFilename: filename,
    organizerInstructions,
  }
}

// ---------------------------------------------------------------------------
// ③ 姓名・かなの書き戻し
// ---------------------------------------------------------------------------

export interface MemberNameInput {
  userId: string
  familyName: string | null
  givenName: string | null
  familyKana: string | null
  givenKana: string | null
}

/**
 * プレビューで入力された姓名・かなを users へ書き戻す（requirements §3.2.5）。
 * 書き戻すのは4フィールドだけ — `name`（合成表示名・UNIQUE キー）は変更しない。
 */
export async function saveMemberNamesAction(entries: MemberNameInput[]): Promise<void> {
  await requireAdminSession()
  for (const entry of entries) {
    const values = {
      familyName: entry.familyName?.trim() || null,
      givenName: entry.givenName?.trim() || null,
      familyKana: entry.familyKana?.trim() || null,
      givenKana: entry.givenKana?.trim() || null,
    }
    // 空だけの更新で既存値を消さない（プレビューで触っていない会員が混ざっても安全に）。
    if (Object.values(values).every((v) => v == null)) continue
    await db.update(users).set(values).where(eq(users.id, entry.userId))
  }
}

// ---------------------------------------------------------------------------
// ④ 下書き作成
// ---------------------------------------------------------------------------

export interface CreateEntryFormDraftInput {
  groupId: number
  attachmentId?: number | null
  uploaded?: UploadedTemplate | null
  cellMap: CellMap
  members: EntryFormMember[]
  toEmail: string
  subject: string
  body: string
  attachmentFilename: string
}

export interface CreateEntryFormDraftResult {
  draftId: number
  status: 'created' | 'imap_failed'
  /** IMAP 失敗時のみ。生成 xlsx は履歴に保存済みなのでダウンロードできる。 */
  imapError: string | null
  /** どのシートにも該当せず記入されなかった会員数（沈黙の欠落を作らない）。 */
  unassignedCount: number
  /** テンプレの行数を超えて記入できなかった会員数。 */
  overflowCount: number
}

/**
 * プレビュー確定 → 下書き作成。
 *
 * 順序は requirements §3.2.7 で固定: xlsx 記入 → **履歴を保存** → MIME 組立 →
 * IMAP APPEND → status 更新。履歴を APPEND の前に保存するのは、Yahoo への
 * 書き込みが失敗してもプレビューで編集した値と生成済み xlsx を失わないため。
 */
export async function createEntryFormDraftAction(
  input: CreateEntryFormDraftInput,
): Promise<CreateEntryFormDraftResult> {
  const session = await requireAdminSession()
  const settings = await getEntryFormSettings()

  const { workbook } = await readTemplate(input.attachmentId ?? null, input.uploaded ?? null)
  const filled = await fillEntryForm(workbook, input.cellMap, {
    members: input.members,
    constants: settings,
  })

  const [saved] = await db
    .insert(entryFormDrafts)
    .values({
      entryGroupId: input.groupId,
      createdBy: session.user.id,
      toEmail: input.toEmail,
      subject: input.subject,
      body: input.body,
      attachmentFilename: input.attachmentFilename,
      xlsx: filled.buffer,
      memberCount: input.members.length,
    })
    .returning({ id: entryFormDrafts.id })
  if (!saved) throw new Error('作成履歴の保存に失敗しました')

  const result: CreateEntryFormDraftResult = {
    draftId: saved.id,
    status: 'created',
    imapError: null,
    unassignedCount: filled.unassignedMembers.length,
    overflowCount: filled.overflow.reduce((sum, o) => sum + o.members.length, 0),
  }

  try {
    const mime = buildDraftMime({
      from: settings.email ?? '',
      to: input.toEmail,
      subject: input.subject,
      bodyText: input.body,
      attachment: {
        filename: input.attachmentFilename,
        contentType: XLSX_CONTENT_TYPE,
        data: filled.buffer,
      },
    })
    await appendDraftToYahoo(mime)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(entryFormDrafts)
      .set({ status: 'imap_failed', imapError: message })
      .where(eq(entryFormDrafts.id, saved.id))
    result.status = 'imap_failed'
    result.imapError = message
  }

  revalidatePath(`/admin/entry-form/${input.groupId}`)
  return result
}
