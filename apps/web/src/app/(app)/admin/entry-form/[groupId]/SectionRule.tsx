import type { ReactNode } from 'react'

/**
 * entry-form-autofill タスク7 (UI): 節見出し（脱カード方針）。
 * design-spec 忠実度チェックリスト: 「13px 太字＋右へ伸びる 1px 罫線
 * （--kg-border-soft）。節や一覧を Card で包んでいない」。
 *
 * 既存の `components/events/detail/SectionRule` とは別物（あちらは 18px serif
 * ＋ border-strong 下線というイベント詳細画面専用の意匠）。`components/ui/SectionLabel`
 * も罫線を持たない。このウィザードの見た目はどちらとも一致しないため、
 * このディレクトリ限定のコンポーネントとして独立させている。
 */
export function SectionRule({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[13px] font-bold text-ink-2">{title}</span>
      {meta != null && <span className="shrink-0 text-[11px] tabular-nums text-ink-meta">{meta}</span>}
      <span aria-hidden className="h-px flex-1 bg-border-soft" />
    </div>
  )
}
