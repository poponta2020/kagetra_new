// One-off bulk loader (rehearsal). Parses the whole corpus → instances → DB via
// materializeResultDraft. NOT committed (root scratch, deleted after). DB target
// via DATABASE_URL. REHEARSE_LIMIT=N strided sample; 0/unset = all.
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import * as materializeMod from './src/lib/result-import/materialize.ts'
// apps/web has no "type":"module" → tsx loads it as CJS, exports wrapped in .default
const materializeResultDraft = ((materializeMod as { default?: typeof materializeMod }).default ?? materializeMod).materializeResultDraft
import { parseResultHtml } from '../mail-worker/src/result-import/html-parser.ts'
import { parseResultExcel } from '../mail-worker/src/result-import/parser.ts'
import { normalizeText } from '../mail-worker/src/result-import/normalize.ts'
import type { ParsedClass } from '../mail-worker/src/result-import/schema.ts'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'c:/tmp/karuta_results'
function extractDate(text: string): string | null {
  const t = text.normalize('NFKC')
  const iso = t.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/); if (iso) return `${iso[1]}-${String(+iso[2]!).padStart(2, '0')}-${String(+iso[3]!).padStart(2, '0')}`
  const w = t.match(/(令和|平成|昭和)\s*(元|\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (w) { const yr = w[2] === '元' ? 1 : +w[2]!; const base = w[1] === '令和' ? 2018 : w[1] === '平成' ? 1988 : 1925; return `${base + yr}-${String(+w[3]!).padStart(2, '0')}-${String(+w[4]!).padStart(2, '0')}` }
  const g = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/); if (g) return `${g[1]}-${String(+g[2]!).padStart(2, '0')}-${String(+g[3]!).padStart(2, '0')}`
  const dot = t.match(/(20\d{2})[.\/](\d{1,2})[.\/](\d{1,2})/); if (dot) return `${dot[1]}-${String(+dot[2]!).padStart(2, '0')}-${String(+dot[3]!).padStart(2, '0')}`
  return null
}
function excelMeta(sheets: { name: string; grid: (string | null)[][] }[]): { name: string | null; date: string | null } {
  let name: string | null = null, date: string | null = null
  for (const s of sheets) {
    for (let r = 0; r < Math.min(s.grid.length, 30) && !date; r++) for (const cell of s.grid[r] ?? []) if (cell) { const d = extractDate(String(cell)); if (d) { date = d; break } }
    for (let r = 0; r < Math.min(s.grid.length, 6) && !name; r++) for (const cell of s.grid[r] ?? []) {
      if (!cell) continue; const c = normalizeText(String(cell))
      if (c.length < 6 || !/(大会|選手権|杯|甲子園|名人|クイーン)/.test(c) || /開催|会場|主催|主管|参加者|期日|於|案内|入力|使用方法|歴代|頁/.test(c)) continue
      name = c; break
    }
    if (name && date) break
  }
  return { name, date }
}
function stripName(name: string | null): string {
  if (!name) return 'NONAME'
  return normalizeText(name).replace(/[（(][^）)]*[）)]\s*$/g, '').replace(/(結果(表|報告書?)?|成績(表|発表)?|御?報告|のご?報告|詳報|入賞者?|大会報告)\s*$/g, '').replace(/[\s　]/g, '') || 'NONAME'
}
type Inst = { name: string; date: string | null; classes: ParsedClass[]; rec?: boolean }
const map = new Map<string, Inst>()
const mcount = (c: ParsedClass) => c.participants.reduce((a, p) => a + p.matches.length, 0)
function add(name: string | null, date: string | null, classes: ParsedClass[], source: string) {
  // NODATE → key per source (never merge undated files: same-name-different-year, or a
  // help/description string mistaken for a name, would falsely merge distinct events).
  const key = date ? `${date}__${stripName(name)}` : `ND__${source}`
  let inst = map.get(key); if (!inst) { inst = { name: name ?? key, date, classes: [] }; map.set(key, inst) }
  if (!inst.name && name) inst.name = name
  if (source.startsWith('recover:')) inst.rec = true
  // Dedup classes by normalized className within the instance (true-duplicate files);
  // keep the more complete copy (more participants, tiebreak more matches).
  for (const c of classes) {
    const ck = normalizeText(c.className)
    const idx = inst.classes.findIndex((x) => normalizeText(x.className) === ck)
    if (idx < 0) { inst.classes.push(c); continue }
    const cur = inst.classes[idx]!
    if (c.participants.length > cur.participants.length || (c.participants.length === cur.participants.length && mcount(c) > mcount(cur))) inst.classes[idx] = c
  }
}
const skips: string[] = [] // SKIP_DIAG: パース0/エラーで取り込めなかったソースの記録（取りこぼし監査用）
// HTML by cid
const htmlByCid = new Map<string, { name: string | null; date: string | null; classes: ParsedClass[] }>()
for (const d of readdirSync(ROOT).filter((x) => /^\d{4}_html$/.test(x))) for (const f of readdirSync(join(ROOT, d))) {
  if (!f.endsWith('.html')) continue
  const cid = f.split('_')[0]!; const r = parseResultHtml(readFileSync(join(ROOT, d, f), 'utf8'))
  if (!r.classes.length) { if (process.env.SKIP_DIAG) skips.push('html\t' + d + '/' + f + '\t0class'); continue }
  let g = htmlByCid.get(cid); if (!g) { g = { name: r.tournamentName, date: r.eventDate, classes: [] }; htmlByCid.set(cid, g) }
  g.name ||= r.tournamentName; g.date ||= r.eventDate; g.classes.push(...r.classes)
}
for (const [cid, g] of htmlByCid) add(g.name, g.date, g.classes, 'h:' + cid)
// Excel
const newIdx = new Map<string, { title: string; date: string }>()
const nidx = join(ROOT, 'new_download_index.csv')
if (existsSync(nidx)) for (const line of readFileSync(nidx, 'utf8').split('\n').slice(1)) {
  if (!line.trim()) continue
  const mdl = line.split(',')[0]!.replace(/^﻿/, '').trim(); const dm = line.match(/(20\d{2})[.\/](\d{1,2})[.\/](\d{1,2})/)
  const tm = line.match(/,(第[^,]*?(?:大会|選手権|百人一首|記念杯|名人|クイーン|甲子園)[^,]*?),\s*20\d{2}[.\/]/)
  if (dm) newIdx.set(mdl, { title: tm ? tm[1]! : '', date: `${dm[1]}-${String(+dm[2]!).padStart(2, '0')}-${String(+dm[3]!).padStart(2, '0')}` })
}
for (const line of readFileSync('c:/tmp/assess_input.jsonl', 'utf8').split('\n').filter(Boolean)) {
  const rec = JSON.parse(line); if (rec.error) { if (process.env.SKIP_DIAG) skips.push('xls\t' + rec.src + '/' + rec.file + '\terror:' + String(rec.error).slice(0, 30)); continue }
  let classes: ParsedClass[]; try { classes = parseResultExcel(rec.sheets) } catch (e) { if (process.env.SKIP_DIAG) skips.push('xls\t' + rec.src + '/' + rec.file + '\tthrow:' + (e instanceof Error ? e.message.slice(0, 40) : '')); continue }
  if (!classes.length) { if (process.env.SKIP_DIAG) skips.push('xls\t' + rec.src + '/' + rec.file + '\t0class'); continue }
  let name: string | null = null, date: string | null = null
  if (rec.src === 'new') { const ix = newIdx.get(String(rec.file).replace(/\.[^.]+$/, '')); if (ix) { name = ix.title || null; date = ix.date } }
  if (!date || !name) { const m = excelMeta(rec.sheets); date ??= m.date; name ??= m.name }
  if (!name) name = `[file]${rec.src}/${rec.file}`
  add(name, date, classes, 'e:' + rec.src + '/' + rec.file)
}

// ── manual recovery (桑名 calamine / 兵庫 N回 / 大垣 ID-format) ──
const recPath = 'c:/tmp/recovery.jsonl'
if (existsSync(recPath)) {
  for (const line of readFileSync(recPath, 'utf8').split('\n').filter(Boolean)) {
    const rec = JSON.parse(line) as { kind: string; tournament: string; name: string; date: string | null; sheets?: never; classes?: ParsedClass[] }
    const classes: ParsedClass[] = rec.kind === 'grids' ? parseResultExcel(rec.sheets!) : rec.classes!
    add(rec.name, rec.date, classes, 'recover:' + rec.tournament)
  }
}

if (process.env.SKIP_DIAG) {
  const byR = new Map<string, number>()
  for (const s of skips) { const r = (s.split('\t')[2] ?? '').split(':')[0]; byR.set(r, (byR.get(r) ?? 0) + 1) }
  console.log('SKIPS total=' + skips.length + ' ' + [...byR].map(([k, v]) => k + '=' + v).join(' '))
  for (const s of skips) console.log('  ' + s)
  process.exit(0)
}
let instances = [...map.values()]
if (process.env.RECOVERY_ONLY) instances = instances.filter((i) => i.rec) // load only the 桑名/兵庫/大垣 recoveries
if (process.env.TARGET) instances = instances.filter((i) => i.name?.includes(process.env.TARGET!)) // diag: load only matching

// ===== data clean: 非選手行除外 + 順位ラベル救済 + ?? 復旧（ソース稀字崩れ） =====
// 根本原因: A=Excelパーサが見出し/集計/順位表 section を participant 化, B=ソースHTML自体が
// 稀字(吉/𠮷/橋/中国漢字…)を ? 化(かるた協会サイト起因)。B は他大会の正常名とスケルトン一意一致で復旧。
if (!process.env.NO_CLEAN) {
  const nf = (s: string | null | undefined) => (s ?? '').normalize('NFKC').trim()
  // Excel _xHHHH_ エスケープ混入・先頭ゴミ記号を除去（実名は保持）
  const preClean = (s: string | null | undefined) => (s ?? '').replace(/_x[0-9A-Fa-f]{4}_/g, '').replace(/^[\s　:：;；・,，.。…]+/, '')
  // 非選手行（見出し/集計/section ラベル/大会タイトル等）。実名に出ない語のみで判定し、
  // 括弧注記付き実名「加藤優奈(埼玉)」やトレーリング数字「中村俊介1」は落とさない。
  const isHeaderJunk = (raw: string | null | undefined) => {
    const n = nf(raw); if (!n) return true
    if (/級|回戦|パート|参加者数|役員|順位|欠席|決勝|準決勝|準々決勝|予選|不戦|トーナメント|リーグ|ブロック|シード|大会|選手権|成績|報告|結果|以上|初心者|得点|勝敗/.test(n)) return true
    if (/^[(（≪《【「\[※#＃]/.test(n)) return true                       // 先頭が括弧/記号のキャプション
    if (/^[A-Za-zＡ-Ｚａ-ｚ][0-9０-９]?$/.test(n)) return true              // 単独英字/英字+数字＝級見出し
    if (/^[0-9０-９]+$/.test(n) || /[0-9０-９]+名/.test(n) || /[~〜]/.test(n)) return true  // 裸数字/「55名」/範囲
    if (/^N\/?A$/i.test(n)) return true
    return false
  }
  const isRankLabel = (raw: string | null | undefined) => /^[0-9]+位(決定戦)?$/.test(nf(raw))
  const OVERRIDE: Record<string, string> = { '?方眞佑子': '土方眞佑子', '??見遥花': '吉見遥花', '??井鯉太朗': '吉井鯉太朗', 'NemesP?ter': 'NemesPéter' }
  // 正常名プール（? 無し・非ゴミ）をスケルトン照合の参照に
  const pool = new Set<string>()
  const addPool = (s: string | null | undefined) => { const v = nf(s); if (v && !v.includes('?') && !isHeaderJunk(v) && !isRankLabel(v)) pool.add(v) }
  for (const i of instances) for (const c of i.classes) for (const p of c.participants) { addPool(p.name); for (const m of p.matches) addPool(m.opponentName) }
  const poolArr = [...pool]
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const cache = new Map<string, string | null>()
  const recover = (raw: string): string | null => {
    const n = nf(raw); if (!n.includes('?')) return null
    if (cache.has(n)) return cache.get(n)!
    let r: string | null = OVERRIDE[n] ?? null
    if (!r) { const re = new RegExp('^' + n.split(/(\?+)/).map((x) => (x.startsWith('?') ? '.' : esc(x))).join('') + '$'); const m = poolArr.filter((fn) => re.test(fn)); r = m.length === 1 ? m[0]! : null }
    cache.set(n, r); return r
  }
  let dropped = 0, swapped = 0, recovered = 0, residual = 0
  for (const i of instances) for (const c of i.classes) {
    const kept: typeof c.participants = []
    for (const p of c.participants) {
      p.name = preClean(p.name)
      if (!nf(p.name)) { dropped++; continue }
      if (isRankLabel(p.name)) {
        const aff = nf(p.affiliation)
        if (aff && !isHeaderJunk(aff) && !isRankLabel(aff)) { p.finalRank = p.finalRank ?? nf(p.name); p.name = aff; p.affiliation = null; swapped++ }
        else { dropped++; continue }
      } else if (isHeaderJunk(p.name)) { dropped++; continue }
      if (p.name.includes('?')) { const r = recover(p.name); if (r) { p.name = r; recovered++ } else residual++ }
      for (const m of p.matches) if (m.opponentName && m.opponentName.includes('?')) { const r = recover(m.opponentName); if (r) m.opponentName = r }
      kept.push(p)
    }
    c.participants = kept
  }
  console.log(`CLEAN: dropped=${dropped} rankSwapped=${swapped} recovered=${recovered} residual_?=${residual} recovMap=${[...cache.values()].filter(Boolean).length}`)
}

const tot = (sel: (c: ParsedClass) => number) => instances.reduce((a, i) => a + i.classes.reduce((b, c) => b + sel(c), 0), 0)
console.log(`instances=${instances.length} classes=${tot(() => 1)} participants=${tot((c) => c.participants.length)} matches=${tot(mcount)} (dated=${instances.filter((i) => i.date).length})`)
if (process.env.DRY_RUN) { process.exit(0) }
if (process.env.DIAG) {
  const { normalizePlayerName } = await import('../mail-worker/src/result-import/normalize.ts')
  for (const inst of instances) {
    const seen = new Map<string, number>()
    let empty = 0
    for (const c of inst.classes) for (const p of c.participants) {
      const nn = normalizePlayerName(p.name)
      if (!nn) { empty++; console.log(`  EMPTY-NORM: "${p.name}" aff=${p.affiliation ?? 'null'} in ${c.className}`) }
      const key = `${nn}__${p.affiliation ? normalizePlayerName(p.affiliation) : 'NULL'}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    const dups = [...seen.entries()].filter(([, n]) => n > 1)
    console.log(`${inst.name}: parts=${inst.classes.reduce((a, c) => a + c.participants.length, 0)} emptyNorm=${empty} intraDupKeys=${dups.length}`)
    for (const [k, n] of dups.slice(0, 8)) console.log(`    DUP×${n}: ${k}`)
  }
  process.exit(0)
}
const LIMIT = parseInt(process.env.REHEARSE_LIMIT || '0', 10)
if (LIMIT > 0 && LIMIT < instances.length) { const stride = instances.length / LIMIT; instances = Array.from({ length: LIMIT }, (_, i) => instances[Math.floor(i * stride)]!) }
const HEAD = parseInt(process.env.HEAD || '0', 10)
if (HEAD > 0) instances = instances.slice(0, HEAD) // diag: load only first N in order (fails repro ~250-300)
console.log(`loading ${instances.length} instances (of ${map.size})`)

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool, { schema })
let ok = 0, fail = 0, parts = 0, matchesN = 0
const errors: string[] = []
const t0 = Date.now()
for (let i = 0; i < instances.length; i++) {
  const inst = instances[i]!
  const payload = { parserVersion: 'bulk-1.1.0', classes: inst.classes }
  try {
    await db.transaction(async (tx) => {
      await materializeResultDraft(tx as never, payload, { tournamentName: inst.name, eventDate: inst.date, venue: null, sourceResultDraftId: null as never })
    })
    ok++; parts += inst.classes.reduce((a, c) => a + c.participants.length, 0); matchesN += inst.classes.reduce((a, c) => a + c.participants.reduce((b, p) => b + p.matches.length, 0), 0)
  } catch (e) { fail++; const msg = `${inst.name} :: ${e instanceof Error ? ((e as { cause?: { message?: string } }).cause?.message ?? e.message) : String(e)}`; console.log('FAIL>> ' + msg.slice(0, 600)); if (errors.length < 30) errors.push(msg.slice(0, 400)) }
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${instances.length} ok=${ok} fail=${fail} (${Math.round((Date.now() - t0) / 1000)}s)`)
}
console.log(`DONE ok=${ok} fail=${fail} parts=${parts} matches=${matchesN} in ${Math.round((Date.now() - t0) / 1000)}s`)
if (errors.length) { console.log('--- errors ---'); errors.forEach((e) => console.log('  ' + e)) }
await pool.end()
