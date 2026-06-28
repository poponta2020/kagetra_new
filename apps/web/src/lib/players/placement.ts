/**
 * 順位導出（design-spec §6 / requirements R1）。
 *
 * 自由記述の `final_rank` に依存せず、**単純トーナメント（シングルイリミ）**の
 * 級内 matches から各選手の順位（優勝/準優勝/ベストN）を導出する。導出が一意に
 * 決まらない級（リーグ戦・順位戦・予選+本戦の混在・3位決定戦・データ欠け 等）は
 * `null` を返し、呼び出し側が保存済み `final_rank` にフォールバックする。
 */

/** 順位導出に必要な1試合分の最小情報。 */
export interface PlacementMatch {
  round: number
  roundLabel: string | null
  result: 'win' | 'lose'
  status: 'normal' | 'walkover' | 'forfeit'
}

/** 導出した順位。`bracket` = 到達した「上位N」(1=優勝, 2=準優勝, 4, 8, 16, …)。 */
export interface DerivedPlacement {
  label: string
  bracket: number
}

/** round_label がブラケット戦でないことを示すサイン。これらを含む級は導出しない。 */
const NON_BRACKET = /リーグ|順位|予選|敗者|総当|スイス|位決定/

function labelForBracket(bracket: number): string {
  if (bracket <= 1) return '優勝'
  if (bracket === 2) return '準優勝'
  return `ベスト${bracket}`
}

/**
 * 意味ラベル（決勝/準決勝/準々決勝）からその段で**敗退**した時の bracket を返す。
 * 「決勝」は 2（決勝で負け＝準優勝）。意味ラベルでなければ null。
 * 「準々決勝」は「決勝」を部分文字列に含むので先に判定する。
 */
function bracketFromSemanticLabel(label: string): number | null {
  if (label.includes('準々決勝')) return 8
  if (label.includes('準決勝')) return 4
  if (label.includes('決勝')) return 2
  return null
}

/**
 * 級内の選手 matches と、その級の決勝 round（= 全参加者の max(round)）から順位を導出。
 * 導出不能なら null。
 */
export function derivePlacement(
  matches: PlacementMatch[],
  classMaxRound: number,
): DerivedPlacement | null {
  if (matches.length === 0) return null

  // ブラケット戦でないサインがあれば導出しない
  for (const mt of matches) {
    if (mt.roundLabel && NON_BRACKET.test(mt.roundLabel)) return null
  }

  // シングルイリミは「1 round = 1 試合」。どこかの round に複数試合があれば
  // ブラケットとして異常（3位決定戦/別形式/データ不整合）→ 導出しない。
  const seenRounds = new Set<number>()
  for (const mt of matches) {
    if (seenRounds.has(mt.round)) return null
    seenRounds.add(mt.round)
  }

  const playedRounds = matches.map((mt) => mt.round)
  const minRound = Math.min(...playedRounds)
  const maxPlayed = Math.max(...playedRounds)

  // 進出経路の一貫性チェック（データ欠けを導出不能に倒す）。
  // - 冒頭の bye は最大1回戦分（出場開始は round1 か round2）。それ以上飛んでいる
  //   ＝「決勝だけ残っている」等のデータ欠けなので導出しない。
  // - 出場 round は開始〜最終までギャップ無く連続のはず（重複は上で排除済みなので
  //   distinct 数 = matches.length）。欠けていれば導出しない。
  if (minRound > 2) return null
  if (maxPlayed - minRound + 1 !== matches.length) return null

  const last = matches.find((mt) => mt.round === maxPlayed)
  if (!last) return null

  // データ不整合（級の決勝より後ろの round は存在し得ない）
  if (classMaxRound < maxPlayed) return null

  // シングルイリミなら敗北は高々1回、かつ**最終試合**（負けたら止まる）。
  // 2敗以上や「敗北後に勝ち」は3位決定戦/別形式/データ不整合 → 導出しない。
  const lossRounds = matches.filter((mt) => mt.result === 'lose').map((mt) => mt.round)
  if (lossRounds.length > 1) return null
  if (lossRounds.length === 1 && lossRounds[0] !== maxPlayed) return null

  const semantic = last.roundLabel ? bracketFromSemanticLabel(last.roundLabel) : null

  if (last.result === 'win') {
    // 最終試合に勝って終わっている＝決勝の勝者（優勝）でなければデータ欠け。
    if (semantic === 2 || maxPlayed === classMaxRound) {
      return { label: '優勝', bracket: 1 }
    }
    return null
  }

  // 敗退：意味ラベルがあれば最優先、無ければ round 数から算出
  if (semantic !== null) {
    return { label: labelForBracket(semantic), bracket: semantic }
  }
  const exp = classMaxRound - maxPlayed + 1
  if (exp < 1) return null
  const bracket = 2 ** exp
  return { label: labelForBracket(bracket), bracket }
}

/** 入賞＝ベスト8以上（bracket <= 8）。 */
export function isNyusho(p: DerivedPlacement | null): boolean {
  return p !== null && p.bracket <= 8
}

/** 優勝＝bracket 1。 */
export function isChampion(p: DerivedPlacement | null): boolean {
  return p !== null && p.bracket === 1
}
