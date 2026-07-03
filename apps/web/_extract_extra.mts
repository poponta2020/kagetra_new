// 個人戦の取りこぼし救済: 671 愛知シニア級(総当たり星取表) と 570 多摩Ｆ級(標準行形式) を抽出。
// APPEND=1 で c:/tmp/recovery.jsonl に追記。まず print で検証する。
import { readFileSync, appendFileSync } from 'node:fs'
type Grid = (string | null)[][]
type P = { seqNo: number; name: string; nameKana: null; affiliation: string | null; prefecture: null; dan: null; memberNo: null; finalRank: string | null; matches: M[] }
type M = { round: number; roundLabel: null; opponentName: string | null; scoreDiff: number | null; result: 'win' | 'lose'; status: 'normal' | 'walkover' | 'forfeit' }
const idx = new Map<string, { src: string; file: string; sheets: { name: string; grid: Grid }[] }>()
for (const line of readFileSync('c:/tmp/assess_input.jsonl', 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(line); idx.set(r.src + '/' + r.file, r) }
const C = (g: Grid, r: number, c: number) => String(g[r]?.[c] ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
const scoreMatch = (v: string): M | null => {
  const m = v.match(/^([○×〇])\s*(\d+|譲り|不戦)?/)
  if (!m) return null
  const result = m[1] === '×' ? 'lose' : 'win'
  if (m[2] === '譲り' || m[2] === '不戦') return { round: 0, roundLabel: null, opponentName: null, scoreDiff: null, result, status: result === 'win' ? 'walkover' : 'forfeit' }
  return { round: 0, roundLabel: null, opponentName: null, scoreDiff: m[2] ? parseInt(m[2], 10) : null, result, status: 'normal' }
}
const out: { kind: string; tournament: string; name: string; date: string | null; classes: { className: string; grade: string | null; sheetName: string; participants: P[] }[] }[] = []

// ===== 671 愛知シニア級（総当たり）=====
{
  const g = idx.get('static/671_dai16kai_aichi_result_senior.xls')!.sheets.find((s) => s.name.includes('シニア'))!.grid
  const parts: P[] = []
  for (let r = 0; r < g.length; r++) {
    if (C(g, r, 1) !== '番号') continue
    const oppCols: number[] = []
    for (let c = 4; c < (g[r]?.length ?? 0); c++) { const h = C(g, r, c); if (h && !h.includes('順位')) oppCols.push(c) }
    for (let rr = r + 1; rr < g.length && C(g, rr, 2); rr++) {
      const name = C(g, rr, 2), aff = C(g, rr, 3) || null
      const matches: M[] = []
      for (const c of oppCols) { const opp = C(g, r, c); if (!opp || opp === name) continue; const m = scoreMatch(C(g, rr, c)); if (m) { m.opponentName = opp; m.round = matches.length + 1; matches.push(m) } }
      parts.push({ seqNo: parts.length + 1, name, nameKana: null, affiliation: aff, prefecture: null, dan: null, memberNo: null, finalRank: null, matches })
    }
  }
  // 優勝決定戦（氏名|所属|相手|結果）
  for (let r = 0; r < g.length; r++) {
    if (!/決定戦/.test(C(g, r, 0))) continue
    for (let rr = r + 1; rr < g.length; rr++) {
      const name = C(g, rr, 2), opp = C(g, rr, 4), res = C(g, rr, 5)
      if (!name || !opp) continue
      const m = scoreMatch(res); if (!m) continue
      m.opponentName = opp; m.round = 1; m.roundLabel = null
      const p = parts.find((x) => x.name === name); if (p) p.matches.push(m)
    }
  }
  out.push({ kind: 'classes', tournament: 'aichi16_senior', name: '第16回全国かるた愛知大会（シニア級）', date: '2014-12-14', classes: [{ className: 'シニア級', grade: null, sheetName: '対戦結果表_シニア級', participants: parts }] })
}

// ===== 570 多摩（個人: Ｆ級・シニア。団体セクションは除外）=====
{
  const g = idx.get('static/570_2014_tama_syosinsya_kekka4.xls')!.sheets[0]!.grid
  const classes: { className: string; grade: string | null; sheetName: string; participants: P[] }[] = []
  for (let r = 0; r < g.length; r++) {
    // 個人テーブル見出し = 番号|氏名|所属（団体は 番号|所属|氏名 なので除外）
    if (!(C(g, r, 0) === '番号' && C(g, r, 1) === '氏名' && C(g, r, 2) === '所属')) continue
    const secName = C(g, r - 1, 0) || '個人'
    const parts: P[] = []
    for (let rr = r + 1; rr < g.length; rr++) {
      const name = C(g, rr, 1); if (!name) break // 空行でセクション終了
      const aff = C(g, rr, 2) || null, rank = C(g, rr, 0)
      const matches: M[] = []
      for (let c = 3; c + 2 < (g[rr]?.length ?? 0); c += 3) {
        const opp = C(g, rr, c), sd = C(g, rr, c + 1), res = C(g, rr, c + 2)
        const bye = /不戦/.test(sd)
        if (res === '○' || res === '〇') matches.push({ round: matches.length + 1, roundLabel: null, opponentName: opp || null, scoreDiff: bye ? null : (/^\d+$/.test(sd) ? parseInt(sd, 10) : null), result: 'win', status: bye ? 'walkover' : 'normal' })
        else if (res === '×') matches.push({ round: matches.length + 1, roundLabel: null, opponentName: opp || null, scoreDiff: bye ? null : (/^\d+$/.test(sd) ? parseInt(sd, 10) : null), result: 'lose', status: bye ? 'forfeit' : 'normal' })
      }
      parts.push({ seqNo: parts.length + 1, name, nameKana: null, affiliation: aff, prefecture: null, dan: null, memberNo: null, finalRank: /優勝|位|^第/.test(rank) ? rank : null, matches })
    }
    classes.push({ className: secName, grade: secName.includes('Ｆ') ? 'E' : null, sheetName: secName, participants: parts })
  }
  out.push({ kind: 'classes', tournament: 'tama22', name: '第22回多摩百人一首かるた大会', date: null, classes })
}

for (const o of out) {
  console.log('\n■ ' + o.name + ' [' + o.classes.map((c) => c.className + ':' + c.participants.length + '人/' + c.participants.reduce((a, x) => a + x.matches.length, 0) + '戦').join(', ') + ']')
  for (const pl of o.classes[0]!.participants.slice(0, 4)) console.log('  ' + pl.name + ' (' + pl.affiliation + ') ' + (pl.finalRank ?? '') + ' : ' + pl.matches.map((m) => (m.result === 'win' ? '○' : '×') + (m.scoreDiff ?? m.status) + 'vs' + m.opponentName).join('  '))
  const last = o.classes[o.classes.length - 1]!
  if (o.classes.length > 1) console.log('  …末クラス ' + last.className + ' 例: ' + last.participants.slice(0, 2).map((p) => p.name).join(', '))
}
if (process.env.APPEND) { for (const o of out) appendFileSync('c:/tmp/recovery.jsonl', JSON.stringify(o) + '\n'); console.log('\n→ APPENDED ' + out.length + ' entries to recovery.jsonl') }
