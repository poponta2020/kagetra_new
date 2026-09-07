'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { Btn } from '@/components/ui'
import { SectionRule } from '@/components/events/detail'

/**
 * S5 申込グループページの「遠征届」セクション（requirements §3.1 S5・R4・R5・R7・R9、
 * design-spec §3/§5/§8）。
 *
 * 要素順（design-spec §8）: 必要トグル → 開催地行（AI推定バッジ＋修正）→ 遠征単位ごとの
 * 見出し行（日付・級・`n/m`／「そろった」）＋顔ぶれ（未入力＝朱の名前リンク）→
 * 作成ボタン → 作成履歴 → 原本行。**一般会員には単位の見出し行だけ**。
 *
 * ★操作系（`actions`）と顔ぶれ・履歴は**提出権限者のときだけ props に渡す**。
 * 渡さなければ RSC payload にも載らない（電話番号入りの作成物へ近づけない。
 * `rosterAdminControls` と同じ規律）。
 */

export interface TravelUnitMemberView {
  userId: string
  /** 表示名（姓のみ等の短縮は呼び出し側で済ませる）。 */
  name: string
  grade: string | null
  isGuest: boolean
  entered: boolean
  /** 代理入力のリンク先に使う、この単位の先頭 events.id。 */
  eventId: number
}

export interface TravelUnitView {
  /** 単位キー（ブロック初日）。 */
  startDate: string
  /** 「11/7(土)・11/8(日)」。 */
  dateLabel: string
  /** その単位の対象級（A〜E）。 */
  grades: string[]
  targetCount: number
  enteredCount: number
  /** 提出権限者にだけ渡す顔ぶれ。 */
  members?: TravelUnitMemberView[]
}

export interface TravelReportHistoryView {
  id: number
  filename: string
  /** 「9/6 15:02」。 */
  createdAtLabel: string
  createdByName: string | null
  /** 通知失敗の理由（`travel_report_batches.notify_error`）。同じ batch のファイルは同じ値。 */
  notifyError: string | null
  /** 通知成功日時（「9/6 15:02」形式）。失敗表示を優先するので、成功表示には現状使わない。 */
  notifiedAt: string | null
}

export interface TravelDestinationView {
  label: string | null
  prefecture: string | null
  city: string | null
  /** `ai` のときだけ「AI推定」バッジを出す。 */
  source: 'ai' | 'manual' | null
}

export interface TravelReportSectionActions {
  setRequired: (entryGroupId: number, required: boolean) => Promise<void>
  startRouteInput: (entryGroupId: number) => Promise<void>
  updateDestination: (
    entryGroupId: number,
    input: { prefecture: string | null; city: string | null; label: string },
  ) => Promise<void>
}

export interface TravelReportSectionProps {
  entryGroupId: number
  required: boolean
  /** 「副連絡責任者: 旭川」の右肩表示。0人なら未設定と出す。 */
  submitterNames: string[]
  destination: TravelDestinationView
  /** 経路入力が開いているか（確定名簿あり or 手動開始）。 */
  routeInputOpen: boolean
  units: TravelUnitView[]
  /** 提出権限者にだけ渡す作成履歴（新しい順）。 */
  history?: TravelReportHistoryView[]
  /** 提出権限者にだけ渡す操作。undefined なら閲覧のみ。 */
  actions?: TravelReportSectionActions
}

function unitCountLabel(unit: TravelUnitView): { text: string; done: boolean } {
  if (unit.targetCount > 0 && unit.enteredCount >= unit.targetCount) {
    return { text: `${unit.enteredCount}/${unit.targetCount} そろった`, done: true }
  }
  return { text: `${unit.enteredCount}/${unit.targetCount}`, done: false }
}

export function TravelReportSection({
  entryGroupId,
  required,
  submitterNames,
  destination,
  routeInputOpen,
  units,
  history,
  actions,
}: TravelReportSectionProps) {
  const canOperate = actions !== undefined
  const [editingDestination, setEditingDestination] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const aux = required
    ? submitterNames.length > 0
      ? `副連絡責任者: ${submitterNames.join('・')}`
      : '副連絡責任者 未設定'
    : 'この大会は不要'

  function run(fn: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await fn()
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作に失敗しました')
      }
    })
  }

  return (
    <SectionRule title="遠征届" aux={aux} auxTone={required ? 'meta' : 'warn'}>
      {canOperate && (
        <div className="flex items-center justify-between gap-[10px] py-[10px]">
          <div>
            <div className="text-sm text-ink">この大会は遠征届が必要</div>
            <div className="mt-px text-xs text-ink-meta">
              {required
                ? '不要にすると入力導線と通知が止まります'
                : '戻すと入力済みの経路もそのまま復活します'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={required}
            aria-label="この大会は遠征届が必要"
            disabled={pending}
            onClick={() => run(() => actions.setRequired(entryGroupId, !required))}
            className={cn(
              'relative h-[22px] w-[38px] flex-none rounded-full transition-colors',
              required ? 'bg-brand' : 'bg-border-strong',
              pending && 'opacity-60',
            )}
          >
            <span
              className={cn(
                'absolute top-[2px] h-[18px] w-[18px] rounded-full bg-surface transition-[left]',
                required ? 'left-[18px]' : 'left-[2px]',
              )}
            />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1 text-xs text-accent-fg">
          {error}
        </p>
      )}

      {/* 「不要」の間はトグルだけ。入力状況・作成・履歴は畳む（履歴があれば件数だけ残す）。 */}
      {!required ? (
        history && history.length > 0 ? (
          <p className="pt-[10px] text-xs text-ink-meta">
            作成履歴 {history.length} 件（「必要」に戻すと表示されます）
          </p>
        ) : null
      ) : (
        <>
          {canOperate && (
            <div className="flex items-baseline gap-2 border-b border-border-soft py-2 text-sm">
              <span className="w-[52px] flex-none text-xs text-ink-meta">開催地</span>
              {editingDestination ? (
                <DestinationForm
                  entryGroupId={entryGroupId}
                  destination={destination}
                  pending={pending}
                  onCancel={() => setEditingDestination(false)}
                  onSubmit={(input) =>
                    run(async () => {
                      await actions.updateDestination(entryGroupId, input)
                      setEditingDestination(false)
                    })
                  }
                />
              ) : (
                <>
                  <span className="text-ink">
                    {destination.label ?? <span className="text-ink-muted">未設定</span>}
                    {(destination.prefecture || destination.city) && (
                      <span className="ml-1 text-xs text-ink-meta">
                        {[destination.prefecture, destination.city].filter(Boolean).join(' ')}
                      </span>
                    )}
                    {destination.source === 'ai' && (
                      <span className="ml-[6px] inline-flex h-5 items-center rounded-sm bg-info-bg px-[7px] text-[11px] font-medium text-info-fg">
                        AI推定
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-xs text-brand underline underline-offset-2"
                    onClick={() => setEditingDestination(true)}
                  >
                    {destination.label ? '修正' : '入力'}
                  </button>
                </>
              )}
            </div>
          )}

          {!routeInputOpen ? (
            canOperate ? (
              <>
                <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2 pt-[10px] pb-[2px]">
                  <Btn
                    size="sm"
                    kind="secondary"
                    disabled={pending}
                    onClick={() => run(() => actions.startRouteInput(entryGroupId))}
                  >
                    経路入力を開始
                  </Btn>
                  <span className="text-xs text-ink-meta">
                    確定名簿が出ると自動で始まります。先に始めるならこのボタン。
                  </span>
                </div>
                <p className="pt-2 text-xs leading-relaxed text-ink-meta">
                  開始時に開催地が未設定なら、会場名から AI が推定して入れます（あとで直せます）。
                </p>
              </>
            ) : null
          ) : (
            <>
              {units.map((unit) => {
                const count = unitCountLabel(unit)
                return (
                  <div
                    key={unit.startDate}
                    className="border-t border-border-soft pt-2 pb-1 first:border-t-0"
                  >
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="font-semibold tabular-nums text-ink">{unit.dateLabel}</span>
                      {unit.grades.length > 0 && (
                        <span className="font-mono text-xs text-ink-meta">
                          {unit.grades.join(' ')}
                        </span>
                      )}
                      <span
                        className={cn(
                          'ml-auto text-xs tabular-nums',
                          count.done ? 'font-bold text-brand-fg' : 'text-ink-meta',
                        )}
                      >
                        {count.text}
                      </span>
                    </div>
                    {unit.members && unit.members.length > 0 && (
                      <div className="mt-[7px] flex flex-wrap gap-x-2 gap-y-[6px]">
                        {unit.members.map((m) => (
                          <span
                            key={m.userId}
                            className={cn(
                              'inline-flex items-center gap-1 text-xs',
                              m.entered
                                ? 'text-ink-2'
                                : 'font-semibold text-accent-fg',
                            )}
                          >
                            {m.entered ? (
                              m.name
                            ) : (
                              <Link
                                href={`/events/${m.eventId}/travel-route?user=${encodeURIComponent(m.userId)}`}
                                className="text-accent-fg underline underline-offset-2"
                              >
                                {m.name}
                              </Link>
                            )}
                            {m.grade && <span className="font-mono text-ink-meta">{m.grade}</span>}
                            {m.isGuest && <span className="text-[10px] text-ink-meta">ゲスト</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {canOperate && (
                <>
                  <p className="pt-[6px] text-xs leading-relaxed text-ink-meta">
                    朱の名前を押すと代理入力できます。全員そろうと LINE で @副連絡責任者 に知らせます。
                  </p>
                  <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2 pt-[10px] pb-[2px]">
                    {/* `Btn` は `<button>` なので、遷移はリンクに同じ見た目を当てる
                        （既存コンポーネントに asChild は無い）。 */}
                    <Link
                      href={`/admin/entries/${entryGroupId}/travel-report/new`}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-ink-on-brand transition-colors hover:bg-brand-hover"
                    >
                      遠征届を作成
                    </Link>
                    <span className="text-xs text-ink-meta">
                      未入力の人がいても作れます（名簿には載り、行程は空）
                    </span>
                  </div>
                </>
              )}

              {canOperate && history && history.length > 0 && (
                <div className="mt-3">
                  <div className="pb-1 text-xs text-ink-meta">作成履歴</div>
                  {history.map((h) => (
                    <div
                      key={h.id}
                      className="flex flex-col gap-1 border-t border-border-soft py-2 text-sm first:border-t-0"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-ink">
                          <a
                            href={`/api/admin/travel-reports/${h.id}`}
                            download
                            className="text-brand underline underline-offset-2"
                          >
                            {h.filename}
                          </a>
                        </span>
                        <span className="flex-none text-xs tabular-nums text-ink-meta">
                          {h.createdAtLabel}
                          {h.createdByName ? ` ${h.createdByName}` : ''}
                        </span>
                      </div>
                      {/* 通知失敗は成功表示より優先して出す（R13。同じ batch の全ファイルに付く）。 */}
                      {h.notifyError && (
                        <p className="text-xs text-accent-fg">通知に失敗しました: {h.notifyError}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {canOperate && (
                <div className="flex items-center justify-between gap-2 pt-[10px] text-xs text-ink-meta">
                  <span>大学に出す様式（原本）</span>
                  {/* ★これはページではなくファイルを返す route handler なので `<a download>`
                      が正しい（`<Link>` はクライアント遷移を試みてダウンロードにならない）。
                      `download` を落とすと `no-html-link-for-pages` が誤検知する。 */}
                  <a
                    href="/api/admin/travel-reports/template"
                    download
                    className="inline-flex items-center gap-[6px] text-xs text-brand underline underline-offset-2"
                  >
                    遠征届原本.dotx
                  </a>
                </div>
              )}
            </>
          )}
        </>
      )}
    </SectionRule>
  )
}

function DestinationForm({
  destination,
  pending,
  onCancel,
  onSubmit,
}: {
  entryGroupId: number
  destination: TravelDestinationView
  pending: boolean
  onCancel: () => void
  onSubmit: (input: { prefecture: string | null; city: string | null; label: string }) => void
}) {
  const [label, setLabel] = useState(destination.label ?? '')
  const [prefecture, setPrefecture] = useState(destination.prefecture ?? '')
  const [city, setCity] = useState(destination.city ?? '')

  return (
    <span className="flex flex-1 flex-wrap items-center gap-2">
      <input
        aria-label="経路表記名"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={20}
        className="w-[86px] border-b border-border-strong bg-transparent text-sm text-ink outline-none"
      />
      <input
        aria-label="都道府県"
        value={prefecture}
        onChange={(e) => setPrefecture(e.target.value)}
        maxLength={20}
        className="w-[86px] border-b border-border-strong bg-transparent text-xs text-ink-meta outline-none"
      />
      <input
        aria-label="市区町村"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        maxLength={40}
        className="w-[96px] border-b border-border-strong bg-transparent text-xs text-ink-meta outline-none"
      />
      <span className="ml-auto flex items-center gap-3">
        <button type="button" className="text-xs text-ink-meta" onClick={onCancel}>
          やめる
        </button>
        <button
          type="button"
          disabled={pending || label.trim().length === 0}
          className="text-xs text-brand underline underline-offset-2 disabled:opacity-50"
          onClick={() =>
            onSubmit({
              prefecture: prefecture.trim() || null,
              city: city.trim() || null,
              label: label.trim(),
            })
          }
        >
          保存
        </button>
      </span>
    </span>
  )
}
