'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth, unstable_update } from '@/auth'
import {
  isRolePreviewAllowed,
  parseUserRole,
  sanitizeReturnPath,
  selectableRoles,
} from '@/lib/role-preview'

/**
 * role-preview-switch の切替 Server Action。
 *
 * 認可は二重条件:
 *   1. `ROLE_PREVIEW_USER_IDS` の許可リストに載っていること
 *   2. 切替先が `selectableRoles(realRole)` に含まれること（＝本物のロール
 *      以下。ゲストだけは本物のロールが admin のときに限る = R1）
 *
 * どちらの判定にも **実効ロール (`session.user.role`) を使ってはならない**。
 * 実効ロールで判定するとプレビュー中に自分を締め出し、管理者へ戻れなくなる
 * （この機能の安全装置が壊れる = AC-9）。
 *
 * 例外として「本物のロールへ戻す」操作だけは、プレビュー中であれば許可
 * リスト判定を通さずに実行できる。運用中に env から自分の id が外れても
 * ログアウト以外の復帰手段が残るようにするため（AC-10b）。実効ロールは
 * 下がる方向にしか動かないので、これで権限が広がることはない。
 */
export async function setRolePreviewAction(formData: FormData): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) redirect('/403')

  const requested = parseUserRole(formData.get('role'))
  if (!requested) redirect('/403')

  // `realRole` が無い古い JWT が残っていても壊れないようフォールバックする。
  const realRole = parseUserRole(session.user.realRole ?? session.user.role)
  if (!realRole) redirect('/403')

  const effectiveRole = parseUserRole(session.user.role)
  const isPreviewing = effectiveRole !== null && effectiveRole !== realRole
  const isReset = requested === realRole
  const allowed = isRolePreviewAllowed(
    session.user.id,
    process.env.ROLE_PREVIEW_USER_IDS,
  )

  // 許可リスト外は「プレビュー中の解除」以外すべて拒否する。拒否時は
  // unstable_update を呼ばないので状態は一切変化しない（AC-10）。
  if (!allowed && !(isReset && isPreviewing)) redirect('/403')
  // 本物のロールより上へは切り替えられない（AC-11）。副管理者・一般会員の
  // ゲストへの切替もここで落ちる（AC-25）。丸め込みは session コールバック
  // 側にもあるが、ここで弾いて JWT に嘘の値を残さない。
  if (!selectableRoles(realRole).includes(requested)) redirect('/403')

  // `unstable_update` の引数は Session 型だが、実際に渡しているのは
  // auth.config.ts の jwt コールバックが読む**パッチ**（既存の
  // lineUserId 更新箇所と同じ用法）。`viewAsRole` は JWT 側のクレームで
  // Session の公開契約には無いのでキャストする。
  await unstable_update({
    user: { viewAsRole: isReset ? null : requested },
  } as unknown as Parameters<typeof unstable_update>[0])

  // ⚠️ `auth()` は**リクエスト**の cookie を読み、`unstable_update` は
  // **レスポンス**の cookie を書く。そのため同一レスポンス内で再描画すると
  // 古いセッションのままになる（症状 = 押しても画面が変わらず、別画面へ
  // 遷移して初めて反映される）。revalidate に加えて現在パスへ redirect し、
  // 新しい cookie を載せたリクエストを必ず踏ませる。
  revalidatePath('/', 'layout')
  redirect(sanitizeReturnPath(formData.get('returnTo')))
}
