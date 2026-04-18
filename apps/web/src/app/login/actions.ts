'use server'

import { eq } from 'drizzle-orm'
import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { signIn } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'

const loginSchema = z.object({
  username: z.string().min(1, 'ユーザー名を入力してください'),
  password: z.string().min(1, 'パスワードを入力してください'),
})

export type LoginActionState = {
  error?: string
}

export async function login(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }

  try {
    await signIn('credentials', {
      username: parsed.data.username,
      password: parsed.data.password,
      redirect: false,
    })
  } catch (err) {
    // Only translate CredentialsSignin (bad username/password) to the generic
    // user-facing message. Other AuthError subtypes (configuration issues,
    // transport failures, etc.) should surface so they are observable.
    if (err instanceof AuthError && err.type === 'CredentialsSignin') {
      return { error: 'ユーザー名またはパスワードが違います' }
    }
    throw err
  }

  // Look up the user to decide the post-login destination. Middleware also
  // enforces this, but redirecting directly here avoids a Next.js quirk where
  // a server-action redirect + middleware redirect leaves the browser URL
  // lagging behind the rendered content.
  const user = await db.query.users.findFirst({
    where: eq(users.name, parsed.data.username),
    columns: { mustChangePassword: true },
  })
  redirect(user?.mustChangePassword ? '/change-password' : '/')
}
