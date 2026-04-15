import { signIn } from '@/auth'

export default function SignInPage() {
  return (
    <div className="w-full max-w-sm space-y-6 rounded-lg bg-white p-8 shadow-lg">
      <div className="text-center">
        <h1 className="text-2xl font-bold">かげとら</h1>
        <p className="mt-2 text-sm text-gray-600">競技かるた会グループウェア</p>
      </div>
      <form
        action={async () => {
          'use server'
          await signIn('line', { redirectTo: '/' })
        }}
      >
        <button
          type="submit"
          className="w-full rounded-md bg-[#00b900] px-4 py-3 text-sm font-medium text-white hover:bg-[#00a000] transition-colors"
        >
          LINEでログイン
        </button>
      </form>
    </div>
  )
}
