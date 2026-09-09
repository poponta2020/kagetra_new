import { diffDays } from '@/lib/jst-date'

/**
 * S4 ホーム（`/dashboard`）「登録確認」バナーの表示判定（annual-registration-renewal
 * requirements R3・R4・AC-20）。
 *
 * DB に一切触れない純関数 —— `dashboard/page.tsx` が `loadMemberRenewalView`
 * （タスク5・実装済み）で読んだ値のうち判定に要るものだけを渡す。`MemberRenewalView`
 * 型をそのまま受けないのは、テストが `snapshot`/`current`/`diff` など判定に無関係な
 * フィールドまで埋める羽目にならないようにするため（構造的な部分型で受ける）。
 *
 * 出す条件（AC-20）: 進行中（`status === 'open'`）の年度確認があり、
 * 自分に**未回答のセクションがある**とき。全日協セクション未回答 ∨ 学年セクション未回答。
 * 回答すると（該当セクションが埋まると）消える。登録完了（`status === 'completed'`）
 * 後も出さない。
 *
 * ★大会の未回答アラート（`alertCountdown` の呼び出し元）と違い、**締切を過ぎても
 * 登録完了までは出し続ける**（design-spec §3）ので、`daysLeft` が負値でもここでは
 * 弾かない —— 表示側（`HomeTimeline.tsx`）が `alertCountdown` へそのまま渡す。
 */

export interface RenewalAlertSource {
  renewalStatus: 'open' | 'completed'
  /** `membership_renewals.deadline`（`YYYY-MM-DD`）。 */
  deadline: string
  isZennichikyoTarget: boolean
  isCircleTarget: boolean
  /** 全日協セクションの回答（未回答なら `null`）。 */
  answer: 'register' | 'not_register' | null
  /** 学年セクションの回答日時（未回答なら `null`）。 */
  schoolYearAnsweredAt: Date | null
}

export interface RenewalAlert {
  /** 未回答のセクション名（design-spec §3「未回答のセクション名だけ」）。 */
  label: string
  /** 今日から締切までの日数。負値＝締切超過（AC-20 により締切後も出し続ける）。 */
  daysLeft: number
}

export function deriveRenewalAlert(
  source: RenewalAlertSource,
  todayStr: string,
): RenewalAlert | null {
  if (source.renewalStatus !== 'open') return null

  const zenUnanswered = source.isZennichikyoTarget && source.answer === null
  const circleUnanswered = source.isCircleTarget && source.schoolYearAnsweredAt === null
  if (!zenUnanswered && !circleUnanswered) return null

  const label =
    zenUnanswered && circleUnanswered
      ? '全日協の登録と学年'
      : zenUnanswered
        ? '全日協の登録'
        : '4月からの学年'

  return { label, daysLeft: diffDays(todayStr, source.deadline) }
}
