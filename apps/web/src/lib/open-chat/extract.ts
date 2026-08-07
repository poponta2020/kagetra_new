/**
 * 大会オープンチャットの招待 URL 候補を、メール本文・添付テキストから
 * 決定的（AI なし）に抽出する（openchat-broadcast §3.2.2）。
 *
 * このモジュールは **純関数のみ**。以下を厳守する:
 * - `fetch` を呼ばない（AC-8。短縮 URL をサーバーで展開しないことの機械的な担保。
 *   短縮 URL は「未検証」印付きで候補に出し、管理者が自分で踏んで確かめる）
 * - `node:` import・`@kagetra/shared` / `drizzle-orm` / `@/lib/db` の import をしない
 *   （client からも import され得る leaf 制約。
 *   `apps/web/src/app/(app)/admin/mail-inbox/roster-adopt-utils.ts` 冒頭の注意と同じ罠）
 * - `Date.now()` / `new Date()` を読まない（サーバーが注入する既存規約）
 */

export type OpenChatCandidateSource = 'body' | 'attachment_text'
export type OpenChatGrade = 'A' | 'B' | 'C' | 'D' | 'E'

/** 抽出された候補 1 件。あくまで初期値で、確認画面で人が上書きできる（§3.2.4）。 */
export interface OpenChatCandidate {
  /** 正規化後の URL（クエリ文字列を含まない直リンク・短縮 URL そのまま、の2種）。 */
  url: string
  /** どこから見つかったか（QR は collect.ts が別途付与するため、ここでは body / attachment_text のみ）。 */
  sources: OpenChatCandidateSource[]
  /** true = 短縮 URL（サーバーで展開していない）。 */
  unverified: boolean
  grades: OpenChatGrade[] | null
  /** YYYY-MM-DD。呼び出し側が渡した groupEventDates に一致した場合のみ入る。 */
  eventDate: string | null
  password: string | null
}

export interface ExtractOpenChatCandidatesOptions {
  source: OpenChatCandidateSource
  /**
   * 申込グループ内の開催日（YYYY-MM-DD）一覧。本文中の `6/20` 形式は年が
   * 無いため、ここに含まれる月日と一致した場合だけ eventDate として採用する
   * （グループ外の日を誤って拾わないため。AC-17）。
   */
  groupEventDates: string[]
}

/** LINE openchat の招待トークンの実測桁数（feasibility.md のサンプル値が33文字）。 */
const TOKEN_LENGTH = 33

/**
 * Tier1: `line.me/ti/g2/<token>`（AC-1）と `line.me/R/ti/g2/<token>`（AC-4。
 * 旧来のグループ招待に使われる `/R/` 経由のリダイレクト形。末尾の `2` は
 * 無いこともあるため任意にしている）。
 */
const TIER1_URL_RE = /https?:\/\/line\.me\/(?:R\/)?ti\/g2?\/([A-Za-z0-9_-]+)/g

/** Tier2: 短縮 URL（未検証のまま候補に出す。AC-7）。短縮 URL は元々短く、
 * 76 桁の折り返しで割れることは実質無いため改行復元の対象にしない
 * （後述の理由により、むしろ復元を試みると事故になる）。 */
const TIER2_URL_RE =
  /https?:\/\/(?:www\.)?(?:x\.gd|ourl\.jp|lin\.ee|bit\.ly|tinyurl\.com)\/[A-Za-z0-9_-]+/g

/** URL 直前・直後を見る範囲（級・開催日・パスワードの推定用）。 */
const CONTEXT_BEFORE_LEN = 40
const CONTEXT_AFTER_LEN = 40

const GRADE_ORDER: OpenChatGrade[] = ['A', 'B', 'C', 'D', 'E']

/**
 * 全角英数記号 (U+FF01-FF5E) を半角へ、全角スペース (U+3000) を半角スペースへ
 * 変換する。「【Ｃ級】」の Ｃ を C に揃えるための前処理（AC-16）。
 * 【】自体は変換対象外（範囲外の記号）だが、級の判定には括弧の有無を問わないため
 * 変換不要（"C級" という並びが見つかればよい）。
 */
function normalizeFullWidth(text: string): string {
  return text
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
}

interface RawMatch {
  url: string
  /** 元テキスト上の開始位置（コンテキスト窓の計算に使う）。 */
  matchStart: number
  /** 元テキスト上の終了位置（改行復元でトークンが次行にまたがる場合はそこまで含む）。 */
  matchEnd: number
  unverified: boolean
}

/**
 * Tier1 の直リンクを抽出する。メール本文は 76 桁前後で折り返されるため、
 * トークンが改行を挟んで分断されることがある（実例 mail#208）。
 *
 * ★改行復元・長さ検証は「マッチ直後に改行が続き、かつその時点のトークンが
 * 規定の33文字に**満たない**とき」だけ行う（次の行の先頭から充当できる範囲
 * だけ食う）。逆に言うと、改行を挟まず `?` や空白・記号で自然に終端した
 * トークンは、TOKEN_LENGTH と一致しなくても候補から弾かない —
 * TOKEN_LENGTH は feasibility.md のサンプル1件からの推定値で実コーパス
 * 全体を検証したものではなく、ここで長さを強制すると実物の直リンクを
 * 取りこぼして「候補ゼロ」（偽陰性）を量産しかねない。確認画面で人が
 * 弾ける偽陽性より、機能そのものが動かなくなる偽陰性の方が高くつく。
 * また、既に33文字に達している場合に改行の先へ継続を試みないのは、
 * 杉並の「6/20(土)：url\n6/21(日)：url」のように**別々の候補が連続する**
 * 実文面で、2本目のラベルの先頭文字（英数字なら文字集合と衝突する）を
 * 1本目のトークンへ誤って食い込ませてしまう事故を防ぐため。
 */
function findTier1Matches(text: string): RawMatch[] {
  const out: RawMatch[] = []
  for (const m of text.matchAll(TIER1_URL_RE)) {
    const prefix = m[0].slice(0, m[0].length - m[1].length)
    const matchStart = m.index
    let matchEnd = m.index + m[0].length
    let token = m[1]

    const wrap = /^\r?\n[ \t]*/.exec(text.slice(matchEnd))
    if (wrap && token.length < TOKEN_LENGTH) {
      // 改行で切れ、かつ規定桁に満たない＝折り返しの疑い（AC-2）。
      // 次の行の先頭から充当できる分だけ結合する。
      const continuation = /^[A-Za-z0-9_-]+/.exec(text.slice(matchEnd + wrap[0].length))
      if (continuation) {
        token += continuation[0]
        matchEnd += wrap[0].length + continuation[0].length
      }
      // 復元してもなお規定桁数と一致しない候補は出さない（AC-3）。壊れた URL の
      // 配信は「タップしても入れない」事故になるため、この場合だけは不確実なら
      // 不採用に倒す（改行を挟んだ時点で「本来ひとつのトークンだった」ことが
      // 確定しているため、長さ不一致は復元失敗の確たる証拠になる）。
      if (token.length !== TOKEN_LENGTH) continue
    }

    out.push({ url: prefix + token, matchStart, matchEnd, unverified: false })
  }
  return out
}

function findTier2Matches(text: string): RawMatch[] {
  const out: RawMatch[] = []
  for (const m of text.matchAll(TIER2_URL_RE)) {
    out.push({ url: m[0], matchStart: m.index, matchEnd: m.index + m[0].length, unverified: true })
  }
  return out
}

/** URL 直前のテキストから対象級を推定する（最も URL に近い出現を採用）。 */
function extractGrades(contextBefore: string): OpenChatGrade[] | null {
  const normalized = normalizeFullWidth(contextBefore)
  const matches = [...normalized.matchAll(/([A-E]{1,3})級/g)]
  const last = matches.at(-1)
  if (!last) return null
  const letters = new Set(last[1].split('') as OpenChatGrade[])
  const grades = GRADE_ORDER.filter((g) => letters.has(g))
  return grades.length > 0 ? grades : null
}

/**
 * URL 直前のテキストから開催日を推定する。本文中の `6/20` には年が無いため、
 * 呼び出し側が渡す groupEventDates（申込グループ内の開催日）の月日と一致した
 * ものだけを採用する（AC-17。グループ外の日は推定しない）。
 */
function extractEventDate(contextBefore: string, groupEventDates: string[]): string | null {
  const normalized = normalizeFullWidth(contextBefore)
  const matches = [...normalized.matchAll(/(\d{1,2})\/(\d{1,2})(?:\([月火水木金土日]\))?/g)]
  const last = matches.at(-1)
  if (!last) return null
  const month = Number(last[1])
  const day = Number(last[2])
  const found = groupEventDates.find((d) => {
    const [, m, dd] = d.split('-').map(Number)
    return m === month && dd === day
  })
  return found ?? null
}

/** URL 周辺（前後どちらでも）から `パスワード：xxxx` / `合言葉：xxxx` / `参加コード：xxxx` を拾う。 */
function extractPassword(contextBefore: string, contextAfter: string): string | null {
  const re = /(?:パスワード|合言葉|参加コード)\s*[:：]\s*([^\s、。]+)/
  const before = normalizeFullWidth(contextBefore).match(re)
  if (before) return before[1]
  const after = normalizeFullWidth(contextAfter).match(re)
  if (after) return after[1]
  return null
}

/**
 * 1本のテキスト（本文 or 添付の抽出済みテキスト）から候補を抽出する。
 * Tier1/Tier2 の抽出 → 級・開催日・パスワードの推定 →
 * 同一テキスト内の重複排除（Outlook の `<https://...>` 二重表記等）の順に行う。
 */
export function extractOpenChatCandidates(
  text: string,
  options: ExtractOpenChatCandidatesOptions,
): OpenChatCandidate[] {
  // 直リンクと短縮 URL が同じメールに混在する場合、確認シートが文面どおりの
  // 順に並ぶよう出現位置でソートする（Tier をまたいだ実行順は保証されないため）。
  const raw = [...findTier1Matches(text), ...findTier2Matches(text)].sort(
    (a, b) => a.matchStart - b.matchStart,
  )

  const candidates = raw.map((m): OpenChatCandidate => {
    const contextBefore = text.slice(Math.max(0, m.matchStart - CONTEXT_BEFORE_LEN), m.matchStart)
    const contextAfter = text.slice(m.matchEnd, m.matchEnd + CONTEXT_AFTER_LEN)
    return {
      url: m.url,
      sources: [options.source],
      unverified: m.unverified,
      grades: extractGrades(contextBefore),
      eventDate: extractEventDate(contextBefore, options.groupEventDates),
      password: extractPassword(contextBefore, contextAfter),
    }
  })

  return mergeOpenChatCandidateLists([candidates])
}

/**
 * 複数テキスト（本文＋複数の添付テキスト）由来の候補リストを1つにマージする。
 * 同一 URL は1候補にまとめ、出典を併記する（AC-5, AC-9）。属性（級・開催日・
 * パスワード）は最初に見つかった非 null 値を優先する。
 */
export function mergeOpenChatCandidateLists(
  lists: OpenChatCandidate[][],
): OpenChatCandidate[] {
  const order: string[] = []
  const map = new Map<string, OpenChatCandidate>()

  for (const list of lists) {
    for (const candidate of list) {
      const existing = map.get(candidate.url)
      if (!existing) {
        order.push(candidate.url)
        map.set(candidate.url, {
          ...candidate,
          sources: [...new Set(candidate.sources)],
        })
        continue
      }
      existing.sources = [...new Set([...existing.sources, ...candidate.sources])]
      existing.unverified = existing.unverified || candidate.unverified
      existing.grades = existing.grades ?? candidate.grades
      existing.eventDate = existing.eventDate ?? candidate.eventDate
      existing.password = existing.password ?? candidate.password
    }
  }

  return order.map((url) => map.get(url)!)
}
