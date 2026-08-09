import { and, desc, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { mailAttachments, mailMessages } from '@kagetra/shared/schema'

/**
 * member-mail-search タスク2: 会員向け受信メール検索（`/mail`）のクエリ層。
 * requirements.md §3.3・design-spec.md §3/§6/§8。
 *
 * 検索対象は件名・差出人（表示名/アドレス）・本文・添付ファイル名・添付抽出テキストの
 * 6フィールド（AC-4）。空白区切りの複数語は AND（AC-5）。添付側のヒットは
 * `EXISTS` サブクエリで表現し、添付数ぶんメール行が重複しないようにする。
 *
 * `mail_attachments.data`（bytea・85MB）は一切 projection に含めない（AC-28）。
 * `buildMailListSelectQuery` / `buildAttachmentsSelectQuery` を分けて export しているのは
 * 「`.toSQL()` で SELECT 句に `"data"` が出ないこと」を実行せずに検証できるようにするため
 * （実データを見るだけでは bytea 列を取り漏らしたバグに気付けない）。
 */

export interface MailSearchParams {
  /** 生のキーワード入力。空白区切りの複数語は AND。空文字・空白のみ = 絞り込みなし。 */
  q?: string
  /** 添付ありのみ */
  attachmentsOnly?: boolean
  limit: number
  offset: number
}

export interface MailSearchAttachment {
  id: number
  filename: string
  contentType: string
  sizeBytes: number
  extractionStatus: 'pending' | 'extracted' | 'failed' | 'unsupported'
}

/** 件名以外でヒットしたときだけ付く抜粋。 */
export interface MailSearchExcerpt {
  source: 'body' | 'attachment'
  /** source='attachment' のとき当該添付のファイル名。'body' のとき null。 */
  attachmentFilename: string | null
  /**
   * ヒット位置の前後を切り出した抜粋。ファイル名だけが一致した場合は null
   * （出所表示だけで「どこで当たったか」は伝わるため）。
   */
  text: string | null
}

export interface MailSearchRow {
  id: number
  subject: string | null
  fromName: string | null
  fromAddress: string
  receivedAt: Date
  triageStatus: 'unprocessed' | 'processed'
  mailKind: string | null
  attachments: MailSearchAttachment[]
  /** 件名にいずれかの語が当たったか（一覧のハイライト判断用）。キーワード無しなら false。 */
  subjectMatched: boolean
  /** 件名以外で当たったときだけ非 null。 */
  excerpt: MailSearchExcerpt | null
}

export interface MailSearchResult {
  rows: MailSearchRow[]
  /** 絞り込み後の総件数（検索バーの「292 件」表示に使う）。 */
  total: number
}

const DEFAULT_LIMIT = 20

/** ILIKE のワイルドカード（% _ \）をエスケープし literal 扱いにする（players/queries.ts と同じ規約）。 */
function escapeLike(raw: string): string {
  return raw.replace(/([%_\\])/g, '\\$1')
}

/** 空白区切り（半角・全角スペース両方）でキーワードを分割。空語は捨てる。 */
function splitTerms(q: string | undefined): string[] {
  if (!q) return []
  return q.split(/[ \t\n\r　]+/).filter((t) => t.length > 0)
}

/**
 * 1語ぶんの OR 条件（件名・差出人名・差出人アドレス・本文・添付ファイル名・添付抽出テキスト）。
 * 添付側は EXISTS サブクエリでまとめ、添付が複数あるメールが重複してヒットしないようにする。
 */
function termCondition(term: string): SQL {
  const pattern = `%${escapeLike(term)}%`
  const attachmentMatch = db
    .select({ one: sql`1` })
    .from(mailAttachments)
    .where(
      and(
        eq(mailAttachments.mailMessageId, mailMessages.id),
        or(
          sql`${mailAttachments.filename} ILIKE ${pattern} ESCAPE '\\'`,
          sql`${mailAttachments.extractedText} ILIKE ${pattern} ESCAPE '\\'`,
        ),
      ),
    )
  return or(
    sql`${mailMessages.subject} ILIKE ${pattern} ESCAPE '\\'`,
    sql`${mailMessages.fromName} ILIKE ${pattern} ESCAPE '\\'`,
    sql`${mailMessages.fromAddress} ILIKE ${pattern} ESCAPE '\\'`,
    sql`${mailMessages.bodyText} ILIKE ${pattern} ESCAPE '\\'`,
    exists(attachmentMatch),
  )!
}

/** 「添付ありのみ」トグル用の EXISTS 条件。 */
function attachmentsExistCondition(): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(mailAttachments)
      .where(eq(mailAttachments.mailMessageId, mailMessages.id)),
  )
}

/** 検索条件（キーワード AND・添付ありのみ）から WHERE 句を組み立てる。条件が無ければ undefined。 */
function buildWhere(terms: string[], attachmentsOnly: boolean | undefined): SQL | undefined {
  const conds: SQL[] = terms.map(termCondition)
  if (attachmentsOnly) conds.push(attachmentsExistCondition())
  return conds.length > 0 ? and(...conds) : undefined
}

/**
 * メール本体の一覧クエリ（projection に `mail_attachments.data` を含まない）。
 * `where`/`limit`/`offset` を外から渡す形で export し、AC-28 の `.toSQL()` 検査から
 * `searchMemberMails` 本体と同じクエリ組み立てを再利用できるようにする。
 */
export function buildMailListSelectQuery(where: SQL | undefined, limit: number, offset: number) {
  return db
    .select({
      id: mailMessages.id,
      subject: mailMessages.subject,
      fromName: mailMessages.fromName,
      fromAddress: mailMessages.fromAddress,
      receivedAt: mailMessages.receivedAt,
      triageStatus: mailMessages.triageStatus,
      mailKind: mailMessages.mailKind,
      bodyText: mailMessages.bodyText,
    })
    .from(mailMessages)
    .where(where)
    .orderBy(desc(mailMessages.receivedAt), desc(mailMessages.id))
    .limit(limit)
    .offset(offset)
}

/**
 * ヒットしたメール ID 群に対する添付の一括取得クエリ（N+1 禁止）。projection に
 * `mail_attachments.data` を含まない。`extracted_text` はキーワードがあるとき
 * （`includeExtractedText`）だけ引く（抜粋生成に必要なため。無ければ無駄なので引かない）。
 * 添付の優先順位判定（extracted_text → filename）は呼び出し側が id 昇順で走査する前提な
 * ので、常に id 昇順で返す。
 */
export function buildAttachmentsSelectQuery(mailIds: number[], includeExtractedText: boolean) {
  if (includeExtractedText) {
    return db
      .select({
        id: mailAttachments.id,
        mailMessageId: mailAttachments.mailMessageId,
        filename: mailAttachments.filename,
        contentType: mailAttachments.contentType,
        sizeBytes: mailAttachments.sizeBytes,
        extractionStatus: mailAttachments.extractionStatus,
        extractedText: mailAttachments.extractedText,
      })
      .from(mailAttachments)
      .where(inArray(mailAttachments.mailMessageId, mailIds))
      .orderBy(mailAttachments.id)
  }
  return db
    .select({
      id: mailAttachments.id,
      mailMessageId: mailAttachments.mailMessageId,
      filename: mailAttachments.filename,
      contentType: mailAttachments.contentType,
      sizeBytes: mailAttachments.sizeBytes,
      extractionStatus: mailAttachments.extractionStatus,
    })
    .from(mailAttachments)
    .where(inArray(mailAttachments.mailMessageId, mailIds))
    .orderBy(mailAttachments.id)
}

/** text がいずれかの語を含むか（大文字小文字を区別しない）。 */
function containsAnyTerm(text: string | null | undefined, terms: string[]): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return terms.some((t) => lower.includes(t.toLowerCase()))
}

/**
 * ヒット抜粋を生成する純関数（単体テスト可能）。terms のうち最も早く出現する語の位置を
 * 基準に、前30文字・後90文字を切り出す（合計120文字を超えない）。前後が切れているときは
 * `…` を付ける。改行・タブ・連続空白は半角スペース1つに畳む。
 * ヒットが無ければ null。
 */
export function buildExcerpt(text: string, terms: string[]): string | null {
  if (!text || terms.length === 0) return null
  const lower = text.toLowerCase()
  let bestIndex = -1
  let bestLen = 0
  for (const term of terms) {
    const t = term.toLowerCase()
    if (!t) continue
    const idx = lower.indexOf(t)
    if (idx === -1) continue
    if (bestIndex === -1 || idx < bestIndex) {
      bestIndex = idx
      bestLen = term.length
    }
  }
  if (bestIndex === -1) return null

  const start = Math.max(0, bestIndex - 30)
  const end = Math.min(text.length, bestIndex + bestLen + 90)
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${snippet}${suffix}`
}

interface AttachmentRow {
  id: number
  mailMessageId: number
  filename: string
  contentType: string
  sizeBytes: number
  extractionStatus: MailSearchAttachment['extractionStatus']
  extractedText?: string | null
}

/**
 * `subjectMatched` / `excerpt` の決定規則（requirements.md §3.4 相当・design-spec §3・
 * list-normal.html ②で確定）。キーワード未入力なら subjectMatched=false・excerpt=null。
 *
 * excerpt の優先順位（最初に当たったものを採用）:
 *   1. 本文にヒット → source='body'
 *   2. 添付の抽出テキストにヒット（id 昇順） → source='attachment' + text
 *   3. 添付のファイル名にヒット（id 昇順） → source='attachment' + text:null
 *   4. どれも無い → null
 */
function deriveMatch(
  row: { subject: string | null; bodyText: string | null },
  attachments: AttachmentRow[],
  terms: string[],
): { subjectMatched: boolean; excerpt: MailSearchExcerpt | null } {
  if (terms.length === 0) return { subjectMatched: false, excerpt: null }

  const subjectMatched = containsAnyTerm(row.subject, terms)

  if (containsAnyTerm(row.bodyText, terms)) {
    return {
      subjectMatched,
      excerpt: {
        source: 'body',
        attachmentFilename: null,
        text: buildExcerpt(row.bodyText!, terms),
      },
    }
  }

  for (const a of attachments) {
    if (containsAnyTerm(a.extractedText, terms)) {
      return {
        subjectMatched,
        excerpt: {
          source: 'attachment',
          attachmentFilename: a.filename,
          text: buildExcerpt(a.extractedText!, terms),
        },
      }
    }
  }

  for (const a of attachments) {
    if (containsAnyTerm(a.filename, terms)) {
      return {
        subjectMatched,
        excerpt: { source: 'attachment', attachmentFilename: a.filename, text: null },
      }
    }
  }

  return { subjectMatched, excerpt: null }
}

/**
 * 会員向け受信メール検索（キーワード横断 AND・添付ありのみ絞り込み・ページング）。
 * 除外条件は一切設けない（`classification='noise'` も `triage_status='unprocessed'` も
 * `status` の値も対象。requirements.md §3.2・AC-9・AC-10）。
 */
export async function searchMemberMails(params: MailSearchParams): Promise<MailSearchResult> {
  const terms = splitTerms(params.q)
  const safeLimit =
    Number.isInteger(params.limit) && params.limit > 0 ? params.limit : DEFAULT_LIMIT
  const safeOffset = Number.isInteger(params.offset) && params.offset >= 0 ? params.offset : 0

  const where = buildWhere(terms, params.attachmentsOnly)

  const [mailRows, countRows] = await Promise.all([
    buildMailListSelectQuery(where, safeLimit, safeOffset),
    db.select({ n: sql<number>`count(*)::int` }).from(mailMessages).where(where),
  ])

  const mailIds = mailRows.map((r) => r.id)
  const attachmentRows: AttachmentRow[] =
    mailIds.length === 0 ? [] : await buildAttachmentsSelectQuery(mailIds, terms.length > 0)

  const attachmentsByMail = new Map<number, AttachmentRow[]>()
  for (const a of attachmentRows) {
    const arr = attachmentsByMail.get(a.mailMessageId)
    if (arr) arr.push(a)
    else attachmentsByMail.set(a.mailMessageId, [a])
  }

  const rows: MailSearchRow[] = mailRows.map((m) => {
    const atts = attachmentsByMail.get(m.id) ?? []
    const { subjectMatched, excerpt } = deriveMatch(m, atts, terms)
    return {
      id: m.id,
      subject: m.subject,
      fromName: m.fromName,
      fromAddress: m.fromAddress,
      receivedAt: m.receivedAt,
      triageStatus: m.triageStatus,
      mailKind: m.mailKind,
      attachments: atts.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        extractionStatus: a.extractionStatus,
      })),
      subjectMatched,
      excerpt,
    }
  })

  return { rows, total: countRows[0]?.n ?? 0 }
}
