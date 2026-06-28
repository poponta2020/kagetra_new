import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import { tournamentSeries, tournamentSeriesEditions } from '@kagetra/shared/schema'

/**
 * tournament-entry-rosters PR-2: edition 解決コア（flow①=案内承認 / flow②=結果取込 共通）。
 *
 * 大会名（例「第27回こばえちゃ山形酒田大会C級」）から
 *   - 回次（第N回）をパース
 *   - 系列名候補（第N回・級サフィックスを除いた残り）を抽出
 *   - tournament_series（name＋aliases）へ名寄せ
 *   - 開催（edition）を解決 or 新規作成（UNIQUE(series_id, edition_number)＋親行 FOR UPDATE）
 * を行う。**名寄せは 100% 自動にしない**（要件 §3.1）。auto 解決は「正規化完全一致かつ
 * 単独最良」のときだけ link し、それ以外は候補提示にとどめる。flow①（管理者確認 UI）は
 * 選んだ series + 回次で {@link findOrCreateEdition} を直接呼ぶ。
 */

// Works for both NodePgDatabase (main db) and the tx handle inside a transaction.
type DbLike = NodePgDatabase<typeof schema>

export type TournamentStatus = 'held' | 'cancelled' | 'unconfirmed'

export interface SeriesRow {
  id: number
  name: string
  aliases: string[]
  kind: 'individual' | 'team'
}

export interface SeriesCandidate {
  series: SeriesRow
  /** 100 = 正規化完全一致（name か alias）, 50 = 部分一致（包含）, それ未満は候補外。 */
  score: number
}

/** 完全一致とみなすスコア（auto 解決の閾値）。 */
export const EXACT_MATCH_SCORE = 100
const CONTAINS_MATCH_SCORE = 50

/**
 * マッチング用の正規化。NFKC で全角/半角・互換文字を畳み、空白と一般的な区切り/装飾を
 * 除去する。人名ではなく大会系列名向けの専用正規化（normalizePlayerName とは別物）。
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    // 区切り・装飾（中黒/読点/ハイフン/各種カッコ/星印など）。系列名の実体には影響しない。
    .replace(/[・･,，、.。\-―ー~〜‐-―（）()「」『』【】［］\[\]★☆◎○●◆■]/g, '')
    .toLowerCase()
}

/**
 * 大会名から回次（第N回）を抜き出す。全角数字は NFKC で半角化してから拾う。無ければ null。
 */
export function parseEditionNumber(name: string): number | null {
  const m = name.normalize('NFKC').match(/第\s*(\d{1,4})\s*回/)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 大会名から「系列名候補」を取り出す。第N回 と 末尾の級サフィックス（A級 / A・B級 /
 * (A〜C級) 等）を落とした残り。マッチングはこの結果を {@link normalizeForMatch} に通して行う。
 */
export function parseSeriesName(name: string): string {
  let s = name.normalize('NFKC').trim()
  // 「第N回」（前後の空白込み）を除去。
  s = s.replace(/第\s*\d{1,4}\s*回/g, '')
  // 末尾の級サフィックスを除去。例: "A級" "A・B級" "A,B級" "A〜C級" "（A級）" "B級の部"。
  // 1 文字級（A〜E）が区切り/範囲記号で連なり「級」で締める塊を末尾から剥がす。
  s = s.replace(
    /[\s　（(]*[A-EＡ-Ｅ](?:\s*[・･,，、〜~\-―ー]?\s*[A-EＡ-Ｅ])*\s*級(?:の部)?[\s　）)]*$/u,
    '',
  )
  return s.trim()
}

/**
 * 解析結果（回次＋系列名候補）。
 */
export interface ParsedAnnouncementName {
  editionNumber: number | null
  seriesNameGuess: string
}

export function parseAnnouncementName(name: string): ParsedAnnouncementName {
  return {
    editionNumber: parseEditionNumber(name),
    seriesNameGuess: parseSeriesName(name),
  }
}

/**
 * 系列名候補 1 つを既存 series 群に対してスコアリングする（DB アクセスなし・テスト容易）。
 * name と全 aliases を正規化比較し、完全一致 100 / 包含 50 / それ以外 0。
 */
export function scoreSeries(seriesNameGuess: string, series: SeriesRow): number {
  const guess = normalizeForMatch(seriesNameGuess)
  if (!guess) return 0
  const targets = [series.name, ...(series.aliases ?? [])].map(normalizeForMatch).filter(Boolean)
  let best = 0
  for (const t of targets) {
    if (t === guess) return EXACT_MATCH_SCORE
    if (t.includes(guess) || guess.includes(t)) best = Math.max(best, CONTAINS_MATCH_SCORE)
  }
  return best
}

/**
 * 系列名候補に対する series 候補一覧（スコア降順）。UI はこれを使って最良を pre-select しつつ
 * 全件から選び直せるようにする。
 */
export function rankSeriesCandidates(
  seriesNameGuess: string,
  allSeries: SeriesRow[],
): SeriesCandidate[] {
  return allSeries
    .map((series) => ({ series, score: scoreSeries(seriesNameGuess, series) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.series.name.localeCompare(b.series.name))
}

/** 全 series を読み込む（180 件規模なので JS 側スコアリングで十分）。 */
export async function loadAllSeries(tx: DbLike): Promise<SeriesRow[]> {
  const rows = await tx
    .select({
      id: tournamentSeries.id,
      name: tournamentSeries.name,
      aliases: tournamentSeries.aliases,
      kind: tournamentSeries.kind,
    })
    .from(tournamentSeries)
  return rows
}

export interface FindOrCreateEditionInput {
  seriesId: number
  editionNumber: number
  year?: number | null
  status: TournamentStatus
  rawName?: string | null
  sourceFiletype?: string | null
}

export interface FindOrCreateEditionResult {
  editionId: number
  created: boolean
}

/**
 * 開催（edition）を解決 or 新規作成する。caller の tx 内で実行する前提。
 *
 * 親 series 行を FOR UPDATE でロックしてから (series_id, edition_number) を探す → 無ければ
 * INSERT。並行で同じ edition を作ろうとした別 tx はこのロックで直列化され、ロック解放後に
 * 自分の SELECT で相手の行を拾う。万一の取りこぼしに備え INSERT は onConflictDoNothing で
 * UNIQUE(series_id, edition_number) 衝突を吸収し、衝突時は再 SELECT する（materialize の
 * player get-or-create と同型）。
 *
 * ライフサイクル昇格（Codex R2 should_fix）: 既存 edition が `unconfirmed`（flow① の案内時に
 * 作成）で、今回 `held`（flow② の結果取込）で解決された場合だけ `held` に確定する。あわせて
 * year/raw_name が未設定なら補完する（fill-if-empty・既存値は上書きしない）。それ以外の
 * status 遷移や既存値の上書きはしない（解決のみ）。
 */
export async function findOrCreateEdition(
  tx: DbLike,
  input: FindOrCreateEditionInput,
): Promise<FindOrCreateEditionResult> {
  // 親行ロックで同系列の edition 採番を直列化。
  await tx.execute(sql`SELECT id FROM tournament_series WHERE id = ${input.seriesId} FOR UPDATE`)

  const where = and(
    eq(tournamentSeriesEditions.seriesId, input.seriesId),
    eq(tournamentSeriesEditions.editionNumber, input.editionNumber),
  )

  const existing = await tx
    .select({
      id: tournamentSeriesEditions.id,
      status: tournamentSeriesEditions.status,
      year: tournamentSeriesEditions.year,
      rawName: tournamentSeriesEditions.rawName,
    })
    .from(tournamentSeriesEditions)
    .where(where)
    .limit(1)
  if (existing.length > 0) {
    const row = existing[0]!
    // unconfirmed → held のライフサイクル確定（結果取込時のみ）。
    if (input.status === 'held' && row.status === 'unconfirmed') {
      await tx
        .update(tournamentSeriesEditions)
        .set({
          status: 'held',
          // year/raw_name は未設定のときだけ補完（既存値は尊重）。
          year: row.year ?? input.year ?? null,
          rawName: row.rawName ?? input.rawName ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(tournamentSeriesEditions.id, row.id))
    }
    return { editionId: row.id, created: false }
  }

  const inserted = await tx
    .insert(tournamentSeriesEditions)
    .values({
      seriesId: input.seriesId,
      editionNumber: input.editionNumber,
      year: input.year ?? null,
      status: input.status,
      rawName: input.rawName ?? null,
      sourceFiletype: input.sourceFiletype ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: tournamentSeriesEditions.id })
  if (inserted.length > 0) return { editionId: inserted[0]!.id, created: true }

  const reselect = await tx
    .select({ id: tournamentSeriesEditions.id })
    .from(tournamentSeriesEditions)
    .where(where)
    .limit(1)
  return { editionId: reselect[0]!.id, created: false }
}

export interface FindOrCreateSeriesInput {
  /** 表示・保存する系列名（新規作成時の name）。 */
  name: string
  kind?: 'individual' | 'team'
  /**
   * 一致する既存系列が無いとき新規作成を許可するか。**管理者が「新規系列として作成」を明示
   * 確認したときだけ true**（要件 §3.1 新規系列は確認必須）。false（既定）で未一致なら throw。
   */
  allowCreate?: boolean
}

export interface FindOrCreateSeriesResult {
  seriesId: number
  created: boolean
}

/**
 * 系列を正規化名寄せで解決する。曖昧性の扱いを suggest/auto と揃える（Codex R3 blocker）:
 *   - 完全一致が **単独** → その既存 series を返す。
 *   - 完全一致が **複数**（name と他 series の alias 衝突等）→ throw（先頭候補へ silent 解決しない）。
 *   - 完全一致 **なし** → `allowCreate` が true のときだけ新規作成。false なら throw。
 *
 * name は UNIQUE なので INSERT は onConflictDoNothing → 再 SELECT で確定。
 */
export async function findOrCreateSeries(
  tx: DbLike,
  input: FindOrCreateSeriesInput,
): Promise<FindOrCreateSeriesResult> {
  const all = await loadAllSeries(tx)
  const ranked = rankSeriesCandidates(input.name, all)
  const exact = ranked.filter((c) => c.score >= EXACT_MATCH_SCORE)
  if (exact.length === 1) return { seriesId: exact[0]!.series.id, created: false }
  if (exact.length > 1) {
    throw new Error(
      `系列名「${input.name}」が複数の既存系列に一致します。系列を特定できません（手動で選択してください）`,
    )
  }
  // 完全一致なし。新規作成は明示確認があるときだけ。
  if (!input.allowCreate) {
    throw new Error(
      `系列名「${input.name}」に一致する既存系列がありません。新規系列として作成する場合は明示的に指定してください`,
    )
  }

  const inserted = await tx
    .insert(tournamentSeries)
    .values({ name: input.name.trim(), kind: input.kind ?? 'individual' })
    .onConflictDoNothing()
    .returning({ id: tournamentSeries.id })
  if (inserted.length > 0) return { seriesId: inserted[0]!.id, created: true }

  const reselect = await tx
    .select({ id: tournamentSeries.id })
    .from(tournamentSeries)
    .where(eq(tournamentSeries.name, input.name.trim()))
    .limit(1)
  return { seriesId: reselect[0]!.id, created: false }
}

export interface EditionSuggestion {
  /** UI に pre-fill する系列名。既存に完全一致すればその正準名、無ければ解析した候補名。 */
  seriesName: string
  editionNumber: number | null
  /** 既存 series に完全一致したか（UI の文言出し分け用）。 */
  matched: boolean
}

/**
 * 大会名から flow① 確認 UI 用の pre-fill 候補を作る（**副作用なし**＝edition/series を作らない）。
 * 既存 series に正規化完全一致すればその正準名を、無ければ解析した系列名候補をそのまま返す。
 */
export async function suggestEditionFromName(
  tx: DbLike,
  rawName: string,
): Promise<EditionSuggestion> {
  const { editionNumber, seriesNameGuess } = parseAnnouncementName(rawName)
  const all = await loadAllSeries(tx)
  const ranked = rankSeriesCandidates(seriesNameGuess, all)
  // Codex R2 should_fix: 完全一致が **単独** のときだけ matched=true（自動 ON）。複数 exact
  // （alias 衝突等）は曖昧として matched=false にし、管理者に明示確認させる（autoResolveEdition
  // の ambiguous 扱いと挙動を揃える）。
  const exact = ranked.filter((c) => c.score >= EXACT_MATCH_SCORE)
  const uniqueExact = exact.length === 1 ? exact[0]! : null
  return {
    seriesName: uniqueExact ? uniqueExact.series.name : seriesNameGuess,
    editionNumber,
    matched: uniqueExact != null,
  }
}

export interface AutoResolveInput {
  rawName: string
  year?: number | null
  status: TournamentStatus
  sourceFiletype?: string | null
}

export interface AutoResolveResult {
  editionId: number | null
  seriesId: number | null
  editionNumber: number | null
  /** 自動 link したか（完全一致かつ単独最良で edition を確定したとき true）。 */
  linked: boolean
  /** UI 提示用の候補（スコア降順）。 */
  candidates: SeriesCandidate[]
  /** link/未 link の理由（'linked' | 'no-edition-number' | 'no-match' | 'ambiguous'）。 */
  reason: 'linked' | 'no-edition-number' | 'no-match' | 'ambiguous'
}

/**
 * 大会名から best-effort で edition を自動解決する（flow②=結果取込で使用）。
 *
 * **保守的**: 系列が「正規化完全一致かつ単独最良（同点なし）」で、かつ回次が取れたときだけ
 * find-or-create して link する。曖昧・新規系列・回次不明は link せず candidates を返す
 * （誤った大会への紐付けを避ける＝要件 §3.4）。新規 series は auto では作らない。
 */
export async function autoResolveEdition(
  tx: DbLike,
  input: AutoResolveInput,
): Promise<AutoResolveResult> {
  const { editionNumber, seriesNameGuess } = parseAnnouncementName(input.rawName)
  const all = await loadAllSeries(tx)
  const candidates = rankSeriesCandidates(seriesNameGuess, all)

  if (editionNumber == null) {
    return { editionId: null, seriesId: null, editionNumber: null, linked: false, candidates, reason: 'no-edition-number' }
  }
  const exact = candidates.filter((c) => c.score >= EXACT_MATCH_SCORE)
  if (exact.length === 0) {
    return { editionId: null, seriesId: null, editionNumber, linked: false, candidates, reason: 'no-match' }
  }
  if (exact.length > 1) {
    // 同一正規化名の系列が複数（理論上 UNIQUE(name) で起きにくいが alias 経由などで衝突しうる）。
    return { editionId: null, seriesId: exact[0]!.series.id, editionNumber, linked: false, candidates, reason: 'ambiguous' }
  }
  const seriesId = exact[0]!.series.id
  const { editionId } = await findOrCreateEdition(tx, {
    seriesId,
    editionNumber,
    year: input.year ?? null,
    status: input.status,
    rawName: input.rawName,
    sourceFiletype: input.sourceFiletype ?? null,
  })
  return { editionId, seriesId, editionNumber, linked: true, candidates, reason: 'linked' }
}
