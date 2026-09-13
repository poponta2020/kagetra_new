import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import * as schema from '../schema'
import { mailWorkerJobs, resultDrafts } from '../schema'

/**
 * tournament-results 2026-09-13 改修 — 受信箱の「取込中は消す → 承認待ちで復活」判定。
 *
 * ★このファイルは `docs/audits/senseki-boundary-audit.md` の物理削除対象
 * （配布版から統計・戦績ドメインを切り離す際に丸ごと削除する）。結果取込
 * （`result_drafts` / `result_parse` ジョブ）の知識をここ1本に閉じてあるので、
 * 削除は次の2箇所を外すだけで完結する:
 *   1. `unprocessed-mails.ts` の `import { loadInFlightResultImportMailIds } from
 *      './result-import-visibility'`
 *   2. 同ファイル `countUnprocessedMails` 内の 1 行（`hiddenMailIds` を `[]` にする）
 * 削除後、未処理件数は素の `triage_status != 'processed'` に、一覧は除外なしの
 * 現行挙動へ縮退する（要件 §6「単一定義」「削除すると空集合で縮退」）。
 * 「残す」側からの依存なので `apps/mail-worker/src/result-import/` へは import を張らない
 * （監査 AC-8）。
 *
 * 判定は既存テーブルからの導出のみで行う（マイグレーション無し。要件 §6）:
 *   - 取込中   = `mail_worker_jobs` が `kind='result_parse'` かつ未終端
 *                （`pending` / `claimed`）で、`requested_at` が 30 分以内
 *   - 滞留     = 同ジョブが未終端のまま 30 分を超え、かつ要求より後に
 *                `result_drafts` が書かれていない
 * 30 分の基準時刻は `requested_at`。stale-claim recovery は `claimed → pending` へ
 * 戻すだけで `requested_at` を変えないため、クラッシュループ中のジョブでも必ず復活する。
 */

/**
 * web（`drizzle(pool)`）と mail-worker（`DbClient | DbTransaction`）のどちらの
 * ハンドルも受ける。`apps/web/src/lib/mail-history.queries.ts` の `DbLike` と同趣旨だが、
 * mail-worker の `notify*` 系はトランザクションハンドルを渡しうるので union で受ける。
 */
export type ResultImportDbLike =
  | NodePgDatabase<typeof schema>
  | PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>

/** 取込中とみなす猶予。超えたら「取込が進んでいません」側へ倒す（要件 §3.6）。 */
export const RESULT_IMPORT_INFLIGHT_WINDOW_MS = 30 * 60 * 1000

export interface ResultImportVisibilityOptions {
  /** 基準時刻。テストで境界を固定するために注入する。既定は現在時刻。 */
  now?: Date
  /** 取込中とみなす猶予（ms）。既定は {@link RESULT_IMPORT_INFLIGHT_WINDOW_MS}。 */
  windowMs?: number
}

/** 「対応不要」を出せない理由。null なら結果取込は dismiss を妨げない。 */
export type ResultImportDismissBlock = 'in_flight' | 'pending_review' | 'parse_failed'

/**
 * 「対応不要」を塞ぐ結果ドラフトの状態。承認待ち・取込失敗を処理済みにすると
 * ドラフトが未処理キューから消えて宙に浮く（要件 §3.6「対応不要」のガード）。
 */
export const RESULT_IMPORT_DISMISS_BLOCKING_DRAFT_STATUSES = [
  'pending_review',
  'parse_failed',
] as const

const OPEN_JOB_STATUSES = ['pending', 'claimed'] as const

function resolveCutoff(opts: ResultImportVisibilityOptions | undefined): Date {
  const now = opts?.now ?? new Date()
  const windowMs = opts?.windowMs ?? RESULT_IMPORT_INFLIGHT_WINDOW_MS
  return new Date(now.getTime() - windowMs)
}

interface OpenJob {
  mailId: number
  requestedAt: Date
}

/**
 * 未終端（`pending` / `claimed`）の `result_parse` ジョブを、メールごとの
 * **最新の要求時刻**に畳んで返す。同一メールに複数ジョブがあっても 1 エントリ。
 *
 * `payload->>'mail_message_id'` の引き当ては `triggerResultParse` /
 * `roster_parse` の重複ジョブ検出と同形（payload は常に JSON number）。
 */
async function loadLatestOpenResultParseJobs(
  dbc: ResultImportDbLike,
): Promise<Map<number, Date>> {
  const rows = await dbc
    .select({
      mailId: sql<number | null>`(${mailWorkerJobs.payload}->>'mail_message_id')::int`,
      requestedAt: mailWorkerJobs.requestedAt,
    })
    .from(mailWorkerJobs)
    .where(
      and(
        eq(mailWorkerJobs.kind, 'result_parse'),
        inArray(mailWorkerJobs.status, [...OPEN_JOB_STATUSES]),
      ),
    )

  const latest = new Map<number, Date>()
  for (const row of rows) {
    const mailId = row.mailId
    if (mailId == null) continue
    const current = latest.get(mailId)
    if (current == null || row.requestedAt > current) latest.set(mailId, row.requestedAt)
  }
  return latest
}

function splitByWindow(
  latest: Map<number, Date>,
  cutoff: Date,
): { inFlight: number[]; stale: OpenJob[] } {
  const inFlight: number[] = []
  const stale: OpenJob[] = []
  for (const [mailId, requestedAt] of latest) {
    if (requestedAt >= cutoff) inFlight.push(mailId)
    else stale.push({ mailId, requestedAt })
  }
  return { inFlight, stale }
}

/**
 * 取込中（＝一覧から消す）メールの id 集合。
 *
 * 未終端ジョブでも要求から 30 分を超えたものは**含めない** — ここで含めてしまうと
 * mail-worker 停止時にメールが一覧から消えたまま戻らなくなる（要件 §3.6 / AC-27）。
 * 該当ゼロなら空配列。呼び出し側は空配列のとき `notInArray` 句ごと落とすこと
 * （drizzle は空配列で壊れる）。
 */
export async function loadInFlightResultImportMailIds(
  dbc: ResultImportDbLike,
  opts?: ResultImportVisibilityOptions,
): Promise<number[]> {
  const latest = await loadLatestOpenResultParseJobs(dbc)
  if (latest.size === 0) return []
  return splitByWindow(latest, resolveCutoff(opts)).inFlight
}

/**
 * 滞留（＝「取込が進んでいません」警告を出す）メールの id 集合。
 *
 * 未終端のまま 30 分を超えたジョブが対象だが、**要求より後に `result_drafts` が
 * 書かれていれば除外**する（AC-39: worker がドラフトだけ書いてジョブの終端化に
 * 失敗した場合、滞留ではなくドラフトの状態を出す）。取込中のメールも当然除外される
 * （最新要求が窓内なら滞留候補にならない = 表示優先順位①）。
 */
export async function loadStalledResultImportMailIds(
  dbc: ResultImportDbLike,
  opts?: ResultImportVisibilityOptions,
): Promise<number[]> {
  const latest = await loadLatestOpenResultParseJobs(dbc)
  if (latest.size === 0) return []
  const { stale } = splitByWindow(latest, resolveCutoff(opts))
  if (stale.length === 0) return []

  const draftRows = await dbc
    .select({ messageId: resultDrafts.messageId, updatedAt: resultDrafts.updatedAt })
    .from(resultDrafts)
    .where(
      inArray(
        resultDrafts.messageId,
        stale.map((job) => job.mailId),
      ),
    )
  const draftUpdatedAt = new Map(draftRows.map((row) => [row.messageId, row.updatedAt]))

  return stale
    .filter((job) => {
      const updatedAt = draftUpdatedAt.get(job.mailId)
      return updatedAt == null || updatedAt <= job.requestedAt
    })
    .map((job) => job.mailId)
}

/**
 * 「対応不要」を塞ぐかどうかの**唯一の規則**。一覧（表示条件）とサーバーガード
 * （`dismissMail`）の両方がこれを通す — 片側だけ厳しい状態になると、画面に出ない
 * ボタンが API では通る / その逆が起きる。
 */
export function resultImportBlocksDismiss(input: {
  /** そのメールの `result_drafts.status`。ドラフトが無ければ null。 */
  draftStatus: string | null | undefined
  /** そのメールに取込中の `result_parse` ジョブがあるか。 */
  inFlight: boolean
}): boolean {
  if (input.inFlight) return true
  if (input.draftStatus == null) return false
  return (RESULT_IMPORT_DISMISS_BLOCKING_DRAFT_STATUSES as readonly string[]).includes(
    input.draftStatus,
  )
}

/**
 * 1 メールに取込中の `result_parse` ジョブがあるか。読み取り専用（行ロックしない）ので
 * 画面の描画条件から呼んでよい。
 */
export async function hasInFlightResultImportJob(
  dbc: ResultImportDbLike,
  mailId: number,
  opts?: ResultImportVisibilityOptions,
): Promise<boolean> {
  const jobRows = await dbc
    .select({ id: mailWorkerJobs.id })
    .from(mailWorkerJobs)
    .where(
      and(
        eq(mailWorkerJobs.kind, 'result_parse'),
        inArray(mailWorkerJobs.status, [...OPEN_JOB_STATUSES]),
        sql`${mailWorkerJobs.payload}->>'mail_message_id' = ${String(mailId)}`,
        gte(mailWorkerJobs.requestedAt, resolveCutoff(opts)),
      ),
    )
    .limit(1)
  return jobRows.length > 0
}

/**
 * サーバーガード用。1 メールについて「対応不要」を塞ぐ理由を返す（塞がないなら null）。
 *
 * `dismissMail` のトランザクション内から呼ぶ想定で、`result_drafts` は
 * 既存の `tournament_drafts` ガードと同じく `FOR UPDATE` で直列化する。
 * 判定そのものは {@link resultImportBlocksDismiss} に委ねる（画面と同じ規則）。
 */
export async function loadResultImportDismissBlock(
  dbc: ResultImportDbLike,
  mailId: number,
  opts?: ResultImportVisibilityOptions,
): Promise<ResultImportDismissBlock | null> {
  const draftRows = await dbc
    .select({ status: resultDrafts.status })
    .from(resultDrafts)
    .where(eq(resultDrafts.messageId, mailId))
    .for('update')
  const draftStatus = draftRows[0]?.status ?? null

  const inFlight = await hasInFlightResultImportJob(dbc, mailId, opts)

  if (!resultImportBlocksDismiss({ draftStatus, inFlight })) return null
  if (inFlight) return 'in_flight'
  return draftStatus as ResultImportDismissBlock
}
