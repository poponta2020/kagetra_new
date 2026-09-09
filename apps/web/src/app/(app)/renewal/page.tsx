import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isGuestRole } from '@/lib/guest-access'
import { loadMemberRenewalView } from '@/lib/membership-renewal/store'
import { RenewalForm, type RenewalFormView } from './RenewalForm'

export const dynamic = 'force-dynamic'

/**
 * S1 `/renewal` — 年度確認（会員）。requirements R3・R4・R12・AC-5・AC-9・AC-10・AC-11。
 *
 * 認可は「ログイン会員本人のみ」。`/renewal` はゲスト許可リスト
 * （`@/lib/guest-access`）に**含めない**ので middleware（Edge）が先にゲストを
 * 弾く。ここでの `isGuestRole` チェックは、dashboard/page.tsx と同じ Node 側の
 * fail-safe（token.role が降格直後に stale なままセッションが残るケース対策）。
 *
 * データの組み立ては `loadMemberRenewalView`（タスク5・実装済み）に委ね、
 * このページは認可と「クライアント境界を跨げる形（Date→ISO文字列）への詰め替え」
 * だけを持つ。`RenewalForm` は `'use client'` なので、DB を抱える `store.ts` の
 * 型をそのまま渡さず、`RenewalFormView`（DB 非依存の型だけで組んだ DTO）に変換する。
 */
export default async function RenewalPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/403')
  if (isGuestRole(session.user.role)) redirect('/403')

  const view = await loadMemberRenewalView(session.user.id)

  const formView: RenewalFormView | null =
    view && (view.isZennichikyoTarget || view.isCircleTarget)
      ? {
          renewalId: view.renewal.id,
          fiscalYear: view.renewal.fiscalYear,
          deadline: view.renewal.deadline,
          status: view.renewal.status,
          isZennichikyoTarget: view.isZennichikyoTarget,
          isCircleTarget: view.isCircleTarget,
          current: view.current,
          membershipKind: view.membershipKind,
          readerCertification: view.readerCertification,
          isAssociateReferee: view.isAssociateReferee,
          answer: view.answer,
          answeredAtIso: view.answeredAt ? view.answeredAt.toISOString() : null,
          schoolYearKind: view.schoolYearKind,
          nextFacultyKind: view.nextFacultyKind,
          nextFaculty: view.nextFaculty,
          nextSchoolYear: view.nextSchoolYear,
          schoolYearAnsweredAtIso: view.schoolYearAnsweredAt
            ? view.schoolYearAnsweredAt.toISOString()
            : null,
          diff: view.diff,
        }
      : null

  return (
    <div className="p-4">
      <RenewalForm view={formView} />
    </div>
  )
}
