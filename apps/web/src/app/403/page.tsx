export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-ink-muted">403</h1>
        <p className="mt-2 text-ink-meta">このページにアクセスする権限がありません</p>
      </div>
    </div>
  )
}
