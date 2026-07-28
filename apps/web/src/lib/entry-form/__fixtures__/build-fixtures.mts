/**
 * Fixture builder for entry-form-autofill (run manually, not in CI).
 *
 * 入力は実際に主催者から配布された空の申込書テンプレ 4 系統。リポジトリには
 * 入力を置かず、**このスクリプトが PII を除去した出力だけ**をコミットする。
 * ヒューリスティック（cell-map.ts）と記入エンジン（fill.ts）は実物の結合セル・
 * 数式・入力規則を相手にしないと意味のある検証にならないため、構造は一切
 * 合成せず実物のまま残す。
 *
 * 入力の取得元（ローカル開発 DB の取込メール添付）:
 *   docker exec kagetra-db psql -U kagetra -d kagetra -tAc \
 *     "select encode(data,'base64') from mail_attachments where id=<ID>" \
 *     | tr -d '\n\r ' | base64 -d > <name>.src.xlsx
 *
 *   standard.src.xlsx    ← id 127 第3回青森大会参加申込書
 *   split-kana.src.xlsx  ← id 123 第38回シニア選手権大会申込書
 *   shifted.src.xlsx     ← id  90 第33回埼玉県大会申込書（D級の部）
 *   multisheet.src.xlsx  ← id  86 第24回広島県選手権申込書
 *
 * 使い方: SRC_DIR=<入力ディレクトリ> tsx build-fixtures.mts
 */
import ExcelJS from 'exceljs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = process.env.SRC_DIR
if (!SRC_DIR) {
  console.error('SRC_DIR is required (directory holding the *.src.xlsx inputs)')
  process.exit(1)
}

/**
 * ドキュメントプロパティを消す。**セル値の差し替えだけでは不十分** ——
 * xlsx は docProps/core.xml・app.xml に作成者名・最終更新者名・所属組織を持ち、
 * 実物テンプレにはそれらが実名で残っている（画面には出ないので見落としやすい）。
 */
function scrubDocumentProperties(wb: ExcelJS.Workbook) {
  wb.creator = 'kagetra-fixture'
  wb.lastModifiedBy = 'kagetra-fixture'
  wb.company = ''
  wb.manager = ''
  wb.title = ''
  wb.subject = ''
  wb.keywords = ''
  wb.description = ''
  wb.category = ''
  // 日時も実運用の痕跡なので固定値に寄せる（再生成の差分も安定する）。
  const epoch = new Date('2020-01-01T00:00:00.000Z')
  wb.created = epoch
  wb.modified = epoch
  wb.lastPrinted = epoch
}

async function open(name: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(join(SRC_DIR!, name))
  scrubDocumentProperties(wb)
  return wb
}

async function save(wb: ExcelJS.Workbook, name: string) {
  await wb.xlsx.writeFile(join(OUT_DIR, name))
  console.log(`wrote ${name}`)
}

// 1) 標準型: ヘッダ欄 A3:A8 / 明細ヘッダ r11 / No 列に =A12+1 の数式 /
//    段位の入力規則が「初段,2段,…」形式 / 出場回数列あり。
//    F37 の「申込先」は主催者の実アドレスなので差し替える（AC-12 の抽出対象）。
{
  const wb = await open('standard.src.xlsx')
  const ws = wb.worksheets[0]!
  ws.getCell('F37').value = '　　申込先：　entry@example.invalid'
  await save(wb, 'standard.xlsx')
}

// 2) 姓名・かなが別列の2段ヘッダ型: 段位の入力規則が漢数字（初,二,三…）・
//    参加料列に =SUM() / 本文セルに「申込先」メールアドレス。
//    主催者担当者の実名と実メールアドレスを差し替える。
{
  const wb = await open('split-kana.src.xlsx')
  const ws = wb.worksheets[0]!
  ws.getCell('D24').value = 'Emailアドレス：entry@example.invalid'
  ws.getCell('H24').value = '　総務部　担当者　宛'
  await save(wb, 'split-kana.xlsx')
}

// 3) 列位置がずれた変形型: 段位列が無い・参加級の入力規則が "D" 固定・
//    ヘッダ欄が「所属会名：」形式のラベル。申込先メールが richText。
{
  const wb = await open('shifted.src.xlsx')
  const ws = wb.worksheets[0]!
  ws.getCell('H8').value = '　○○県かるた協会'
  ws.getCell('H9').value = 'entry@example.invalid'
  await save(wb, 'shifted.xlsx')
}

// 4) 級別複数シート型: 実物のシート名は「上級」「中級」で A〜E 級へ機械的に
//    対応させられない（＝ヒューリスティックが低信頼を返し AI/手動へ回る系統）。
//    シート名から級を判定できる系統も同じ構造で必要なため、同一の実物から
//    シート名だけを差し替えた2つの fixture を作る。
{
  const wb = await open('multisheet.src.xlsx')
  await save(wb, 'multisheet-ambiguous.xlsx')
}
{
  const wb = await open('multisheet.src.xlsx')
  wb.worksheets[0]!.name = 'C級'
  wb.worksheets[1]!.name = 'D級'
  // シート名に合わせて表題も差し替える（表題からの級判定を邪魔しないため）。
  wb.worksheets[0]!.getCell('A1').value = '第24回○○県かるた選手権大会名簿（C級の部）'
  wb.worksheets[1]!.getCell('A1').value = '第24回○○県かるた選手権大会名簿（D級の部）'
  await save(wb, 'multisheet-grades.xlsx')
}
