// recovery.jsonl の連結崩れ修復: 中括弧バランスで top-level {...} を全抽出→検証→1行ずつ再書込
import { readFileSync, writeFileSync } from 'node:fs'
const raw = readFileSync('c:/tmp/recovery.jsonl', 'utf8')
const objs: string[] = []
let depth = 0, start = -1, inStr = false, esc = false
for (let i = 0; i < raw.length; i++) {
  const ch = raw[i]!
  if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
  if (ch === '"') inStr = true
  else if (ch === '{') { if (depth === 0) start = i; depth++ }
  else if (ch === '}') { if (--depth === 0) objs.push(raw.slice(start, i + 1)) }
}
const recs = objs.map((o) => JSON.parse(o))
writeFileSync('c:/tmp/recovery.jsonl', recs.map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log('rewrote ' + recs.length + ' entries (valid JSON each)')
console.log('last 3: ' + recs.slice(-3).map((r: { tournament: string; name?: string }) => r.tournament + '(' + (r.name ?? '').slice(0, 18) + ')').join(' | '))
