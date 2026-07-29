/**
 * 振込締切の「日付」と「状態」を必ず整合させるための共有ヘルパー
 * （mail-ai-extract-refinements requirements §3.2.7）。
 *
 * `events` には CHECK `(payment_deadline IS NOT NULL) = (payment_deadline_kind =
 * 'fixed')` が張ってあるので、**この2列は必ずセットで書く**。片方だけ書く経路が
 * 1つでもあると本番で 500 になる。イベントを書く経路は
 *
 *   - `/events/new`（作成フォーム）
 *   - `/events/[id]/edit`（編集フォーム）
 *   - `approveDraft` / `approveDraftUnits`（メール承認）
 *   - `propagateFieldsToGroup`（申込グループへの伝播）
 *
 * の4つで、前者3つは `eventFormSchema` を通るため正規化はそこに1箇所置けば足りる。
 * 伝播だけは差分ハッシュを直接 UPDATE するので、`entry-groups.ts` 側で2列を
 * 束ねて扱う（`PROPAGATABLE_FIELD_KEYS` の注記を参照）。
 */

export const PAYMENT_DEADLINE_KINDS = ['fixed', 'later_notice', 'unspecified'] as const

export type PaymentDeadlineKind = (typeof PAYMENT_DEADLINE_KINDS)[number]

/** DB は英語値・UI は日本語表示（§3.2.7）。 */
export const PAYMENT_DEADLINE_KIND_LABELS: Record<PaymentDeadlineKind, string> = {
  fixed: '日付あり',
  later_notice: '後日連絡',
  unspecified: '締切未設定',
}

export function isPaymentDeadlineKind(value: unknown): value is PaymentDeadlineKind {
  return (
    typeof value === 'string' &&
    (PAYMENT_DEADLINE_KINDS as readonly string[]).includes(value)
  )
}

/**
 * 日付と状態を CHECK 制約を満たす組み合わせへ倒す。**日付が正**:
 *
 * - 日付があれば状態は必ず `fixed`（人が「後日連絡」のまま日付を入れても矛盾しない）
 * - 日付が無いのに `fixed` が来たら `unspecified` へ落とす
 * - 日付が無く `later_notice` / `unspecified` ならそのまま
 *
 * クライアント側のバリデーションだけに頼ると CHECK 違反で 500 になるため、
 * **サーバー側で必ず通す**こと（AC-43）。
 */
export function normalizePaymentDeadline(input: {
  paymentDeadline?: string | null
  paymentDeadlineKind?: string | null
}): { paymentDeadline: string | null; paymentDeadlineKind: PaymentDeadlineKind } {
  const paymentDeadline = input.paymentDeadline ?? null
  if (paymentDeadline !== null) {
    return { paymentDeadline, paymentDeadlineKind: 'fixed' }
  }
  const kind = input.paymentDeadlineKind
  if (kind === 'later_notice') {
    return { paymentDeadline: null, paymentDeadlineKind: 'later_notice' }
  }
  return { paymentDeadline: null, paymentDeadlineKind: 'unspecified' }
}

/**
 * AI 抽出ペイロードの `payment_deadline_kind`（日本語3値）を DB の英語 enum へ写す。
 * 未知の値・欠落は `unspecified`（＝「読み取れなかった」に倒す。`later_notice` は
 * 「案内に後日連絡と明記されていた」という積極的な主張なので、推測で選ばない）。
 */
export function paymentDeadlineKindFromPayload(value: unknown): PaymentDeadlineKind {
  if (value === '日付あり') return 'fixed'
  if (value === '後日連絡') return 'later_notice'
  return 'unspecified'
}

/**
 * 申込管理ボード・イベント詳細の表示文字列（AC-42 / AC-44）。
 * `fixed` は日付そのものを出す画面が多いので、ここでは日付を渡してもらう。
 */
export function formatPaymentDeadline(
  paymentDeadline: string | null,
  kind: PaymentDeadlineKind,
  formatDate: (iso: string) => string,
): string {
  if (kind === 'fixed' && paymentDeadline) return formatDate(paymentDeadline)
  return PAYMENT_DEADLINE_KIND_LABELS[kind]
}
