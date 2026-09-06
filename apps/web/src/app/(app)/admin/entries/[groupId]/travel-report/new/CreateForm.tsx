'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { Btn } from '@/components/ui'
import { formatEventDate } from '@/lib/event-date'
import type { TravelReportFileDefaults, TravelReportFileInput } from '@/lib/travel-report/create'
import type { CreateTravelReportsResultView } from './actions'

/**
 * S6 のフォーム（design-spec §8）。
 *
 * - ファイル＝カード。日行に「ファイルNへ」、カード間に統合バー、下段に期間・名簿・
 *   備考の見込みと朱の警告
 * - 編集できるのは **目的・場所・遠征先連絡者・留守連絡先・届の日付・承認日 の6行だけ**。
 *   名簿・備考は生成のみ（直すなら Word）。共通（団体名・団体代表者・顧問教員・並び順）は
 *   読み取り専用で出所を添える
 * - 分割操作は「日をファイルNへ」「隣接ファイルと統合」の2つだけ（ドラッグはしない）
 */

interface EditableFile {
  dates: string[]
  purpose: string
  place: string
  destinationContacts: { name: string; phone: string | null }[]
  homeContact: { name: string; phone: string | null } | null
  reportDate: string
  approvalDate: string | null
  /** 既定値から引き継ぐ見込み値（分割を変えたら「再計算されます」と出す）。 */
  memberCount: number
  remarkLineCount: number
  period: { from: string; to: string; days: number } | null
  pendingNames: string[]
  /** 既定の分割から変わったか（見込み値が当てにならない印）。 */
  splitChanged: boolean
}

export interface CreateFormProps {
  entryGroupId: number
  defaults: TravelReportFileDefaults[]
  createAction: (
    entryGroupId: number,
    files: TravelReportFileInput[],
  ) => Promise<CreateTravelReportsResultView>
}

function toEditable(d: TravelReportFileDefaults): EditableFile {
  return { ...d, dates: [...d.dates], splitChanged: false }
}

/** 令和表記（画面の補助表示用。docx 側は render.ts が持つ）。 */
function eraLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const year = Number(iso.slice(0, 4)) - 2018
  return `令和${year}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`
}

export function CreateForm({ entryGroupId, defaults, createAction }: CreateFormProps) {
  const router = useRouter()
  const [files, setFiles] = useState<EditableFile[]>(() => defaults.map(toEditable))
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const totalDays = useMemo(() => files.reduce((n, f) => n + f.dates.length, 0), [files])

  function update(index: number, patch: Partial<EditableFile>) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  /** 日を別ファイルへ移す。移動元が空になったらファイルごと消す。 */
  function moveDay(fromIndex: number, date: string, toIndex: number) {
    setFiles((prev) => {
      const next = prev.map((f) => ({ ...f, dates: [...f.dates] }))
      const from = next[fromIndex]
      const to = next[toIndex]
      if (!from || !to) return prev
      from.dates = from.dates.filter((d) => d !== date)
      to.dates = [...to.dates, date].sort()
      from.splitChanged = true
      to.splitChanged = true
      return next.filter((f) => f.dates.length > 0)
    })
  }

  /** 隣接する2ファイルを1つにする。 */
  function merge(index: number) {
    setFiles((prev) => {
      const a = prev[index]
      const b = prev[index + 1]
      if (!a || !b) return prev
      const merged: EditableFile = {
        ...a,
        dates: [...a.dates, ...b.dates].sort(),
        pendingNames: [...new Set([...a.pendingNames, ...b.pendingNames])],
        splitChanged: true,
      }
      return [...prev.slice(0, index), merged, ...prev.slice(index + 2)]
    })
  }

  /** 1日だけを切り出して新しいファイルにする。 */
  function splitOff(index: number, date: string) {
    setFiles((prev) => {
      const src = prev[index]
      if (!src || src.dates.length < 2) return prev
      const rest: EditableFile = {
        ...src,
        dates: src.dates.filter((d) => d !== date),
        splitChanged: true,
      }
      const created: EditableFile = { ...src, dates: [date], pendingNames: [], splitChanged: true }
      return [...prev.slice(0, index), rest, created, ...prev.slice(index + 1)]
    })
  }

  function submit() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const payload: TravelReportFileInput[] = files.map((f) => ({
        dates: f.dates,
        purpose: f.purpose,
        place: f.place,
        destinationContacts: f.destinationContacts,
        homeContact: f.homeContact,
        reportDate: f.reportDate,
        approvalDate: f.approvalDate,
      }))
      const result = await createAction(entryGroupId, payload)
      if (!result.ok) {
        setError(result.error ?? '遠征届の作成に失敗しました')
        return
      }
      if (result.notifyError) {
        setNotice(`作成しました（${result.fileCount} ファイル）。LINE 通知は失敗しました: ${result.notifyError}`)
        return
      }
      router.push(`/admin/entries/${entryGroupId}`)
    })
  }

  return (
    <div className="pb-24">
      <section>
        <div className="flex items-baseline justify-between gap-2 border-b border-border-strong pb-[7px]">
          <h2 className="font-display text-[18px] font-semibold text-ink">
            ファイル分割 <span className="text-[20px] font-bold text-brand">{files.length}</span>
            <span className="ml-1 text-xs font-normal text-ink-meta">ファイル</span>
          </h2>
          <span className="text-xs text-ink-meta">連続する開催日で1ファイル</span>
        </div>

        {files.map((file, index) => (
          <div key={`${index}-${file.dates[0] ?? ''}`}>
            {index > 0 && (
              <div className="border-y border-dashed border-border py-2 text-center">
                <button
                  type="button"
                  className="text-xs text-brand underline underline-offset-2"
                  onClick={() => merge(index - 1)}
                >
                  ⇅ ファイル{index}と{index + 1}を統合する
                </button>
              </div>
            )}
            <div className="mt-3 rounded-lg border border-border bg-surface p-3 shadow-sm">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="font-semibold text-ink">ファイル{index + 1}</span>
                <span className="tabular-nums text-ink-2">
                  {file.dates.map((d) => formatEventDate(d)).join('・')}
                </span>
                <span className="ml-auto text-xs text-ink-meta">{file.memberCount}名</span>
              </div>

              {file.dates.map((date) => (
                <div
                  key={date}
                  className="flex items-baseline gap-2 border-t border-border-soft py-[6px] text-sm first:border-t-0"
                >
                  <span className="tabular-nums text-ink">{formatEventDate(date)}</span>
                  <span className="ml-auto flex items-center gap-3">
                    {files.map((_, target) =>
                      target === index ? null : (
                        <button
                          key={target}
                          type="button"
                          className="text-xs text-brand underline underline-offset-2"
                          onClick={() => moveDay(index, date, target)}
                        >
                          ファイル{target + 1}へ
                        </button>
                      ),
                    )}
                    {file.dates.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-brand underline underline-offset-2"
                        onClick={() => splitOff(index, date)}
                      >
                        別ファイルにする
                      </button>
                    )}
                  </span>
                </div>
              ))}

              <div className="mt-[6px] flex flex-wrap items-baseline gap-x-[10px] gap-y-1 text-xs text-ink-meta">
                {file.period && (
                  <span>
                    期間{' '}
                    <b className="font-semibold text-ink">
                      {formatEventDate(file.period.from)}〜{formatEventDate(file.period.to)}
                    </b>
                  </span>
                )}
                <span>
                  名簿 <b className="font-semibold text-ink">{file.memberCount}名</b>
                </span>
                <span>
                  備考 <b className="font-semibold text-ink">{file.remarkLineCount}行</b>
                </span>
                {file.splitChanged && <span>（分割を変えたので作成時に再計算されます）</span>}
              </div>

              {file.pendingNames.length > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-accent-fg">
                  未入力 {file.pendingNames.length}名（{file.pendingNames.join('・')}）—
                  名簿には載り、行程は出場行だけになります
                </p>
              )}
            </div>
          </div>
        ))}
      </section>

      {files.map((file, index) => (
        <section key={`content-${index}`} className="pt-[34px]">
          <div className="flex items-baseline justify-between gap-2 border-b border-border-strong pb-[7px] mb-[13px]">
            <h2 className="font-display text-[18px] font-semibold text-ink">
              届の内容 ── ファイル{index + 1}
            </h2>
            <span className="text-xs text-ink-meta">
              {file.dates.map((d) => formatEventDate(d)).join('・')}
            </span>
          </div>

          <Row label="目的">
            <input
              aria-label={`ファイル${index + 1}の目的`}
              value={file.purpose}
              onChange={(e) => update(index, { purpose: e.target.value })}
              maxLength={200}
              className="w-full border-b border-border-strong bg-transparent text-sm text-ink outline-none"
            />
          </Row>
          <Row label="場所">
            <input
              aria-label={`ファイル${index + 1}の場所`}
              value={file.place}
              onChange={(e) => update(index, { place: e.target.value })}
              maxLength={200}
              className="w-full border-b border-border-strong bg-transparent text-sm text-ink outline-none"
            />
          </Row>
          <Row label="遠征先連絡者">
            <span className="text-sm text-ink">
              {file.destinationContacts.length > 0
                ? file.destinationContacts.map((c) => c.name).join('・')
                : '（該当者なし）'}
            </span>
            <div className="text-xs text-ink-meta">
              {file.destinationContacts.map((c) => c.phone).filter(Boolean).join(' ／ ')}
              {file.destinationContacts.length > 0 && ' ／ 役職順で自動選択'}
            </div>
          </Row>
          <Row label="留守連絡先">
            <span className="text-sm text-ink">{file.homeContact?.name ?? '（空欄）'}</span>
            <div className="text-xs text-ink-meta">
              {file.homeContact?.phone ?? 'サークル長が未設定、または全員が遠征しています'}
            </div>
          </Row>
          <Row label="届の日付">
            <span className="flex items-baseline gap-2">
              <input
                type="date"
                aria-label={`ファイル${index + 1}の届の日付`}
                value={file.reportDate}
                onChange={(e) => update(index, { reportDate: e.target.value })}
                className="border-b border-border-strong bg-transparent text-sm text-ink outline-none"
              />
              <span className="text-xs text-ink-meta">{eraLabel(file.reportDate)}</span>
            </span>
          </Row>
          <Row label="承認日">
            <span className="flex items-baseline gap-2">
              <input
                type="date"
                aria-label={`ファイル${index + 1}の承認日`}
                value={file.approvalDate ?? ''}
                onChange={(e) => update(index, { approvalDate: e.target.value || null })}
                className="border-b border-border-strong bg-transparent text-sm text-ink outline-none"
              />
              <span className="text-xs text-ink-meta">
                {file.approvalDate ? eraLabel(file.approvalDate) : '顧問のメール承認日（空欄可）'}
              </span>
            </span>
          </Row>
        </section>
      ))}

      <section className="pt-[34px]">
        <div className="border-b border-border-strong pb-[7px] mb-[13px]">
          <h2 className="font-display text-[18px] font-semibold text-ink">共通（自動）</h2>
        </div>
        <ul className="space-y-1 text-xs leading-relaxed text-ink-meta">
          <li>団体名: 北海道大学かるた会（様式のまま）</li>
          <li>団体代表者: サークル長のプロフィールから</li>
          <li>顧問教員: 設定 › 遠征届 の3項目から</li>
          <li>名簿の並び: 学年の高い順 → 同学年はかな順</li>
          <li>備考: 保存された経路から日付順に自動生成（直すなら Word で）</li>
        </ul>
      </section>

      {error && (
        <p role="alert" className="mt-3 text-xs text-accent-fg">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-xs text-warn-fg">
          {notice}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-10 border-t border-border bg-surface px-4 py-3">
        <Btn
          block
          size="lg"
          disabled={pending || files.length === 0 || totalDays === 0}
          onClick={submit}
        >
          {pending ? '作成しています…' : `${files.length} ファイルを作成する`}
        </Btn>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-border-soft py-2">
      <span className={cn('w-[92px] flex-none text-xs text-ink-meta')}>{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}
