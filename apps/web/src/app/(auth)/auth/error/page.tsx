export default function AuthErrorPage() {
  return (
    <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow-lg text-center">
      <h1 className="text-xl font-bold text-red-600">認証エラー</h1>
      <p className="text-sm text-gray-600">
        ログイン中にエラーが発生しました。もう一度お試しください。
      </p>
    </div>
  )
}
