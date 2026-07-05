/** 「第N回」接頭を除去（全角数字も）。 */
export function stripKai(name: string): string {
  return name.replace(/^第[0-9０-９]+回\s*/, '')
}

/**
 * 大会名+級の表示ラベル。通称（shortName）があればそれを優先し、無ければ正式名称から
 * 「第N回」を除去したものにフォールバックする。級は本人の出場級のみ（大会全体の開催級ではない）。
 */
export function formatTournamentLabel(t: {
  name: string
  shortName: string | null
  grade: string | null
}): string {
  return (t.shortName ?? stripKai(t.name)) + (t.grade ?? '')
}
