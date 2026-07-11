// TARGETS 指定時は詳細(行表示)、無指定時は全 skip を要約
import { readFileSync } from 'node:fs'
import { parseResultExcel } from '../mail-worker/src/result-import/parser.ts'
type Rec = { src: string; file: string; error?: unknown; sheets: { name: string; grid: (string | null)[][] }[] }
const idx = new Map<string, Rec>()
for (const line of readFileSync('c:/tmp/assess_input.jsonl', 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(line) as Rec; idx.set(r.src + '/' + r.file, r) }
const targets = (process.env.TARGETS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const rows = parseInt(process.env.ROWS ?? '14', 10)
const title = (rec: Rec) => { for (const s of rec.sheets) for (let r = 0; r < 4; r++) for (const c of s.grid[r] ?? []) if (c && String(c).trim().length > 4) return String(c).trim(); return '' }

if (targets.length) {
  for (const [k, rec] of idx) {
    if (!targets.some((t) => k.includes(t))) continue
    console.log('\n===== ' + k + ' =====')
    if (rec.error) { console.log('ERROR'); continue }
    for (const s of rec.sheets.slice(0, 3)) {
      console.log('--- "' + s.name + '" (' + s.grid.length + '行) ---')
      for (let r = 0; r < Math.min(s.grid.length, rows); r++) console.log('  ' + r + ': ' + JSON.stringify((s.grid[r] ?? []).slice(0, 9).map((c) => (c == null ? '' : String(c)))))
    }
    let n = 0; try { n = parseResultExcel(rec.sheets).length } catch (e) { console.log('THREW ' + (e instanceof Error ? e.message : '')); n = -1 }
    console.log('→ parse=' + n)
  }
} else {
  const skipText = readFileSync('c:/tmp/skips.txt', 'utf8')
  const files = [...new Set([...skipText.matchAll(/(?:static|new)\/[^\t\r\n ]+\.xlsx?/g)].map((m) => m[0]))]
  for (const f of files) { const rec = idx.get(f); if (!rec) { console.log(f + ' | idx無'); continue }; let n = 0; if (rec.error) { console.log(f + ' | ERROR'); continue }; try { n = parseResultExcel(rec.sheets).length } catch { n = -1 }; console.log(f.padEnd(28) + ' p=' + n + ' ' + title(rec).slice(0, 50)) }
}
