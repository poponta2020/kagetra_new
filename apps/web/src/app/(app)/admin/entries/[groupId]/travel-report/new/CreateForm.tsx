'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, useTransition } from 'react'
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
  /**
   * ユーザーが手で直した項目。分割を変えて既定値を取り直すとき、ここに入っている
   * 項目だけは上書きしない（Codex R1 #9 の「明示編集は dirty state として保持」）。
   */
  dirty: Partial<Record<'purpose' | 'place' | 'reportDate' | 'approvalDate' | 'contacts', true>>
}

export interface CreateFormProps {
  entryGroupId: number
  defaults: TravelReportFileDefaults[]
  createAction: (
    entryGroupId: number,
    files: TravelReportFileInput[],
  ) => Promise<CreateTravelReportsResultView>
  /**
   * 分割を変えたときに**サーバー側の同じロジック**から既定値を取り直す
   * （Codex R1 #9。目的・場所は docx に入るので、古い分割の値を送ってはいけない）。
   */
  reloadAction: (
    entryGroupId: number,
    split: string[][],
  ) => Promise<{ ok: true; files: TravelReportFileDefaults[] } | { ok: false; error: string }>
}

function toEditable(d: TravelReportFileDefaults): EditableFile {
  return { ...d, dates: [...d.dates], dirty: {} }
}

/** 令和表記（画面の補助表示用。docx 側は render.ts が持つ）。 */
function eraLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const year = Number(iso.slice(0, 4)) - 2018
  return `令和${year}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`
}

/** 分割の同一性を表す文字列（再計算の応答が今の分割のものか照合するのに使う）。 */
function splitSignature(files: readonly EditableFile[]): string {
  return files.map((f) => f.dates.join(',')).join('|')
}

/** ファイルを最小日で並べ直す（分割操作のあと日付順が崩れないように）。 */
function byFirstDate(a: EditableFile, b: EditableFile): number {
  return (a.dates[0] ?? '').localeCompare(b.dates[0] ?? '')
}

export function CreateForm({
  entryGroupId,
  defaults,
  createAction,
  reloadAction,
}: CreateFormProps) {
  const router = useRouter()
  const [files, setFiles] = useState<EditableFile[]>(() => defaults.map(toEditable))
  const [pending, startTransition] = useTransition()
  const [recalculating, startRecalculating] = useTransition()
  // 最後に要求した分割。古い再計算の応答を捨てるための照合キー（Codex R2 #1）。
  const latestSplit = useRef<string>(splitSignature(defaults.map(toEditable)))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const totalDays = useMemo(() => files.reduce((n, f) => n + f.dates.length, 0), [files])

  function update(index: number, patch: Partial<EditableFile>, dirtyKey?: keyof EditableFile['dirty']) {
    setFiles((prev) =>
      prev.map((f, i) =>
        i === index
          ? { ...f, ...patch, dirty: dirtyKey ? { ...f.dirty, [dirtyKey]: true } : f.dirty }
          : f,
      ),
    )
  }

  /**
   * 分割を変えたら**サーバー側の同じ既定値ロジック**から取り直す（Codex R1 #9）。
   * 目的（級の連結）・場所は docx に入るので、古い分割の値のままにできない。
   * ユーザーが手で直した項目（`dirty`）だけは上書きしない。
   */
  function applySplit(next: EditableFile[]) {
    const ordered = next.filter((f) => f.dates.length > 0).sort(byFirstDate)
    const signature = splitSignature(ordered)
    latestSplit.current = signature
    setFiles(ordered)
    setError(null)
    startRecalculating(async () => {
      const result = await reloadAction(
        entryGroupId,
        ordered.map((f) => f.dates),
      )
      // ★続けて分割操作をすると、先に始めた再計算があとで返ることがある。
      // 古い分割の既定値を新しい分割へ当てると、日付だけ最新・目的や場所は古い、という
      // 食い違った状態で作成できてしまう（Codex R2 #1）。応答時に分割が変わっていたら捨てる。
      if (latestSplit.current !== signature) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setFiles((prev) => {
        if (splitSignature(prev) !== signature) return prev
        return prev.map((file, i) => {
          const fresh = result.files[i]
          if (!fresh) return file
          return {
            ...fresh,
            dates: file.dates,
            dirty: file.dirty,
            // 手で直した項目だけ据え置く。
            purpose: file.dirty.purpose ? file.purpose : fresh.purpose,
            place: file.dirty.place ? file.place : fresh.place,
            reportDate: file.dirty.reportDate ? file.reportDate : fresh.reportDate,
            approvalDate: file.dirty.approvalDate ? file.approvalDate : fresh.approvalDate,
            destinationContacts: file.dirty.contacts
              ? file.destinationContacts
              : fresh.destinationContacts,
            homeContact: file.dirty.contacts ? file.homeContact : fresh.homeContact,
          }
        })
      })
    })
  }

  /** 日を別ファイルへ移す。移動元が空になったらファイルごと消す。 */
  function moveDay(fromIndex: number, date: string, toIndex: number) {
    const next = files.map((f) => ({ ...f, dates: [...f.dates] }))
    const from = next[fromIndex]
    const to = next[toIndex]
    if (!from || !to) return
    from.dates = from.dates.filter((d) => d !== date)
    to.dates = [...to.dates, date].sort()
    applySplit(next)
  }

  /** 隣接する2ファイルを1つにする。 */
  function merge(index: number) {
    const a = files[index]
    const b = files[index + 1]
    if (!a || !b) return
    // ★片方だけ手で直していたら**その値**を採る（Codex R2 #2）。
    // `{...a}` だけだと、b で直した目的・場所・連絡者・日付が失われたうえ
    // dirty だけ引き継がれ、再計算でも置き換わらない状態になる。
    // 両方 dirty で値が違うときは先頭ファイル（a）を採る（決定的にする）。
    const pick = <K extends keyof EditableFile['dirty']>(key: K, av: unknown, bv: unknown) =>
      a.dirty[key] || !b.dirty[key] ? av : bv
    const merged: EditableFile = {
      ...a,
      dates: [...a.dates, ...b.dates].sort(),
      purpose: pick('purpose', a.purpose, b.purpose) as string,
      place: pick('place', a.place, b.place) as string,
      reportDate: pick('reportDate', a.reportDate, b.reportDate) as string,
      approvalDate: pick('approvalDate', a.approvalDate, b.approvalDate) as string | null,
      destinationContacts: pick(
        'contacts',
        a.destinationContacts,
        b.destinationContacts,
      ) as EditableFile['destinationContacts'],
      homeContact: pick('contacts', a.homeContact, b.homeContact) as EditableFile['homeContact'],
      // ★スプレッドの優先順ではなく**論理和**で統合する。現状 `dirty` には `true` しか
      // 入らないのでスプレッドでも b の true は残るが、それは「false を書かない」という
      // 離れた場所の約束に依存している。ここで明示的に OR にして、将来 false を入れても
      // 手入力が再計算で消えないようにする（Codex R3）。
      dirty: {
        ...(a.dirty.purpose || b.dirty.purpose ? { purpose: true as const } : {}),
        ...(a.dirty.place || b.dirty.place ? { place: true as const } : {}),
        ...(a.dirty.reportDate || b.dirty.reportDate ? { reportDate: true as const } : {}),
        ...(a.dirty.approvalDate || b.dirty.approvalDate ? { approvalDate: true as const } : {}),
        ...(a.dirty.contacts || b.dirty.contacts ? { contacts: true as const } : {}),
      },
    }
    applySplit([...files.slice(0, index), merged, ...files.slice(index + 2)])
  }

  /** 1日だけを切り出して新しいファイルにする。 */
  function splitOff(index: number, date: string) {
    const src = files[index]
    if (!src || src.dates.length < 2) return
    const rest: EditableFile = { ...src, dates: src.dates.filter((d) => d !== date) }
    // 切り出した側は既定値を取り直すので dirty を持ち込まない
    // （元ファイル向けに直した目的・場所を別の日へ引きずらない）。
    const created: EditableFile = { ...src, dates: [date], dirty: {} }
    applySplit([...files.slice(0, index), rest, created, ...files.slice(index + 1)])
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
                {recalculating && <span>（再計算中…）</span>}
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
              onChange={(e) => update(index, { purpose: e.target.value }, 'purpose')}
              maxLength={200}
              className="w-full border-b border-border-strong bg-transparent text-sm text-ink outline-none"
            />
          </Row>
          <Row label="場所">
            <input
              aria-label={`ファイル${index + 1}の場所`}
              value={file.place}
              onChange={(e) => update(index, { place: e.target.value }, 'place')}
              maxLength={200}
              className="w-full border-b border-border-strong bg-transparent text-sm text-ink outline-none"
            />
          </Row>
          <Row label="遠征先連絡者">
            {file.destinationContacts.length === 0 ? (
              <ContactFields
                label={`ファイル${index + 1}の遠征先連絡者`}
                contact={{ name: '', phone: null }}
                onChange={(next) => update(index, { destinationContacts: [next] }, 'contacts')}
              />
            ) : (
              file.destinationContacts.map((contact, ci) => (
                <ContactFields
                  key={ci}
                  label={`ファイル${index + 1}の遠征先連絡者${file.destinationContacts.length > 1 ? ci + 1 : ''}`}
                  contact={contact}
                  onChange={(next) =>
                    update(
                      index,
                      {
                        destinationContacts: file.destinationContacts.map((c, i) =>
                          i === ci ? next : c,
                        ),
                      },
                      'contacts',
                    )
                  }
                />
              ))
            )}
            <div className="text-xs text-ink-meta">
              {file.dirty.contacts ? '手入力' : '役職順で自動選択'}
            </div>
          </Row>
          <Row label="留守連絡先">
            <ContactFields
              label={`ファイル${index + 1}の留守連絡先`}
              contact={file.homeContact ?? { name: '', phone: null }}
              onChange={(next) =>
                update(
                  index,
                  { homeContact: next.name === '' && next.phone === null ? null : next },
                  'contacts',
                )
              }
            />
            <div className="text-xs text-ink-meta">
              {file.homeContact
                ? file.dirty.contacts
                  ? '手入力'
                  : 'サークル長（出場するときは出場しない副連絡責任者）'
                : 'サークル長が未設定、または全員が遠征しています（空欄のまま作成できます）'}
            </div>
          </Row>
          <Row label="届の日付">
            <span className="flex items-baseline gap-2">
              <input
                type="date"
                aria-label={`ファイル${index + 1}の届の日付`}
                value={file.reportDate}
                onChange={(e) => update(index, { reportDate: e.target.value }, 'reportDate')}
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
                onChange={(e) => update(index, { approvalDate: e.target.value || null }, 'approvalDate')}
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

/**
 * 連絡者1人ぶんの編集欄（氏名・電話）。R9 は 遠征先連絡者・留守連絡先 を S6 で
 * 修正できると定めている（design-spec §8 の「6行」にも含まれる）ので、既定値の
 * 表示だけにしない（Codex R1 #10）。
 */
function ContactFields({
  label,
  contact,
  onChange,
}: {
  label: string
  contact: { name: string; phone: string | null }
  onChange: (next: { name: string; phone: string | null }) => void
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <input
        aria-label={`${label}の氏名`}
        value={contact.name}
        onChange={(e) => onChange({ ...contact, name: e.target.value })}
        maxLength={60}
        placeholder="氏名"
        className="min-w-0 flex-1 basis-[45%] border-b border-border-strong bg-transparent text-sm text-ink outline-none"
      />
      <input
        aria-label={`${label}の電話番号`}
        value={contact.phone ?? ''}
        onChange={(e) => onChange({ ...contact, phone: e.target.value || null })}
        maxLength={40}
        inputMode="tel"
        placeholder="電話番号"
        className="min-w-0 flex-1 basis-[40%] border-b border-border-strong bg-transparent text-sm text-ink outline-none"
      />
    </span>
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
