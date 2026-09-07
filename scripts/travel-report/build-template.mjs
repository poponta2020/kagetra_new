// 遠征届の同梱テンプレ（クリーン版）を生成する。
//
//   node scripts/travel-report/build-template.mjs <原本 .dotx のパス>
//
// 原本 `遠征届原本2025.dotx` には前年度の団体代表者（所属・氏名・携帯番号）と
// 顧問教員（所属部局等・職・氏名）、および docProps の作成者名が入っている。
// これらを空欄にした版を base64 の TS モジュール
// `apps/web/src/lib/travel-report/docx/template.b64.ts` として書き出す。
//
// ★原本そのものは絶対に commit しない（requirements R11・§7・AC-29）。
//   このスクリプトも原本を読むだけで、リポジトリへは書き戻さない。
// ★**このスクリプト自身にも原本の個人情報を書かない。** 消す対象を「氏名の文字列」で
//   指定すると、その氏名がリポジトリに残ってしまい §7 の目的（原本の個人情報を git 履歴に
//   残さない）を自分で破ることになる。そこで**段落番号と「残す run の数」**で位置指定し、
//   様式のラベル（個人情報ではない）が期待どおりの場所にあることだけを検査する。
// ★`public/` に置かないのは認可を掛けられないため。TS モジュールなら route handler の
//   中でしか読めず、バンドルにも確実に含まれる。
//
// 置換は run 単位で行い、段落・下線・セル構造には触れない（長さを合わせた全角スペースで
// 埋めるので下線の幅も変わらない）。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '../..',
)
// jszip は apps/web の依存。ここから解決して root へ devDependency を増やさない。
const require = createRequire(pathToFileURL(path.join(repoRoot, 'apps/web/package.json')))
const JSZip = require('jszip')

const SRC = process.argv[2]
if (!SRC) {
  console.error('usage: node scripts/travel-report/build-template.mjs <原本 .dotx のパス>')
  process.exit(1)
}
const OUT = path.join(repoRoot, 'apps/web/src/lib/travel-report/docx/template.b64.ts')

/**
 * 署名欄（表1の最終行の最後のセル）で空欄にする段落。
 * `keep` は先頭から残す run の数（＝様式のラベル部分）で、それ以降の run をすべて
 * 同じ幅の全角スペースへ置き換える。`label` は残す run に必ず含まれる様式の文字列で、
 * 原本が改版されて段落がずれたときに気づくための検査に使う（個人情報ではない）。
 */
const BLANK_TARGETS = [
  { paragraph: 5, keep: 1, label: '団体代表者' }, // 所属（学部・コース・学年）
  { paragraph: 7, keep: 1, label: '氏名' }, // 団体代表者 氏名
  { paragraph: 9, keep: 3, label: 'TEL' }, // 団体代表者 連絡先
  { paragraph: 11, keep: 2, label: '顧問教員' }, // 顧問教員 所属部局等
  { paragraph: 13, keep: 1, label: '職' }, // 顧問教員 職
  { paragraph: 15, keep: 1, label: '氏' }, // 顧問教員 氏名
]

const pad = (n) => '　'.repeat(n)

function tables(xml) {
  return xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []
}
function rows(xml) {
  return xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []
}
function cells(xml) {
  return xml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []
}
function paragraphs(xml) {
  return xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []
}
function runTexts(xml) {
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1] ?? '')
}

/** 段落内の `keep` 番目以降の run を、同じ幅の全角スペースへ置き換える。 */
function blankRunsFrom(paragraphXml, keep) {
  let i = 0
  return paragraphXml.replace(
    /(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g,
    (whole, open, text, close) => {
      const index = i++
      if (index < keep) return whole
      // 前後の空白を落とされないよう xml:space="preserve" を必ず付ける。
      const openTag = open.includes('xml:space') ? open : '<w:t xml:space="preserve">'
      return `${openTag}${pad(text.length)}${close}`
    },
  )
}

/** 署名欄セル（表1の最終行の最後のセル）を切り出す。 */
function signatureCell(xml) {
  const tbls = tables(xml)
  if (tbls.length !== 2) throw new Error(`表が2枚でない: ${tbls.length}`)
  const trs = rows(tbls[0])
  if (trs.length !== 12) throw new Error(`表1の行数が12でない: ${trs.length}`)
  const lastRow = trs[trs.length - 1]
  const cs = cells(lastRow)
  const cell = cs[cs.length - 1]
  if (!cell) throw new Error('署名欄のセルが無い')
  const cellStart = xml.indexOf(cell)
  return { start: cellStart, end: cellStart + cell.length, xml: cell }
}

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(SRC))
  if (!zip.file('word/document.xml')) throw new Error('word/document.xml が無い: ' + SRC)

  let doc = await zip.file('word/document.xml').async('string')
  const cell = signatureCell(doc)
  const ps = paragraphs(cell.xml)
  let cellXml = cell.xml

  // 段落は後ろから置き換える（前を書き換えるとオフセットがずれるため）。
  for (const target of [...BLANK_TARGETS].sort((a, b) => b.paragraph - a.paragraph)) {
    const p = ps[target.paragraph]
    if (!p) throw new Error(`原本の版が違う: 署名欄に p${target.paragraph} が無い`)
    const texts = runTexts(p)
    const kept = texts.slice(0, target.keep).join('')
    if (!kept.includes(target.label)) {
      throw new Error(
        `原本の版が違う: p${target.paragraph} の先頭 ${target.keep} run に「${target.label}」が無い`,
      )
    }
    if (texts.length <= target.keep) {
      throw new Error(`原本の版が違う: p${target.paragraph} に空欄にする run が無い`)
    }
    const start = cellXml.indexOf(p)
    if (start === -1) throw new Error(`p${target.paragraph} が見つからない`)
    cellXml = cellXml.slice(0, start) + blankRunsFrom(p, target.keep) + cellXml.slice(start + p.length)
  }

  doc = doc.slice(0, cell.start) + cellXml + doc.slice(cell.end)
  zip.file('word/document.xml', doc)

  // docProps の作成者・最終更新者を空にする。
  let core = await zip.file('docProps/core.xml').async('string')
  core = core
    .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, '<dc:creator></dc:creator>')
    .replace(
      /<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/,
      '<cp:lastModifiedBy></cp:lastModifiedBy>',
    )
  zip.file('docProps/core.xml', core)

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  // ---- 検査: 生成物の署名欄に値が残っていないこと ----
  const check = await JSZip.loadAsync(buf)
  const checkedDoc = await check.file('word/document.xml').async('string')
  const checkedCell = signatureCell(checkedDoc)
  const checkedPs = paragraphs(checkedCell.xml)
  for (const target of BLANK_TARGETS) {
    const rest = runTexts(checkedPs[target.paragraph]).slice(target.keep).join('')
    if (rest.trim().length > 0 || /[０-９0-9]/.test(rest)) {
      throw new Error(`p${target.paragraph} の空欄化に失敗している`)
    }
  }
  const checkedCore = await check.file('docProps/core.xml').async('string')
  if (!checkedCore.includes('<dc:creator></dc:creator>')) throw new Error('作成者が空でない')

  const entryCount = Object.keys(check.files).filter((n) => !check.files[n].dir).length
  if (entryCount < 10) throw new Error(`エントリ数が少なすぎる（読めていない可能性）: ${entryCount}`)

  mkdirSync(path.dirname(OUT), { recursive: true })
  const b64 = buf.toString('base64')
  const header = `// 自動生成ファイル — 手で編集しない。
// 生成: node scripts/travel-report/build-template.mjs <原本 .dotx のパス>
//
// 遠征届の原本 .dotx から**団体代表者・顧問教員・電話・docProps の作成者名を
// 空欄にした版**（requirements R11・AC-29）。原本そのものはリポジトリに置かない。
//
// 用途は2つ:
//   1. 提出権限者への「原本ダウンロード」（そのまま .dotx として配る）
//   2. 遠征届の生成（\`docx/fill.ts\` が [Content_Types].xml を document へ差し替えて .docx 化）
//
// 空欄化できていることは \`__tests__/template-privacy.test.ts\` が検査する。
`
  writeFileSync(
    OUT,
    `${header}export const TRAVEL_REPORT_TEMPLATE_BASE64 =\n  '${b64}'\n\n/** 同梱テンプレを Buffer で取り出す。 */\nexport function travelReportTemplateBuffer(): Buffer {\n  return Buffer.from(TRAVEL_REPORT_TEMPLATE_BASE64, 'base64')\n}\n`,
    'utf8',
  )
  console.log(`ok: ${OUT}`)
  console.log(`  entries=${entryCount} bytes=${buf.length} base64=${b64.length}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
