'use client'

import { useState } from 'react'

/**
 * member-mail-search タスク5: 詳細画面の本文表示（requirements.md §3.5・design-spec.md §3
 * の `.dbody`）。`body_text ?? body_html` を `<pre>` に生テキストとして表示する
 * （`dangerouslySetInnerHTML` は使わない。既存 `/admin/mail-inbox/mail/[id]` と同じ方針。
 * HTML メールでもタグごと文字として見えるだけで、本文を取りこぼさない）。
 *
 * 畳む/展開の判定は文字数の閾値で行う。jsdom はレイアウトを計算しないため
 * `scrollHeight` 等の実測値に頼るとテストで決定的に検証できない。
 * `.dbody.clamped` の max-height 190px・text-xs (12px) 行間 1.55 の目安として、
 * 概ね5〜6行に収まる 200 文字を境界にした（design-mock edge.html ② の長文サンプルは
 * これを大きく超え、detail-a-timeline.html の短い本文はこれを下回る）。
 */
const CLAMP_THRESHOLD = 200

export interface MailBodyProps {
  body: string
}

export function MailBody({ body }: MailBodyProps) {
  const [expanded, setExpanded] = useState(false)
  const needsToggle = body.length > CLAMP_THRESHOLD

  return (
    <div>
      <pre
        className={`overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border-soft bg-surface-alt px-2.5 py-2 text-xs leading-[1.55] text-ink-2 ${
          expanded ? 'max-h-[320px]' : 'max-h-[190px]'
        }`}
      >
        {body}
      </pre>
      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="pt-[5px] text-[10px] font-medium text-brand-fg"
        >
          {expanded ? '折りたたむ ▴' : '全文を表示 ▾'}
        </button>
      )}
    </div>
  )
}
