'use server'

import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { auth, signOut } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { MIN_PASSWORD_LENGTH } from './constants'

const BCRYPT_COST = 12

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '現在のパスワードを入力してください'),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`),
    confirmPassword: z.string().min(1, '確認用パスワードを入力してください'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '確認用パスワードが一致しません',
    path: ['confirmPassword'],
  })

export type ChangePasswordActionState = {
  error?: string
}

export async function changePasswordAction(
  _prev: ChangePasswordActionState,
  formData: FormData,
): Promise<ChangePasswordActionState> {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'ログインが必要です' }
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }

  const { currentPassword, newPassword } = parsed.data

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })
  if (!user || !user.passwordHash) {
    return { error: 'ユーザー情報を取得できませんでした' }
  }

  const ok = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!ok) {
    return { error: '現在のパスワードが違います' }
  }

  // Prevent bypassing the forced-change requirement by reusing the same
  // password — especially critical because the initial password is shared
  // across all migrated users (pppppppp).
  const newMatchesCurrent = await bcrypt.compare(newPassword, user.passwordHash)
  if (newMatchesCurrent) {
    return { error: '新しいパスワードは現在のパスワードと異なるものにしてください' }
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST)
  await db
    .update(users)
    .set({
      passwordHash: newHash,
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))

  // Force a fresh JWT by signing out; the user re-signs in with the new
  // password and the next token will have mustChangePassword=false.
  await signOut({ redirect: false })
  redirect('/login')
}
