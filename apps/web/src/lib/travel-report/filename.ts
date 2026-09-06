/**
 * travel-report: 生成する docx のファイル名（requirements R9）。
 *
 * 記入例に倣った形: `2026.6.13,14 青森大会 遠征届.docx`
 * - 日付は「年.月.日」で始め、2日目以降は同じ月なら日だけ、月が変われば「月.日」を足す
 * - 大会名はそのファイルの先頭の日の大会名（正式名称ではなく短い方＝一覧の表示名）
 * - Windows / macOS で使えない文字は全角へ寄せる（`/` `\` `:` `*` `?` `"` `<` `>` `|`）
 */

/** ファイル名に使えない文字の置き換え表。 */
const ILLEGAL: Record<string, string> = {
  '/': '／',
  '\\': '＼',
  ':': '：',
  '*': '＊',
  '?': '？',
  '"': '”',
  '<': '＜',
  '>': '＞',
  '|': '｜',
}

/** ファイル名として安全な文字列にする（制御文字と前後の空白・ピリオドも落とす）。 */
export function sanitizeFilenamePart(value: string): string {
  return [...value]
    // 制御文字（U+0000〜U+001F, U+007F）はファイル名に入れられないので落とす。
    .map((ch) => ILLEGAL[ch] ?? (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? '' : ch))
    .join('')
    .replace(/[\s　]+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
}

/**
 * 日付の並びを `2026.6.13,14` の形にする。空配列なら空文字。
 * 月が変わるところでは `2026.6.30,7.1` のように月から書く。
 * ★年が変わるところは月だけでは表せないので `2027.1.1` のように年から書く
 * （前月しか追跡していないと年またぎで年が落ちる。Codex R1 #11）。
 */
export function formatDateRun(dates: readonly string[]): string {
  const sorted = [...new Set(dates)].sort()
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let prevYear: string | null = null
  let prevMonth: string | null = null
  for (const [i, date] of sorted.entries()) {
    const year = String(Number(date.slice(0, 4)))
    const month = String(Number(date.slice(5, 7)))
    const day = String(Number(date.slice(8, 10)))
    if (i === 0) parts.push(`${year}.${month}.${day}`)
    else if (year !== prevYear) parts.push(`${year}.${month}.${day}`)
    else if (month === prevMonth) parts.push(day)
    else parts.push(`${month}.${day}`)
    prevYear = year
    prevMonth = month
  }
  return parts.join(',')
}

/**
 * 遠征届のファイル名を組み立てる。
 * 大会名が空なら日付だけの `2026.6.13,14 遠征届.docx` になる。
 */
export function travelReportFilename(input: {
  dates: readonly string[]
  tournamentName: string
}): string {
  const run = formatDateRun(input.dates)
  const name = sanitizeFilenamePart(input.tournamentName)
  return `${[run, name, '遠征届'].filter((s) => s.length > 0).join(' ')}.docx`
}
