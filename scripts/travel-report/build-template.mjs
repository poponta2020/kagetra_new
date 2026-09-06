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
// ★`public/` に置かないのは認可を掛けられないため。TS モジュールなら
//   route handler の中でしか読めず、バンドルにも確実に含まれる。
//
// 置換は**run 単位のテキスト差し替え**で行い、段落・下線・セル構造には触れない
// （長さを合わせた全角スペースで埋めるので下線の幅も変わらない）。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
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
 * 原本の個人情報を含む run のテキスト。**完全一致**で探し、同じ文字数の全角スペースへ
 * 置き換える。1つでも見つからなければ原本の版が変わったということなので中断する
 * （黙って素通りすると PII を含んだテンプレを commit してしまう）。
 */
const PII_RUNS = [
  '法専門職コース　2', // 団体代表者 所属（学部・コース・学年）
  '田中佑樹', // 団体代表者 氏名
  '080-3838-4133', // 団体代表者 連絡先
  '　　　　　　　北海道大学大学院工学研究院　応用科学部門　　　　　　　　　　　　　　　　　　　　　　　', // 顧問教員 所属部局等
  '　　　　　　　　　助教　　　　　　　　　　　　　　　　　　　　　', // 顧問教員 職
  '　　　　　　　　百合野　大雅　　　　　　　　　　　　　　　　　　　　　　', // 顧問教員 氏名
]

/** 置換後に**どのエントリにも**残っていてはいけない文字列（最終検査）。 */
const FORBIDDEN = [
  '田中佑樹',
  '080-3838-4133',
  '百合野',
  '大雅',
  '応用科学部門',
  '助教',
  '深井',
  'daifu',
]

const pad = (n) => '　'.repeat(n)

function blankRunText(xml, text) {
  // <w:t> / <w:t xml:space="preserve"> のどちらでも拾う。
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(<w:t(?: [^>]*)?>)${escaped}(</w:t>)`, 'g')
  let hits = 0
  const next = xml.replace(re, (_m, open, close) => {
    hits += 1
    // 前後の空白を落とされないよう xml:space="preserve" を必ず付ける。
    const openTag = open.includes('xml:space') ? open : '<w:t xml:space="preserve">'
    return `${openTag}${pad(text.length)}${close}`
  })
  return { xml: next, hits }
}

async function main() {
  const zip = await JSZip.loadAsync(readFileSync(SRC))
  const entryNames = Object.keys(zip.files)
  if (entryNames.length === 0) throw new Error('zip が空: ' + SRC)
  if (!zip.file('word/document.xml')) throw new Error('word/document.xml が無い: ' + SRC)

  let doc = await zip.file('word/document.xml').async('string')
  for (const text of PII_RUNS) {
    const { xml, hits } = blankRunText(doc, text)
    if (hits === 0) throw new Error(`原本の版が違う（run が見つからない）: ${JSON.stringify(text)}`)
    doc = xml
  }
  zip.file('word/document.xml', doc)

  // docProps の作成者・最終更新者を空にする。
  let core = await zip.file('docProps/core.xml').async('string')
  core = core
    .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, '<dc:creator></dc:creator>')
    .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy></cp:lastModifiedBy>')
  zip.file('docProps/core.xml', core)

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  // ---- 検査: 生成物のどのエントリにも個人情報が残っていないこと ----
  const check = await JSZip.loadAsync(buf)
  const checked = []
  for (const name of Object.keys(check.files)) {
    if (check.files[name].dir) continue
    const s = await check.file(name).async('string')
    const hit = FORBIDDEN.filter((p) => s.includes(p))
    if (hit.length > 0) throw new Error(`個人情報が残っている: ${name} ${JSON.stringify(hit)}`)
    checked.push(name)
  }
  if (checked.length < 10) throw new Error(`エントリ数が少なすぎる（読めていない可能性）: ${checked.length}`)

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
// PII が混入していないことは \`__tests__/travel-report-template-privacy.test.ts\` が
// 生成物の全エントリを走査して検査する。
`
  writeFileSync(
    OUT,
    `${header}export const TRAVEL_REPORT_TEMPLATE_BASE64 =\n  '${b64}'\n\n/** 同梱テンプレを Buffer で取り出す。 */\nexport function travelReportTemplateBuffer(): Buffer {\n  return Buffer.from(TRAVEL_REPORT_TEMPLATE_BASE64, 'base64')\n}\n`,
    'utf8',
  )
  console.log(`ok: ${OUT}`)
  console.log(`  entries=${checked.length} bytes=${buf.length} base64=${b64.length}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
