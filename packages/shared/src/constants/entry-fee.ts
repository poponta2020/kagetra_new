import type { Grade } from '../types'

/**
 * 公認大会の級別参加料（円）。
 *
 * 出典: 一般社団法人全日本かるた協会「公認大会の参加料・公認料の改正について」
 * （競技かるた部・総務部、2021-04-28 発出 / **2021-07-01 施行**）。
 * 会員ページ 通達文書 `member-document/2187` の添付 `member-download/2178`。
 * 2024-03 の「公認大会案内 見本」(`member-download/11383`) も同額を再掲している。
 *
 * 全国一律の協会規定であり大会ごとの裁量ではない。改定はこの表の変更（＝コード変更）で行う。
 *
 * 初段認定大会（公認大会）も 1,500 円で E 級と同額のため、ここでは E 級に寄せている。
 * ただし根拠は別通達（`member-download/3507`「2022年度開催方式」）で、
 * 将来どちらか一方だけが改定されたら独立したキーへ分けること。
 *
 * なお「公認料」（主催会が全日協へ納める内数。全級 300 円）はここでは扱わない。
 * 選手が支払う額ではないため。
 */
export const OFFICIAL_ENTRY_FEE_JPY: Record<Grade, number> = {
  A: 2500,
  B: 2500,
  C: 2000,
  D: 2000,
  E: 1500,
}

/**
 * 級から公認大会の規定参加料を引く。引けなければ `null`。
 *
 * `users.grade` は nullable で、DB 由来の値が既知の級である保証もないため、
 * 型が `Grade` でもランタイムでは信用しない。
 *
 * **引けなかったときに 0 や既定額へフォールバックしない。** 参加費の 0 は
 * 「無料大会」という別の意味を持つため、両者を混ぜてはならない。
 */
export function officialEntryFeeJpy(grade: Grade | null | undefined): number | null {
  if (grade == null) return null
  // 継承プロパティ（'toString' 等）を級として解決しないよう自前キーだけを見る。
  if (!Object.prototype.hasOwnProperty.call(OFFICIAL_ENTRY_FEE_JPY, grade)) return null
  return OFFICIAL_ENTRY_FEE_JPY[grade]
}
