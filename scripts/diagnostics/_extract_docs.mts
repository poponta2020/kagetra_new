// Extract the 14 legacy .doc files (PDF/Word-only tournaments) to UTF-8 text via word-extractor.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import WordExtractor from 'word-extractor'
const manifest = JSON.parse(readFileSync('c:/tmp/_pdf_files.json', 'utf8'))
const ex = new WordExtractor()
let n = 0
for (const t of manifest) {
  for (const f of t.files) {
    if (!['doc', 'docx'].includes((f.ext || '').toLowerCase())) continue
    try {
      const doc = await ex.extract(readFileSync(f.path))
      const body = doc.getBody().trim()
      const tb = doc.getTextboxes({ includeHeadersAndFooters: false }).trim()
      const text = [body, tb].filter(Boolean).join('\n')
      const out = `c:/tmp/pdftext/WE_${t.mkey}_${t.ed}__${basename(f.path)}.txt`
      writeFileSync(out, text, 'utf8'); n++
      console.log(`${t.mkey}_${t.ed}: ${text.length} chars -> ${basename(out)}`)
    } catch (e) { console.log(`FAIL ${t.mkey}_${t.ed}:`, e instanceof Error ? e.message : String(e)) }
  }
}
console.log('extracted', n, 'docs')
