import { RoutingResultSchema } from '@kagetra/mail-worker/result-import/ai/routing-schema'

/**
 * tournament-results タスク5: 承認画面の「AI 所見カード」の表示分岐を純関数化
 * したもの。page.tsx（Server Component）はこの結果を描画するだけにする —
 * AC-3(対象外警告) / AC-9(AI 抽出由来) / AC-17(訂正版促し) の判定ロジックを
 * jsdom を介さずテストするため。
 */

export type AiNoticeTone = 'warn' | 'danger' | 'info' | 'neutral'

export type AiNotice = {
  tone: AiNoticeTone
  title: string
  /** 単文の説明。`items` と排他ではないが通常はどちらか一方を使う。 */
  body?: string
  /** 箇条書きで出す項目（AI issues 用）。 */
  items?: string[]
}

export type AiNoticeDraftInput = {
  aiRouting: unknown
  aiError: string | null
  extractionSource: string | null
  parserVersion: string
  /**
   * result_drafts.status（Codex R1 修正4）。`aiError` の文言分岐に使う —
   * `parse_failed` は決定的パース結果が存在せず保存 payload も `{}` なので、
   * 「決定的パース結果のみを表示しています」という案内は誤り。
   */
  status: string
}

const OUT_OF_SCOPE_LABEL: Record<'team' | 'roster_or_lottery' | 'other', string> = {
  team: '団体戦の結果の可能性があります。',
  roster_or_lottery: '出場者名簿・抽選結果の可能性があります。',
  other: '大会結果ではない可能性があります。',
}

export function buildAiNotices(draft: AiNoticeDraftInput): AiNotice[] {
  // AI 列が全て null（＝AI を通していない旧データ）→ カード自体を出さない。
  if (draft.aiRouting == null && draft.aiError == null && draft.extractionSource == null) {
    return []
  }

  const notices: AiNotice[] = []

  if (draft.aiError != null) {
    if (draft.status === 'parse_failed') {
      // PDF サイズ超過・PDF/0クラス Excel の抽出失敗など、決定的パース結果が
      // 存在しない失敗。「決定的パース結果のみを表示」は実際には無い結果が
      // あるかのように誤認させるため、失敗のみを伝える文言にする。
      notices.push({
        tone: 'warn',
        title: 'AI 検証なし',
        body: `AI 抽出に失敗し、表示できる結果はありません。（${draft.aiError}）`,
      })
    } else {
      notices.push({
        tone: 'warn',
        title: 'AI 検証なし',
        body: `AI 呼び出しが失敗したため、決定的パース結果のみを表示しています。（${draft.aiError}）`,
      })
    }
  }

  const routingParsed = RoutingResultSchema.safeParse(draft.aiRouting)
  const routing = routingParsed.success ? routingParsed.data : null

  if (routing?.verdict === 'out_of_scope') {
    const label = OUT_OF_SCOPE_LABEL[routing.outOfScopeKind ?? 'other']
    notices.push({
      tone: 'danger',
      title: '対象外の可能性',
      body: `${label}取り込む前に内容を必ず確認してください。`,
    })
  }

  if (routing?.meta.isCorrection === true) {
    notices.push({
      tone: 'warn',
      title: '訂正版の可能性',
      body: '訂正版・再送の可能性があります。既に取り込んだ級がある場合は差し替えを検討してください。',
    })
  }

  if (draft.extractionSource === 'ai') {
    notices.push({
      tone: 'info',
      title: 'AI 抽出（要注意レビュー）',
      body: `パーサ ${draft.parserVersion} ではなく AI がフル抽出した結果です。内容を注意して確認してください。`,
    })
  }

  if (routing && routing.issues.length > 0) {
    notices.push({
      tone: 'neutral',
      title: 'AI からの指摘事項',
      items: routing.issues,
    })
  }

  return notices
}
