/**
 * travel-report: OOXML（WordprocessingML）を**文字列レベル**で読み書きする小道具。
 *
 * DOM パーサを入れないのは、テンプレの構造を丸ごと保つのが目的だから——原本の
 * 罫線・フォント・段落プロパティに一切触れず、**セルの中身だけ**を差し替えたい。
 * パースして書き戻すと名前空間や属性順が正規化され、Word での見た目が変わりうる。
 *
 * ★前提（`fill.ts` の drift ガードが毎回検査する）: セルは属性なしの `<w:tc>` で、
 * 表はネストしない。原本が改版されて前提が崩れたら、黙って壊れた docx を作るより
 * 例外で止める。
 */

export interface XmlBlock {
  start: number
  end: number
  xml: string
}

function collect(source: string, re: RegExp): XmlBlock[] {
  const out: XmlBlock[] = []
  let m: RegExpExecArray | null
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  while ((m = rx.exec(source)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, xml: m[0] })
  }
  return out
}

/** ドキュメント内の `<w:tbl>` を出現順に返す。 */
export function tables(xml: string): XmlBlock[] {
  return collect(xml, /<w:tbl>[\s\S]*?<\/w:tbl>/g)
}

/** 表の中の `<w:tr>` を出現順に返す。 */
export function rows(tableXml: string): XmlBlock[] {
  return collect(tableXml, /<w:tr[ >][\s\S]*?<\/w:tr>/g)
}

/** 行の中の `<w:tc>` を出現順に返す。 */
export function cells(rowXml: string): XmlBlock[] {
  return collect(rowXml, /<w:tc>[\s\S]*?<\/w:tc>/g)
}

/** セル（や段落）の中の `<w:p>` を出現順に返す。 */
export function paragraphs(xml: string): XmlBlock[] {
  return collect(xml, /<w:p\b[\s\S]*?<\/w:p>/g)
}

/** 段落の中の `<w:t>` のテキストを出現順に返す。 */
export function runTexts(paragraphXml: string): string[] {
  return [...paragraphXml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1] ?? '')
}

/** 要素内のテキストを連結する。 */
export function textOf(xml: string): string {
  return runTexts(xml).join('')
}

/** XML のテキストノード用エスケープ。 */
export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * セルを作り直す。`<w:tcPr>`（セル書式）と、先頭段落の `<w:pPr>`・先頭 run の
 * `<w:rPr>`（段落・文字書式）を引き継ぎ、1行 = 1段落で書き込む。
 * 空配列を渡すと空段落1つになる（Word はセルに段落0個を許さない）。
 */
export function rewriteCell(cellXml: string, lines: readonly string[]): string {
  const tcPr = cellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] ?? ''
  const pPr = cellXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? ''
  const rPr = cellXml.match(/<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? ''
  const body = (lines.length > 0 ? lines : ['']).map(
    (line) => `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
  )
  return `<w:tc>${tcPr}${body.join('')}</w:tc>`
}

/**
 * 段落内の n 番目の `<w:t>` のテキストだけを差し替える（run の書式は保つ）。
 * 下線つきの署名欄のように、run ごとに書式が違う段落で使う。
 */
export function replaceRunText(paragraphXml: string, runIndex: number, value: string): string {
  let i = 0
  return paragraphXml.replace(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g, (whole, open: string, _text: string, close: string) => {
    if (i++ !== runIndex) return whole
    const openTag = open.includes('xml:space') ? open : '<w:t xml:space="preserve">'
    return `${openTag}${escapeXml(value)}${close}`
  })
}

/** 複数の run をまとめて差し替える（`{ runIndex: value }`）。 */
export function replaceRunTexts(
  paragraphXml: string,
  values: Readonly<Record<number, string>>,
): string {
  let i = 0
  return paragraphXml.replace(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g, (whole, open: string, _text: string, close: string) => {
    const idx = i++
    const value = values[idx]
    if (value === undefined) return whole
    const openTag = open.includes('xml:space') ? open : '<w:t xml:space="preserve">'
    return `${openTag}${escapeXml(value)}${close}`
  })
}

/**
 * 元の文字列の一部を差し替える（複数箇所を**後ろから**適用してオフセットを保つ）。
 */
export function spliceAll(
  source: string,
  edits: readonly { start: number; end: number; xml: string }[],
): string {
  let out = source
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.xml + out.slice(edit.end)
  }
  return out
}
