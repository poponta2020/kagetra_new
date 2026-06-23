import { HTMLElement, NodeType, parse } from 'node-html-parser'
import { deriveGrade, normalizeText } from './normalize.js'
import { parseRoundCellText } from './round-cell.js'
import type { ParsedClass, ParsedMatch, ParsedParticipant } from './schema.js'

export const HTML_PARSER_VERSION = '1.0.0'

export interface ParsedHtmlResult {
  /** 大会名 from the page <h2>. */
  tournamentName: string | null
  /** 開催日 as 'YYYY-MM-DD' from the heading 「(YYYY年MM月DD日)」. */
  eventDate: string | null
  /** Normally length 1 — one harvested HTML file = one 級 page. */
  classes: ParsedClass[]
}

/**
 * Parse a harvested 全日本かるた協会 result page (`table.tournament_tree`) into the
 * same `ParsedClass[]` contract as parseResultExcel, plus the in-page 大会名/開催日.
 *
 * DOM (confirmed against the real corpus, e.g. 2017_html/981_4641.html):
 *   <div ...><h2>大会名</h2>(YYYY年MM月DD日)</div>
 *   <li class="TabbedPanelsTabSelected">A</li>            ← 級 = selected tab
 *   <table class="tournament_tree">
 *     <tr><th>選手名</th><th>1回戦</th>…<th>N回戦</th></tr>
 *     <tr><td class="result_cell">氏名<br/>（所属）</td>
 *         <td class="result_cell"> ○ 4 相手 </td> … </tr>
 *
 * 不戦 (bye) cells are emitted with broken markup — the result_cell closes after
 * 不戦 and a class-less <td> follows for the next round — so we iterate ALL <td>
 * (not just td.result_cell) to keep round numbers aligned with the columns.
 *
 * Player names are stored RAW (only normalizeText'd); player dedup / opponent
 * resolution via normalizePlayerName is the consumer's (materialize) job, so own
 * and opponent names are kept in the same representation here.
 */
export function parseResultHtml(html: string): ParsedHtmlResult {
  const root = parse(html)

  const tournamentName = extractTournamentName(root)
  const eventDate = extractEventDate(root)
  const className = extractClassName(root)

  const table = root.querySelector('table.tournament_tree')
  if (!table || !className) {
    return { tournamentName, eventDate, classes: [] }
  }

  const rows = table.querySelectorAll('tr')
  const headerLabels = extractHeaderLabels(rows)

  const participants: ParsedParticipant[] = []
  for (const tr of rows) {
    if (tr.querySelectorAll('th').length > 0) continue // header row
    const tds = tr.querySelectorAll('td')
    const nameTd = tds[0]
    if (!nameTd) continue
    const { name, affiliation } = parseNameCell(nameTd)
    if (!name) continue

    const matches: ParsedMatch[] = []
    for (let i = 1; i < tds.length; i++) {
      const td = tds[i]
      if (!td) continue
      const cell = parseRoundCellText(td.text)
      if (cell.empty || cell.result === null) continue
      matches.push({
        round: i, // td[1] = round 1, td[2] = round 2, …
        roundLabel: headerLabels[i] ?? `${i}回戦`,
        opponentName: cell.opponentName,
        scoreDiff: cell.scoreDiff,
        result: cell.result,
        status: cell.status,
      })
    }

    participants.push({
      seqNo: null,
      name,
      nameKana: null,
      affiliation,
      prefecture: null,
      dan: null,
      memberNo: null,
      finalRank: null,
      matches,
    })
  }

  if (participants.length === 0) {
    return { tournamentName, eventDate, classes: [] }
  }

  const classes: ParsedClass[] = [
    {
      className,
      grade: deriveGrade(className),
      sheetName: null,
      participants,
    },
  ]
  return { tournamentName, eventDate, classes }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function extractTournamentName(root: HTMLElement): string | null {
  const h2 = root.querySelector('h2')
  if (!h2) return null
  return normalizeText(h2.text) || null
}

function extractEventDate(root: HTMLElement): string | null {
  const h2 = root.querySelector('h2')
  // The date is a text sibling of <h2> inside the heading <div>; fall back to
  // the whole document if the structure differs.
  const scoped = h2?.parentNode?.text
  return matchDate(scoped) ?? matchDate(root.text)
}

function matchDate(text: string | undefined): string | null {
  if (!text) return null
  const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
}

function extractClassName(root: HTMLElement): string | null {
  const tab = root.querySelector('.TabbedPanelsTabSelected')
  if (!tab) return null
  return normalizeText(tab.text) || null
}

function extractHeaderLabels(rows: HTMLElement[]): string[] {
  const headerTr = rows.find((tr) => tr.querySelectorAll('th').length > 0)
  if (!headerTr) return []
  return headerTr.querySelectorAll('th').map((th) => normalizeText(th.text))
}

/** Split a `氏名<br/>（所属）` result cell into its name and affiliation. */
function parseNameCell(cell: HTMLElement): { name: string; affiliation: string | null } {
  let before = ''
  let after = ''
  let seenBr = false
  for (const node of cell.childNodes) {
    if (
      node.nodeType === NodeType.ELEMENT_NODE &&
      (node as HTMLElement).rawTagName.toLowerCase() === 'br'
    ) {
      seenBr = true
      continue
    }
    if (seenBr) after += node.text
    else before += node.text
  }
  const name = normalizeText(before)
  const affiliation = normalizeText(after)
    .replace(/^[（(]+/, '')
    .replace(/[）)]+$/, '')
    .trim()
  return { name, affiliation: affiliation || null }
}
