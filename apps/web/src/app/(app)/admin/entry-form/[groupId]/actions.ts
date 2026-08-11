'use server'

import { and, asc, desc, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm'
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
import { buildDraftMessageId, buildDraftMime } from '@/lib/entry-form/mime'
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
  /**
   * 出場回数が過少になり得る級（AC-9b の行単位警告の対象）。
   * `null` は「どの級が影響を受けるか特定できない」＝全行が対象（欠落情報に
   * 級が付いていないケース）。`complete` のときは空配列。
   */
  appearanceIncompleteGrades: Grade[] | null
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
  status: 'pending' | 'appending' | 'created' | 'imap_failed'
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
    // 退会済み会員は申込対象にしない（過去の出欠だけが残っているケースがある）。
    // guest-role E1/AC-17: ゲストは会経由で申し込まないので対象会員から除外する
    // （出欠は取れても申込書には現れない。requirements R4）。
    .where(
      and(
        inArray(eventAttendances.eventId, eventIds),
        eq(eventAttendances.attend, true),
        isNull(users.deactivatedAt),
        ne(users.role, 'guest'),
      ),
    )
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
    // 差出人は添付の有無と独立に引く。添付が無い案内メールこそ手動アップロードが
    // 必要になる場面であり、そこで宛先フォールバック（AC-12 の③）が消えては困る。
    const [latestMail] = await db
      .select({ fromAddress: mailMessages.fromAddress })
      .from(tournamentDrafts)
      .innerJoin(mailMessages, eq(mailMessages.id, tournamentDrafts.messageId))
      .where(inArray(tournamentDrafts.id, draftIds))
      .orderBy(desc(mailMessages.receivedAt))
      .limit(1)
    sourceMailFrom = latestMail?.fromAddress ?? null

    const rows = await db
      .select({
        attachmentId: mailAttachments.id,
        filename: mailAttachments.filename,
        sizeBytes: mailAttachments.sizeBytes,
        receivedAt: mailMessages.receivedAt,
        mailSubject: mailMessages.subject,
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
    appearanceIncompleteGrades: appearance.incompleteGrades,
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
  incompleteGrades: Grade[] | null
  byUser: Map<string, number>
}> {
  const referenceDate = todayInJst()
  const byUser = new Map<string, number>()
  if (userIds.length === 0) {
    return { referenceDate, completeness: 'complete', incompleteGrades: [], byUser }
  }
  const counts = await getAppearanceCounts({
    userIds,
    associationYear: associationYearOf(referenceDate),
    referenceDate,
  })
  for (const row of counts.memberCounts) byUser.set(row.userId, row.count)

  // 欠落の級が1つでも特定できない（grade=null＝級の範囲が不明な大会）なら、
  // どの会員が影響を受けるか絞れないので全行を対象にする。
  const scopeUnknown = counts.missing.some((m) => m.grade == null)
  const incompleteGrades = scopeUnknown
    ? null
    : [...new Set(counts.missing.map((m) => m.grade as Grade))]

  return { referenceDate, completeness: counts.completeness, incompleteGrades, byUser }
}

/**
 * 出欠が「参加」でない会員も申込書へ手で足せるようにするための候補一覧
 * （requirements §3.2.1「行の追加（会員一覧から選択）」・AC-5）。
 * 対象会員が0名のグループでも、ここから足せば申込書を作れる。
 *
 * `excludeUserIds` には画面が既に持っている行を渡す（初期の和集合＋追加済み）。
 */
export interface AddableMembersResult {
  members: EntryFormMemberRow[]
  /**
   * 候補側の出場回数の完全性。初期対象0名のグループでは context 側が
   * `complete` を返すため（照会対象が空）、追加した会員の欠落警告がここでしか出ない。
   */
  appearanceCompleteness: 'complete' | 'incomplete'
  appearanceIncompleteGrades: Grade[] | null
}

export async function listAddableMembersAction(
  excludeUserIds: string[],
): Promise<AddableMembersResult> {
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
    // guest-role E1/AC-17: 手動追加のピッカーからもゲストを外す。自動抽出
    // （attend=true）側だけ除外しても、ここから選べば同じ xlsx に載ってしまう
    // ——「ゲストは申込書に載らない」は経路ではなく成果物に対する要件なので、
    // 申込書へ到達する導線はすべて閉じる（requirements R4 / §5 Non-goals）。
    .where(and(isNull(users.deactivatedAt), ne(users.role, 'guest')))
    .orderBy(asc(users.name))

  const excluded = new Set(excludeUserIds)
  const candidates = rows.filter((row) => !excluded.has(row.userId))
  const appearance = await loadAppearanceCounts(candidates.map((c) => c.userId))

  return {
    members: candidates.map((row) => ({
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
    })),
    appearanceCompleteness: appearance.completeness,
    appearanceIncompleteGrades: appearance.incompleteGrades,
  }
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
  /**
   * ワークブックのシート名一覧。ヒューリスティックも AI も対応を返せなかった
   * （`sheets` が空の）ときに、どのシートへ手動でマッピングするかを選ばせる。
   */
  sheetNames: string[]
  /**
   * 選んだ添付が付いていた案内メールの差出人（宛先プレフィル優先順③）。
   * グループ内に案内メールが複数あり得るため、`EntryFormContext.sourceMailFrom`
   * （グループ内で最新のもの）ではなくこちらを優先する。
   */
  sourceMailFrom: string | null
}

/** 手動アップロード時に受け取る xlsx。base64 で渡す（Server Action の境界を Buffer が越えないため）。 */
export interface UploadedTemplate {
  filename: string
  base64: string
}

/**
 * 添付がその申込グループの候補（グループ内イベント → tournament_draft →
 * 取込メール → 添付）であることを確かめる。クライアントが渡す attachmentId を
 * そのまま信用すると、別大会の添付を任意のグループへ組み合わせられる。
 */
async function assertAttachmentBelongsToGroup(
  groupId: number,
  attachmentId: number,
): Promise<void> {
  const [row] = await db
    .select({ id: mailAttachments.id })
    .from(events)
    .innerJoin(tournamentDrafts, eq(tournamentDrafts.id, events.tournamentDraftId))
    .innerJoin(mailMessages, eq(mailMessages.id, tournamentDrafts.messageId))
    .innerJoin(mailAttachments, eq(mailAttachments.mailMessageId, mailMessages.id))
    .where(and(eq(events.entryGroupId, groupId), eq(mailAttachments.id, attachmentId)))
    .limit(1)
  if (!row) {
    throw new Error('選択されたテンプレートはこの申込グループのものではありません')
  }
}

/**
 * 解析にかけて良い xlsx の上限。ExcelJS は展開後をメモリに載せるため、
 * 巨大なファイルで web プロセスを詰まらせないよう入口で切る。手動アップロードは
 * UI 側でも 2MB で弾いているが、Server Action の直接呼び出しと候補添付
 * （メール由来・最大 30MB まで保存され得る）にも同じ上限をかける。
 */
const MAX_TEMPLATE_BYTES = 4 * 1024 * 1024

async function readTemplate(
  groupId: number | null,
  attachmentId: number | null,
  uploaded: UploadedTemplate | null,
): Promise<{ workbook: ExcelJS.Workbook; filename: string; bytes: Buffer }> {
  let bytes: Buffer
  let filename: string
  if (uploaded) {
    bytes = Buffer.from(uploaded.base64, 'base64')
    filename = uploaded.filename
  } else if (attachmentId != null) {
    if (groupId == null) {
      throw new Error('申込グループが指定されていません')
    }
    await assertAttachmentBelongsToGroup(groupId, attachmentId)
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

  if (bytes.length > MAX_TEMPLATE_BYTES) {
    throw new Error(
      `申込書ファイルが大きすぎます（${Math.round(bytes.length / 1024)}KB）。${Math.round(MAX_TEMPLATE_BYTES / 1024)}KB 以下のファイルを使ってください`,
    )
  }

  try {
    return { workbook: await loadWorkbook(bytes), filename, bytes }
  } catch {
    // 壊れた xlsx・xls を xlsx として渡された場合。中断してユーザーに知らせる。
    throw new Error('申込書ファイルを読み込めませんでした。xlsx 形式か確認してください')
  }
}

/**
 * 主催者指定（件名・ファイル名・申込先）の抽出元になる案内メール本文
 * （requirements §3.2.6）。
 *
 * **候補添付を選んだ場合は、その添付が付いていたメール**を使う。グループには
 * 複数の案内メールが紐付き得る（別々の tournament_draft を持つイベントを同じ
 * 申込グループに束ねた場合）ので、「グループ内で最新のメール」を使うと、古い
 * 添付を選んだのに別のメールの宛先・件名指定が適用される。
 *
 * 手動アップロードは添付元をたどれないため、グループ内で最新のメールへ倒す。
 */
async function loadSourceMail(
  groupId: number,
  attachmentId: number | null,
): Promise<{ bodyText: string | null; fromAddress: string | null } | null> {
  if (attachmentId != null) {
    const [row] = await db
      .select({ bodyText: mailMessages.bodyText, fromAddress: mailMessages.fromAddress })
      .from(mailAttachments)
      .innerJoin(mailMessages, eq(mailMessages.id, mailAttachments.mailMessageId))
      .where(eq(mailAttachments.id, attachmentId))
      .limit(1)
    return row ?? null
  }

  const [row] = await db
    .select({ bodyText: mailMessages.bodyText, fromAddress: mailMessages.fromAddress })
    .from(events)
    .innerJoin(tournamentDrafts, eq(tournamentDrafts.id, events.tournamentDraftId))
    .innerJoin(mailMessages, eq(mailMessages.id, tournamentDrafts.messageId))
    .where(eq(events.entryGroupId, groupId))
    .orderBy(desc(mailMessages.receivedAt))
    .limit(1)
  return row ?? null
}

export async function analyzeTemplateAction(input: {
  groupId?: number | null
  attachmentId?: number | null
  uploaded?: UploadedTemplate | null
}): Promise<TemplateAnalysis> {
  await requireAdminSession()
  const { workbook, filename } = await readTemplate(
    input.groupId ?? null,
    input.attachmentId ?? null,
    input.uploaded ?? null,
  )

  const estimate = estimateCellMap(workbook)
  const sheetsText = sheetsToPromptText(workbook)
  const sheetNames = workbook.worksheets.map((ws) => ws.name)

  // 主催者指定の抽出は案内メール本文がある場合だけ（AC-13）。セルマップ推定の
  // 信頼度とは独立した用途なので、高信頼でも呼ぶ。
  const sourceMail =
    input.groupId != null
      ? await loadSourceMail(input.groupId, input.attachmentId ?? null)
      : null
  // 案内メール本文が無くても xlsx 内の指定は拾う（requirements §3.2.6 は
  // 「案内メール本文・xlsx 内にあれば」なので、手動アップロードでも効かせる）。
  const organizerInstructions = await extractOrganizerInstructions(
    sourceMail?.bodyText ?? '',
    sheetsText,
  )

  if (estimate.confidence === 'high') {
    return {
      cellMap: { sheets: estimate.sheets },
      source: 'heuristic',
      warnings: estimate.warnings,
      organizerEmail: estimate.organizerEmail,
      templateFilename: filename,
      organizerInstructions,
      sheetNames,
      sourceMailFrom: sourceMail?.fromAddress ?? null,
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
      sheetNames,
      sourceMailFrom: sourceMail?.fromAddress ?? null,
    }
  }
  return {
    cellMap: { sheets: inferred },
    source: 'ai',
    warnings: estimate.warnings,
    organizerEmail: estimate.organizerEmail,
    templateFilename: filename,
    organizerInstructions,
    sheetNames,
    sourceMailFrom: sourceMail?.fromAddress ?? null,
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
  /**
   * 失敗した作成のやり直し。指定すると**その履歴行と Message-ID を使い回す**ので、
   * 「Yahoo には下書きができていたが応答が返らなかった」あとの再試行でも重複しない。
   */
  retryDraftId?: number | null
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
 * 生成に使える CellMap か。クライアントの CTA 無効化だけでは Server Action の
 * 防御にならないので、二重記入・全件重複になる形をここでも拒否する。
 */
const COLUMN_LETTER_RE = /^[A-Z]{1,3}$/
const CELL_ADDRESS_RE = /^[A-Z]{1,3}[1-9][0-9]*$/
/** 実物テンプレの明細行はせいぜい数百行。桁違いの開始行は入力ミスとして弾く。 */
const MAX_START_ROW = 10000

/**
 * CellMap を実際の Workbook と突き合わせて検証する。
 *
 * クライアントは列を自由入力できるので、`F12` のような「列＋行」を列として
 * 送られると `F1212` に書いてしまう（正常終了したまま誤配置の申込書ができる）。
 * 同じ列に2項目を割り当てると後勝ちで上書きされる。どちらも成功として返るため、
 * 生成の手前で弾く。
 */
function assertCellMapMatchesWorkbook(cellMap: CellMap, workbook: ExcelJS.Workbook): void {
  const sheetNames = new Set(workbook.worksheets.map((ws) => ws.name))
  for (const sheet of cellMap.sheets) {
    if (!sheetNames.has(sheet.sheetName)) {
      throw new Error(`シート「${sheet.sheetName}」が申込書にありません`)
    }
    if (!Number.isInteger(sheet.startRow) || sheet.startRow < 1 || sheet.startRow > MAX_START_ROW) {
      throw new Error(`シート「${sheet.sheetName}」の記入開始行が不正です: ${sheet.startRow}`)
    }

    const usedColumns = new Map<string, string>()
    for (const [field, column] of Object.entries(sheet.columns)) {
      if (column == null) continue
      if (!COLUMN_LETTER_RE.test(column)) {
        throw new Error(
          `シート「${sheet.sheetName}」の「${field}」に列以外が指定されています: ${column}（A・B・AA のように列だけを指定してください）`,
        )
      }
      const taken = usedColumns.get(column)
      if (taken) {
        throw new Error(
          `シート「${sheet.sheetName}」の ${column} 列に複数の項目（${taken} / ${field}）が割り当てられています`,
        )
      }
      usedColumns.set(column, field)
    }

    for (const [field, address] of Object.entries(sheet.headerCells)) {
      if (address != null && !CELL_ADDRESS_RE.test(address)) {
        throw new Error(
          `シート「${sheet.sheetName}」の「${field}」の記入先セルが不正です: ${address}`,
        )
      }
    }

    const hasName =
      Boolean(sheet.columns.fullName) ||
      Boolean(sheet.columns.familyName && sheet.columns.givenName)
    if (!hasName) {
      throw new Error(
        `シート「${sheet.sheetName}」の氏名の列が指定されていません（「氏名」または「姓」と「名」）`,
      )
    }
  }
}

function assertCellMapUsable(cellMap: CellMap): void {
  if (cellMap.sheets.length === 0) {
    throw new Error('記入するシートが指定されていません')
  }
  if (cellMap.sheets.length > 1) {
    const unresolved = cellMap.sheets.filter((s) => s.targetGrades === null)
    if (unresolved.length > 0) {
      throw new Error(
        `対象の級が決まっていないシートがあります（${unresolved.map((s) => s.sheetName).join('・')}）。全員が全シートに重複して記入されます`,
      )
    }
    const seen = new Map<string, number>()
    for (const sheet of cellMap.sheets) {
      for (const grade of sheet.targetGrades ?? []) {
        seen.set(grade, (seen.get(grade) ?? 0) + 1)
      }
    }
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([g]) => g)
    if (duplicated.length > 0) {
      throw new Error(
        `${duplicated.map((g) => `${g}級`).join('・')}が複数のシートに割り当てられています。同じ会員が2枚に記入されます`,
      )
    }
  }
}

/**
 * `appending` の claim を保持できる時間。IMAP の APPEND は数秒で終わるので、
 * これを超えて残っている行は「処理が落ちた」とみなして回収してよい。
 */
const APPEND_LEASE_MS = 5 * 60 * 1000

/**
 * 再試行の対象行を**原子的に claim** する（このグループの未確定/失敗行に限る）。
 *
 * `status` を条件に含めた UPDATE ... RETURNING なので、同じ行に対する同時再試行の
 * うち1つだけが行を得る。取れなかった側は IMAP へ進まない——SEARCH→APPEND は
 * 接続をまたいだ原子操作にならず、両方が「未存在」と判断すると同じ Message-ID の
 * 下書きが2通できる。
 */
async function claimRetryTarget(
  groupId: number,
  draftId: number,
): Promise<{ id: number; messageId: string } | null> {
  // `appending` のまま取り残された行（プロセス停止・状態更新の失敗）も、リースが
  // 切れていれば同じ行・同じ Message-ID で回収する。回収できないと利用者は
  // 「再作成」で新しい Message-ID を振るしかなく、1通目が成功していた場合に
  // Yahoo の下書きが重複する。
  const leaseDeadline = new Date(Date.now() - APPEND_LEASE_MS)
  const [row] = await db
    .update(entryFormDrafts)
    .set({ status: 'appending', imapError: null, appendStartedAt: new Date() })
    .where(
      and(
        eq(entryFormDrafts.id, draftId),
        eq(entryFormDrafts.entryGroupId, groupId),
        or(
          inArray(entryFormDrafts.status, ['pending', 'imap_failed']),
          and(
            eq(entryFormDrafts.status, 'appending'),
            lt(entryFormDrafts.appendStartedAt, leaseDeadline),
          ),
        ),
      ),
    )
    .returning({ id: entryFormDrafts.id, messageId: entryFormDrafts.messageId })
  return row ?? null
}

/**
 * プレビュー確定 → 下書き作成。
 *
 * 順序は requirements §3.2.7 で固定: xlsx 記入 → **履歴を保存（pending）** →
 * MIME 組立 → IMAP APPEND → status 更新。履歴を APPEND の前に保存するのは、
 * Yahoo への書き込みが失敗してもプレビューで編集した値と生成済み xlsx を
 * 失わないため。`created` ではなく `pending` で入れるのは、挿入から更新までの
 * 間にプロセスが落ちたときに「下書きが無いのに成功」の嘘を残さないため。
 */
export async function createEntryFormDraftAction(
  input: CreateEntryFormDraftInput,
): Promise<CreateEntryFormDraftResult> {
  const session = await requireAdminSession()

  // 空の申込書は作らない（requirements のエラーケース）。クライアントの CTA だけでは
  // Server Action 境界の防御にならないのでここでも拒否する。
  if (input.members.length === 0) {
    throw new Error('記入する会員が0名です。会員を追加してから作成してください')
  }

  assertCellMapUsable(input.cellMap)

  const settings = await getEntryFormSettings()
  if (!settings.email || settings.email.trim().length === 0) {
    throw new Error(
      '差出人になる連絡先 E-Mail が未設定です。設定 > 申込書設定 で登録してください',
    )
  }

  const { workbook } = await readTemplate(
    input.groupId,
    input.attachmentId ?? null,
    input.uploaded ?? null,
  )
  assertCellMapMatchesWorkbook(input.cellMap, workbook)

  const filled = await fillEntryForm(workbook, input.cellMap, {
    members: input.members,
    constants: settings,
  })

  // 再試行では同じ行と同じ Message-ID を使い回す。新しい Message-ID を振ると、
  // 「APPEND は成功したが応答が返らなかった」ケースで下書きが重複する。
  let reused: { id: number; messageId: string } | null = null
  if (input.retryDraftId != null) {
    reused = await claimRetryTarget(input.groupId, input.retryDraftId)
    if (!reused) {
      throw new Error(
        'この下書きは作成処理の実行中か、既に作成済みです。画面を再読み込みして状態を確認してください',
      )
    }
  }
  const messageId = reused?.messageId ?? buildDraftMessageId(settings.email)

  // MIME の組立（＝宛先・差出人の検証）は履歴保存より前に行う。入力ミスを
  // imap_failed として記録してしまうと、失敗画面からは直せず作成を完了できない。
  const mime = buildDraftMime(
    {
      from: settings.email,
      to: input.toEmail,
      subject: input.subject,
      bodyText: input.body,
      attachment: {
        filename: input.attachmentFilename,
        contentType: XLSX_CONTENT_TYPE,
        data: filled.buffer,
      },
    },
    { messageId },
  )

  const values = {
    entryGroupId: input.groupId,
    createdBy: session.user.id,
    toEmail: input.toEmail,
    subject: input.subject,
    body: input.body,
    attachmentFilename: input.attachmentFilename,
    xlsx: filled.buffer,
    memberCount: input.members.length,
    messageId,
    // 新規行も appending で入れる（この時点で APPEND へ進むため）。プロセスが
    // 落ちた行は appending のまま残るが、リース期限を過ぎれば回収できる。
    status: 'appending' as const,
    imapError: null,
    appendStartedAt: new Date(),
  }

  let draftId: number
  if (reused) {
    await db.update(entryFormDrafts).set(values).where(eq(entryFormDrafts.id, reused.id))
    draftId = reused.id
  } else {
    const [saved] = await db
      .insert(entryFormDrafts)
      .values(values)
      .returning({ id: entryFormDrafts.id })
    if (!saved) throw new Error('作成履歴の保存に失敗しました')
    draftId = saved.id
  }

  const result: CreateEntryFormDraftResult = {
    draftId,
    status: 'created',
    imapError: null,
    unassignedCount: filled.unassignedMembers.length,
    overflowCount: filled.overflow.reduce((sum, o) => sum + o.members.length, 0),
  }

  let appended = false
  try {
    await appendDraftToYahoo(mime, { messageId, requireIdempotencyCheck: reused != null })
    appended = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(entryFormDrafts)
      .set({ status: 'imap_failed', imapError: message })
      .where(eq(entryFormDrafts.id, draftId))
      // 状態更新に失敗しても pending のまま残る。「失敗」を記録できないことは
      // 再試行を止める理由にならないので、ここでは握り潰して結果だけ返す。
      .catch(() => undefined)
    result.status = 'imap_failed'
    result.imapError = message
  }

  if (appended) {
    // APPEND は確認できている。この更新が落ちても行は pending のまま——
    // imap_failed にしてはいけない（再試行で Yahoo の下書きが重複する）。
    try {
      await db
        .update(entryFormDrafts)
        .set({ status: 'created' })
        .where(eq(entryFormDrafts.id, draftId))
    } catch {
      // 握り潰す。利用者には成功として返し、履歴だけが pending で残る
      // （「下書きはあるが記録が確定していない」= 進行管理では成功と表示しない）。
    }
  }

  revalidatePath(`/admin/entry-form/${input.groupId}`)
  return result
}
