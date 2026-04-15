export default function NotInvitedPage() {
  return (
    <div className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow-lg text-center">
      <h1 className="text-xl font-bold text-red-600">アクセスが許可されていません</h1>
      <p className="text-sm text-gray-600">
        このシステムは招待制です。管理者にお問い合わせください。
      </p>
    </div>
  )
}
