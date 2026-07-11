// Probe: for the 100 target files, parse them exactly like the loader and report
// (file -> parsed name/date/nclass/nmatch). Output JSON to c:/tmp/_probe_out.json.
// No DB writes.
import { parseResultHtml } from '../mail-worker/src/result-import/html-parser.ts'
import { parseResultExcel } from '../mail-worker/src/result-import/parser.ts'
import { normalizeText } from '../mail-worker/src/result-import/normalize.ts'
import type { ParsedClass } from '../mail-worker/src/result-import/schema.ts'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'c:/tmp/karuta_results'
function extractDate(text: string): string | null {
  const t = text.normalize('NFKC')
  const iso = t.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/); if (iso) return `${iso[1]}-${String(+iso[2]!).padStart(2,'0')}-${String(+iso[3]!).padStart(2,'0')}`
  const w = t.match(/(令和|平成|昭和)\s*(元|\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (w){const yr=w[2]==='元'?1:+w[2]!;const base=w[1]==='令和'?2018:w[1]==='平成'?1988:1925;return `${base+yr}-${String(+w[3]!).padStart(2,'0')}-${String(+w[4]!).padStart(2,'0')}`}
  const g = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/); if (g) return `${g[1]}-${String(+g[2]!).padStart(2,'0')}-${String(+g[3]!).padStart(2,'0')}`
  const dot = t.match(/(20\d{2})[.\/](\d{1,2})[.\/](\d{1,2})/); if (dot) return `${dot[1]}-${String(+dot[2]!).padStart(2,'0')}-${String(+dot[3]!).padStart(2,'0')}`
  return null
}
function excelMeta(sheets:{name:string;grid:(string|null)[][]}[]):{name:string|null;date:string|null}{
  let name:string|null=null,date:string|null=null
  for(const s of sheets){
    for(let r=0;r<Math.min(s.grid.length,30)&&!date;r++)for(const cell of s.grid[r]??[])if(cell){const d=extractDate(String(cell));if(d){date=d;break}}
    for(let r=0;r<Math.min(s.grid.length,6)&&!name;r++)for(const cell of s.grid[r]??[]){
      if(!cell)continue;const c=normalizeText(String(cell))
      if(c.length<6||!/(大会|選手権|杯|甲子園|名人|クイーン)/.test(c)||/開催|会場|主催|主管|参加者|期日|於|案内|入力|使用方法|歴代|頁/.test(c))continue
      name=c;break
    }
    if(name&&date)break
  }
  return {name,date}
}
const mcount=(c:ParsedClass)=>c.participants.reduce((a,p)=>a+p.matches.length,0)

// assess_input map
const assess=new Map<string,any>()
for(const line of readFileSync('c:/tmp/assess_input.jsonl','utf8').split('\n').filter(Boolean)){
  const r=JSON.parse(line); assess.set(`${r.src}/${r.file}`,r)
}
const resolved=JSON.parse(readFileSync('c:/tmp/_resolved.json','utf8'))
const out:any[]=[]
for(const t of resolved){
  const fileReports:any[]=[]
  const pnames:string[]=[]
  for(const f of t.files){
    const id=`${f.src}/${f.file}`
    let nclass=0,nmatch=0,name:string|null=null,date:string|null=null,err=''
    try{
      if(f.src==='html'){
        const p=join(ROOT,f.file)
        if(existsSync(p)){const r=parseResultHtml(readFileSync(p,'utf8'));nclass=r.classes.length;nmatch=r.classes.reduce((a,c)=>a+mcount(c),0);name=r.tournamentName;date=r.eventDate;for(const c of r.classes)for(const pp of c.participants)pnames.push(normalizeText(pp.name))}
        else err='nofile'
      }else{
        const rec=assess.get(id)
        if(!rec)err='no_assess'
        else if(rec.error)err='assess_error'
        else{const cls=parseResultExcel(rec.sheets);nclass=cls.length;nmatch=cls.reduce((a:number,c:ParsedClass)=>a+mcount(c),0);const m=excelMeta(rec.sheets);name=m.name;date=m.date;for(const c of cls)for(const p of c.participants)pnames.push(normalizeText(p.name))}
      }
    }catch(e){err='throw:'+(e instanceof Error?e.message.slice(0,30):'')}
    fileReports.push({id,nclass,nmatch,name,date,err})
  }
  out.push({series:t.series,ed:t.ed,year:t.year,status:t.status,files:fileReports,pnames:[...new Set(pnames)].filter(Boolean)})
}
writeOut(out)
import { writeFileSync } from 'node:fs'
function writeOut(o:any){writeFileSync('c:/tmp/_probe_out.json',JSON.stringify(o,null,1),'utf8')}
console.log('probed',out.length,'targets ->',out.reduce((a,t)=>a+t.files.length,0),'files')
