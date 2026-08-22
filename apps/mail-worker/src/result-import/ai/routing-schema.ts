import { z } from 'zod'

/**
 * AI ルーティング(`record_routing` ツール)の出力スキーマ。
 *
 * `classify/llm/anthropic.ts` と同様に `z.toJSONSchema(RoutingResultSchema,
 * { target: 'draft-7', io: 'input' })` で Anthropic の tool `input_schema` に
 * 変換される。そのため **`.optional()` は使わない**(モデルがフィールドを
 * 省略できてしまう) — 値が無いケースは全て `.nullable()` で `null` を返させる。
 * `.default()` も同じ理由で使わない(JSON Schema には既定値のフォールバック
 * が存在せず、classify で実際に「properties が空の JSON Schema が生成され
 * Anthropic へ制約無しで送られていた」罠を踏んだことがある — 詳細は
 * `classify/llm/anthropic.ts` の `extract()` 内コメント参照)。
 */

export const RoutingGradeSchema = z.enum(['A', 'B', 'C', 'D', 'E']).nullable()

export const OutOfScopeKindSchema = z
  .enum(['team', 'roster_or_lottery', 'other'])
  .nullable()

export const ClassMapEntrySchema = z.object({
  // 決定的パーサが返した className(正規化前の原値)。
  className: z.string(),
  // AI が判定した正規化後の級名(例: "A級")。
  normalizedClassName: z.string(),
  grade: RoutingGradeSchema,
  // true のとき、このクラスは結果配列から除外する(選手一覧シート等の非級シート)。
  exclude: z.boolean(),
  note: z.string().nullable(),
})

export const RoutingMetaSchema = z.object({
  tournamentName: z.string().nullable(),
  editionNumber: z.number().int().nullable(),
  eventDate: z.string().nullable(),
  isCorrection: z.boolean(),
})

export const RoutingResultSchema = z.object({
  verdict: z.enum(['adopt', 'escalate', 'out_of_scope']),
  outOfScopeKind: OutOfScopeKindSchema,
  classMap: z.array(ClassMapEntrySchema),
  meta: RoutingMetaSchema,
  issues: z.array(z.string()),
})

export type RoutingGrade = z.infer<typeof RoutingGradeSchema>
export type OutOfScopeKind = z.infer<typeof OutOfScopeKindSchema>
export type ClassMapEntry = z.infer<typeof ClassMapEntrySchema>
export type RoutingMeta = z.infer<typeof RoutingMetaSchema>
export type RoutingResult = z.infer<typeof RoutingResultSchema>
