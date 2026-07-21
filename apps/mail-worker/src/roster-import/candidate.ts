import type { ParsedMailMeta } from '../fetch/imap-client.js'

export type InferredRosterType = 'applicant' | 'confirmed' | null
export type InferredGrade = 'A' | 'B' | 'C' | 'D' | 'E' | null

export interface RosterCandidateSource {
  sourceKind: 'attachment' | 'body'
  attachmentIndex: number | null
  filename: string | null
  inferredRosterType: InferredRosterType
  inferredGrade: InferredGrade
}

export interface RosterCandidateDecision {
  candidate: boolean
  reasons: string[]
  inferredRosterType: InferredRosterType
  inferredGrade: InferredGrade
  sources: RosterCandidateSource[]
}

export interface RosterCandidateLimits {
  fromYear?: number
  toYear?: number
  maxCandidates: number
  maxAiCalls: number
}

export interface CollectedRosterCandidate {
  mail: ParsedMailMeta
  decision: RosterCandidateDecision
}

export interface RosterCandidateCollection {
  candidateMessages: number
  candidateAttachments: number
  candidateBodies: number
  selected: CollectedRosterCandidate[]
  skippedByCandidateLimit: number
  /** A bounded subset only. Task 3 performs no AI calls itself. */
  aiEligible: CollectedRosterCandidate[]
}

const EXPLICIT_ROSTER_WORDS = [
  '申込者名簿',
  '申込名簿',
  '申込者一覧',
  '受付名簿',
  '受付一覧',
  '確定名簿',
  '参加者名簿',
  '参加者一覧',
  '出場者名簿',
  '出場者一覧',
  '抽選結果',
  '抽選前',
  '抽選用',
  'キャンセル待ち',
  '当選者',
  '落選者',
]

const GENERAL_ROSTER_WORDS = ['名簿', '申込者', '参加者', '当落', '選考結果']
const TOURNAMENT_WORDS = ['大会', '選手権', '競技会']
const BLANK_FORM_WORDS = ['申込書', '申込用紙', 'テンプレート', '記入例', '空欄', '募集要項']
const SUPPORTED_SOURCE_EXTENSIONS = ['.xls', '.xlsx', '.xlsm', '.pdf', '.doc', '.docx', '.txt']

function normalized(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLowerCase()
}

function containsAny(value: string, words: readonly string[]): boolean {
  return words.some((word) => value.includes(word))
}

function inferRosterType(value: string): InferredRosterType {
  if (containsAny(value, ['確定名簿', '参加者名簿', '出場者名簿', '抽選結果', '当選者', '落選者', 'キャンセル待ち'])) {
    return 'confirmed'
  }
  if (containsAny(value, ['申込者', '申込名簿', '受付名簿', '受付一覧', '抽選前', '抽選用'])) {
    return 'applicant'
  }
  return null
}

function inferGrade(value: string): InferredGrade {
  const match = value.toUpperCase().match(/([A-E])\s*(?:級|クラス|CLASS)/)
  return match ? (match[1] as Exclude<InferredGrade, null>) : null
}

function supportedFilename(filename: string): boolean {
  const lower = filename.toLowerCase()
  return SUPPORTED_SOURCE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/**
 * Low-cost deterministic gate used before any structured parsing or optional
 * AI assistance. It intentionally favours review over guessing: blank entry
 * forms and generic announcements are excluded unless an explicit roster/result
 * phrase is also present.
 */
export function classifyRosterCandidate(mail: ParsedMailMeta): RosterCandidateDecision {
  const attachmentNames = mail.attachments.map((attachment) => attachment.filename).join('\n')
  const text = normalized(`${mail.subject ?? ''}\n${mail.bodyText ?? ''}\n${attachmentNames}`)
  const hasExplicitRosterWord = containsAny(text, EXPLICIT_ROSTER_WORDS)
  const hasGeneralRosterWord = containsAny(text, GENERAL_ROSTER_WORDS)
  const hasTournamentWord = containsAny(text, TOURNAMENT_WORDS)
  const looksLikeBlankForm = containsAny(text, BLANK_FORM_WORDS)
  const candidate = hasExplicitRosterWord || (hasTournamentWord && hasGeneralRosterWord && !looksLikeBlankForm)
  const inferredRosterType = inferRosterType(text)
  const inferredGrade = inferGrade(text)
  const reasons: string[] = []
  if (hasExplicitRosterWord) reasons.push('explicit_roster_keyword')
  if (hasTournamentWord && hasGeneralRosterWord) reasons.push('tournament_roster_context')
  if (looksLikeBlankForm && !hasExplicitRosterWord) reasons.push('blank_form_excluded')

  if (!candidate) {
    return { candidate: false, reasons, inferredRosterType, inferredGrade, sources: [] }
  }

  const sources: RosterCandidateSource[] = []
  mail.attachments.forEach((attachment, attachmentIndex) => {
    if (!supportedFilename(attachment.filename)) return
    const sourceText = normalized(`${mail.subject ?? ''}\n${attachment.filename}`)
    sources.push({
      sourceKind: 'attachment',
      attachmentIndex,
      filename: attachment.filename,
      inferredRosterType: inferRosterType(sourceText) ?? inferredRosterType,
      inferredGrade: inferGrade(sourceText) ?? inferredGrade,
    })
  })
  if (sources.length === 0 && normalized(mail.bodyText).length > 0) {
    sources.push({
      sourceKind: 'body',
      attachmentIndex: null,
      filename: null,
      inferredRosterType,
      inferredGrade,
    })
  }

  return { candidate: sources.length > 0, reasons, inferredRosterType, inferredGrade, sources }
}

function validateLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative integer`)
  }
}

function yearInTokyo(date: Date): number {
  return Number.parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
  }).format(date), 10)
}

export function collectRosterCandidates(
  mails: readonly ParsedMailMeta[],
  limits: RosterCandidateLimits,
): RosterCandidateCollection {
  validateLimit('maxCandidates', limits.maxCandidates)
  validateLimit('maxAiCalls', limits.maxAiCalls)
  if (limits.fromYear !== undefined && limits.toYear !== undefined && limits.fromYear > limits.toYear) {
    throw new Error('year range must have fromYear <= toYear')
  }

  const candidates: CollectedRosterCandidate[] = []
  let candidateAttachments = 0
  let candidateBodies = 0
  for (const mail of mails) {
    const year = yearInTokyo(mail.receivedAt)
    if (limits.fromYear !== undefined && year < limits.fromYear) continue
    if (limits.toYear !== undefined && year > limits.toYear) continue
    const decision = classifyRosterCandidate(mail)
    if (!decision.candidate) continue
    candidateAttachments += decision.sources.filter((source) => source.sourceKind === 'attachment').length
    candidateBodies += decision.sources.filter((source) => source.sourceKind === 'body').length
    candidates.push({ mail, decision })
  }

  const selected = candidates.slice(0, limits.maxCandidates)
  return {
    candidateMessages: candidates.length,
    candidateAttachments,
    candidateBodies,
    selected,
    skippedByCandidateLimit: Math.max(0, candidates.length - selected.length),
    aiEligible: selected.slice(0, limits.maxAiCalls),
  }
}
