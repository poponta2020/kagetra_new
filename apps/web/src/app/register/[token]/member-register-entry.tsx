'use client'

import { useId, useState } from 'react'
import { RosterClaimForm } from '@/components/register/RosterClaimForm'
import type { RosterCandidate } from '@/lib/roster-claim-input'
import { claimViaInvite } from './actions'
import { RegisterForm } from './register-form'

type Mode = 'roster' | 'new' | null

/**
 * roster-claim: 会員用招待リンクで名簿の候補が1人以上いるときの入口。
 * 「名簿から選ぶ」（既存の名簿行に LINE を紐付ける）と「新しく登録する」
 * （新規行を作る）の2択を出し、どちらかが選ばれるまでフォームは出さない
 * （既定 `mode = null`）。
 *
 * SegmentGroup（flat-fields.tsx）は選択肢が文字列ラベルだけなので、ここは
 * 補助文（1行目=ラベル・2行目=補助文）付きの選択肢を独自に組む。見た目は
 * SegmentGroup と同系統のクラスを踏襲する。accessible name はラベルだけに
 * なるよう `aria-label` を明示し、補助文は `aria-describedby` で結ぶ。
 */
export function MemberRegisterEntry({
  token,
  candidates,
}: {
  token: string
  candidates: RosterCandidate[]
}) {
  const [mode, setMode] = useState<Mode>(null)
  const groupId = useId()
  const rosterDescId = `${groupId}-roster-desc`
  const newDescId = `${groupId}-new-desc`

  return (
    <div className="space-y-7">
      <div role="radiogroup" aria-label="登録のしかた" className="flex gap-1">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'roster'}
          aria-describedby={rosterDescId}
          aria-label="名簿から選ぶ"
          onClick={() => setMode('roster')}
          className={`flex-1 cursor-pointer border-b-2 pb-2 pt-1 text-center transition-colors ${
            mode === 'roster' ? 'border-brand' : 'border-border'
          }`}
        >
          <span className={`block text-sm ${mode === 'roster' ? 'font-semibold text-ink' : 'text-ink-meta'}`}>
            名簿から選ぶ
          </span>
          <span id={rosterDescId} className="mt-0.5 block text-xs text-ink-meta">
            すでに会の名簿にお名前がある方
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'new'}
          aria-describedby={newDescId}
          aria-label="新しく登録する"
          onClick={() => setMode('new')}
          className={`flex-1 cursor-pointer border-b-2 pb-2 pt-1 text-center transition-colors ${
            mode === 'new' ? 'border-brand' : 'border-border'
          }`}
        >
          <span className={`block text-sm ${mode === 'new' ? 'font-semibold text-ink' : 'text-ink-meta'}`}>
            新しく登録する
          </span>
          <span id={newDescId} className="mt-0.5 block text-xs text-ink-meta">
            はじめて登録する方
          </span>
        </button>
      </div>

      {mode === 'roster' && (
        <RosterClaimForm
          action={claimViaInvite.bind(null, token)}
          candidates={candidates}
          submitLabel="このお名前で登録する"
        />
      )}
      {mode === 'new' && (
        <RegisterForm token={token} kind="member" onSwitchToRoster={() => setMode('roster')} />
      )}
    </div>
  )
}
