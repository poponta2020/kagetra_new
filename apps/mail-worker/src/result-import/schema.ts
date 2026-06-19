import { z } from 'zod'

export const MatchStatusSchema = z.enum(['normal', 'walkover', 'forfeit'])
export const MatchResultSchema = z.enum(['win', 'lose'])
export const GradeSchema = z.enum(['A', 'B', 'C', 'D', 'E']).nullable()

export const ParsedMatchSchema = z.object({
  round: z.number().int().positive(),
  roundLabel: z.string().nullable(),
  opponentName: z.string().nullable(),
  scoreDiff: z.number().int().nullable(),
  result: MatchResultSchema,
  status: MatchStatusSchema,
})

export const ParsedParticipantSchema = z.object({
  seqNo: z.number().int().positive().nullable(),
  name: z.string().min(1),
  nameKana: z.string().nullable(),
  affiliation: z.string().nullable(),
  prefecture: z.string().nullable(),
  dan: z.string().nullable(),
  memberNo: z.string().nullable(),
  finalRank: z.string().nullable(),
  matches: z.array(ParsedMatchSchema),
})

export const ParsedClassSchema = z.object({
  className: z.string().min(1),
  grade: GradeSchema,
  sheetName: z.string().nullable(),
  participants: z.array(ParsedParticipantSchema),
})

export const ParsedResultPayloadSchema = z.object({
  parserVersion: z.string(),
  classes: z.array(ParsedClassSchema),
})

export type ParsedMatch = z.infer<typeof ParsedMatchSchema>
export type ParsedParticipant = z.infer<typeof ParsedParticipantSchema>
export type ParsedClass = z.infer<typeof ParsedClassSchema>
export type ParsedResultPayload = z.infer<typeof ParsedResultPayloadSchema>
