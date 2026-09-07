'use client'

import { useActionState, useId, useRef, useState } from 'react'
import Link from 'next/link'
import {
  DEPARTURE_KIND_LABELS,
  RETURN_KIND_LABELS,
  isSchoolYearForKind,
  schoolYearOptions,
} from '@kagetra/shared'
import type { FacultyKind, Grade, TravelLeg, TravelWayKind } from '@kagetra/shared/types'
import { FacultyCombobox } from '@/components/members/FacultyCombobox'
import { Btn } from '@/components/ui'
import { linkActionClass } from '@/components/events/detail'
import { cn } from '@/lib/utils'
import { formatDateTimeShort, formatEventDate } from '@/lib/event-date'
import {
  applyWayChange,
  buildAttendanceRows,
  buildDefaultLegs,
  PLACE_MAX_LENGTH,
  type DefaultLegInput,
} from '@/lib/travel-report/routes'
import { addDays } from '@/lib/travel-report/units'
import { saveTravelRouteAction, type SaveTravelRouteState } from './actions'

/**
 * travel-report S8: 遠征経路の入力フォーム（requirements R6・design-spec §8）。
 *
 * 既定行の差し替えは `applyWayChange`（`lib/travel-report/routes.ts`）に**そのまま
 * 委ねる**。行き／帰りの選択・地名が変わるたびに「直前に生成していた既定行」を
 * `prevDefaultsRef` に持ち、`applyWayChange(legs, 直前の既定行, 新しい既定行)` で
 * 既定行だけを差し替える。本人が既定行を手で書き換えていれば一致しなくなるので
 * 残る——これは `applyWayChange` の契約どおりの挙動で、本コンポーネントはそれに
 * 一切手を加えない（routes.ts のコメント参照）。
 *
 * 表示する日（タイムライン）＝ **単位の全開催日 ∪ 既存の移動行の日 ∪ 手動で
 * 足した日**。単位の開催日は本人が出場しない日でも並ぶ（design-mock
 * 「帰省先から出場＋そのまま帰省」の断片で、出場しない 10/10 も表示される）。
 */

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function weekdayIndexOf(date: string): number {
  const m = DATE_RE.exec(date)
  if (!m) return -1
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
}

function monthDayOf(date: string): string {
  const m = DATE_RE.exec(date)
  if (!m) return date
  return `${Number(m[2])}/${Number(m[3])}`
}

const UNDERLINE_CLASS =
  'w-full min-w-0 border-0 border-b border-border bg-transparent px-0 py-[5px] font-sans text-sm text-ink outline-none focus:border-brand'

export interface RouteFormSavedRoute {
  departureKind: TravelWayKind
  departurePlace: string | null
  returnKind: TravelWayKind
  returnPlace: string | null
  legs: TravelLeg[]
  savedAtIso: string
}

export interface RouteFormProfile {
  facultyKind: FacultyKind | null
  faculty: string | null
  schoolYear: string | null
  phone: string | null
}

export interface RouteFormProps {
  eventId: number
  entryGroupId: number
  eventTitle: string
  unit: { startDate: string; endDate: string; dates: string[] }
  targetUserId: string
  targetName: string
  isProxy: boolean
  attendanceDates: string[]
  attendanceGrade: Grade | null
  destinationLabel: string | null
  saved: RouteFormSavedRoute | null
  profile: RouteFormProfile
}

const initialActionState: SaveTravelRouteState = {}

function defaultsInputOf(
  kinds: { departureKind: TravelWayKind; departurePlace: string; returnKind: TravelWayKind; returnPlace: string },
  attendanceDates: readonly string[],
  destinationLabel: string | null,
): DefaultLegInput {
  return {
    departureKind: kinds.departureKind,
    departurePlace: kinds.departurePlace,
    returnKind: kinds.returnKind,
    returnPlace: kinds.returnPlace,
    attendanceDates,
    destinationLabel,
  }
}

export function RouteForm({
  eventId,
  entryGroupId,
  eventTitle,
  unit,
  targetUserId,
  targetName,
  isProxy,
  attendanceDates,
  attendanceGrade,
  destinationLabel,
  saved,
  profile,
}: RouteFormProps) {
  const formId = useId()
  const [state, formAction, pending] = useActionState(saveTravelRouteAction, initialActionState)

  const [departureKind, setDepartureKind] = useState<TravelWayKind>(saved?.departureKind ?? 'sapporo')
  const [departurePlace, setDeparturePlace] = useState(saved?.departurePlace ?? '')
  const [returnKind, setReturnKind] = useState<TravelWayKind>(saved?.returnKind ?? 'sapporo')
  const [returnPlace, setReturnPlace] = useState(saved?.returnPlace ?? '')
  const [legs, setLegs] = useState<TravelLeg[]>(() =>
    saved
      ? saved.legs
      : // 初回表示（未保存）: 本人の出場日基準の既定行（R6・AC-13）。
        buildDefaultLegs(
          defaultsInputOf(
            { departureKind, departurePlace, returnKind, returnPlace },
            attendanceDates,
            destinationLabel,
          ),
        ),
  )
  const prevDefaultsRef = useRef<TravelLeg[]>(
    buildDefaultLegs(
      defaultsInputOf(
        { departureKind, departurePlace, returnKind, returnPlace },
        attendanceDates,
        destinationLabel,
      ),
    ),
  )
  const [extraDates, setExtraDates] = useState<string[]>([])

  const missingProfile =
    !profile.facultyKind || !profile.faculty || !profile.schoolYear || !profile.phone
  const [profileOpen, setProfileOpen] = useState(missingProfile)
  const [facultyKind, setFacultyKind] = useState<FacultyKind>(profile.facultyKind ?? 'undergraduate')
  const [faculty, setFaculty] = useState(profile.faculty ?? '')
  const [schoolYear, setSchoolYear] = useState(profile.schoolYear ?? '')
  const [phone, setPhone] = useState(profile.phone ?? '')

  function applyWayUpdate(overrides: Partial<{
    departureKind: TravelWayKind
    departurePlace: string
    returnKind: TravelWayKind
    returnPlace: string
  }>) {
    const merged = {
      departureKind: overrides.departureKind ?? departureKind,
      departurePlace: overrides.departurePlace ?? departurePlace,
      returnKind: overrides.returnKind ?? returnKind,
      returnPlace: overrides.returnPlace ?? returnPlace,
    }
    const nextDefaults = buildDefaultLegs(defaultsInputOf(merged, attendanceDates, destinationLabel))
    setLegs((prev) => applyWayChange(prev, prevDefaultsRef.current, nextDefaults))
    prevDefaultsRef.current = nextDefaults
    setDepartureKind(merged.departureKind)
    setDeparturePlace(merged.departurePlace)
    setReturnKind(merged.returnKind)
    setReturnPlace(merged.returnPlace)
  }

  function updateLeg(index: number, field: 'from' | 'to', value: string) {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, [field]: value } : leg)))
  }
  function removeLeg(index: number) {
    setLegs((prev) => prev.filter((_, i) => i !== index))
  }
  function addLeg(date: string) {
    setLegs((prev) => [...prev, { date, from: '', to: '' }])
  }

  const visibleDates = Array.from(
    new Set<string>([...unit.dates, ...legs.map((l) => l.date), ...extraDates]),
  ).sort()

  function addDayBefore() {
    const first = visibleDates[0]
    if (!first) return
    setExtraDates((prev) => [...prev, addDays(first, -1)])
  }
  function addDayAfter() {
    const last = visibleDates.at(-1)
    if (!last) return
    setExtraDates((prev) => [...prev, addDays(last, 1)])
  }

  const attendanceLabelByDate = new Map(
    buildAttendanceRows(attendanceDates, departureKind).map((row) => [row.date, row.label]),
  )
  const unitDatesLabel = unit.dates.map(formatEventDate).join('・')

  function handleFacultyKindChange(kind: FacultyKind) {
    setFacultyKind(kind)
    setSchoolYear((prev) => (isSchoolYearForKind(prev, kind) ? prev : ''))
  }

  return (
    <form action={formAction} className="flex min-h-full flex-col">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="entryGroupId" value={entryGroupId} />
      <input type="hidden" name="targetUserId" value={targetUserId} />
      <input type="hidden" name="departureKind" value={departureKind} />
      <input
        type="hidden"
        name="departurePlace"
        value={departureKind === 'other' ? departurePlace : ''}
      />
      <input type="hidden" name="returnKind" value={returnKind} />
      <input type="hidden" name="returnPlace" value={returnKind === 'other' ? returnPlace : ''} />
      <input
        type="hidden"
        name="legs"
        value={JSON.stringify(legs.map(({ date, from, to }) => ({ date, from, to })))}
      />

      {/* sticky ヘッダー: 大会名・単位の日付・対象者名（design-spec §8）。 */}
      <div className="sticky top-0 z-[3] -mx-4 -mt-4 border-b border-border-soft bg-canvas px-4 pt-[14px]">
        <nav className="flex items-baseline gap-[5px] pb-1 text-xs text-ink-meta">
          <Link href={`/events/${eventId}`} className="text-brand hover:underline">
            大会
          </Link>
          <span aria-hidden>›</span>
          <span className="min-w-0 truncate">{eventTitle}</span>
          <span aria-hidden>›</span>
          <span>遠征経路</span>
        </nav>
        <h1 className="font-display text-[28px] font-bold leading-tight text-ink">遠征経路</h1>
        <div className="mt-[3px] pb-[10px] text-xs tabular-nums text-ink-meta">
          {eventTitle} {unitDatesLabel} ／ {targetName}
          {isProxy && <span className="ml-1 text-accent-fg">（代理入力）</span>}
        </div>
      </div>

      {/* プロフィール1行（表示のみ。欠落時は表を開いた状態で始める）。 */}
      {!profileOpen && (
        <div className="flex items-center gap-1.5 pt-3 text-sm text-ink-2">
          <span className="whitespace-nowrap">
            {faculty} {schoolYear}
          </span>
          <span className="text-ink-muted">・</span>
          <span className="whitespace-nowrap">{phone}</span>
          <button
            type="button"
            className={linkActionClass('brand', 'ml-0.5')}
            onClick={() => setProfileOpen(true)}
          >
            修正
          </button>
          {saved && (
            <span className="ml-auto inline-flex h-5 flex-none items-center rounded-[5px] bg-brand-bg px-[7px] text-[11px] font-semibold text-brand-fg">
              入力済み {formatDateTimeShort(saved.savedAtIso)}
            </span>
          )}
        </div>
      )}
      {profileOpen && (
        <section className="pt-3">
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold text-ink-meta">あなたの情報</span>
            {missingProfile && <span className="text-accent-fg">不足があります</span>}
          </div>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              <tr>
                <th className="w-[72px] whitespace-nowrap py-[7px] text-left align-baseline text-xs font-normal text-ink-meta">
                  <span id={`${formId}-kind-label`}>所属</span>
                </th>
                <td className="py-[7px] align-baseline">
                  <div
                    role="radiogroup"
                    aria-labelledby={`${formId}-kind-label`}
                    className="inline-flex gap-3"
                  >
                    {(['undergraduate', 'graduate'] as const).map((kind) => (
                      <label key={kind} className="flex cursor-pointer items-center gap-1 text-sm">
                        <input
                          type="radio"
                          name="facultyKind"
                          value={kind}
                          checked={facultyKind === kind}
                          onChange={() => handleFacultyKindChange(kind)}
                          className="accent-brand"
                        />
                        {kind === 'undergraduate' ? '学部' : '大学院'}
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
              <tr className="border-t border-border-soft">
                <th className="w-[72px] whitespace-nowrap py-[7px] text-left align-baseline text-xs font-normal text-ink-meta">
                  <label htmlFor={`${formId}-faculty`}>学部等名</label>
                </th>
                <td className="py-[7px] align-baseline">
                  <FacultyCombobox
                    id={`${formId}-faculty`}
                    name="faculty"
                    kind={facultyKind}
                    value={faculty}
                    onChange={setFaculty}
                    required
                    className={UNDERLINE_CLASS}
                  />
                </td>
              </tr>
              <tr className="border-t border-border-soft">
                <th className="w-[72px] whitespace-nowrap py-[7px] text-left align-baseline text-xs font-normal text-ink-meta">
                  <label htmlFor={`${formId}-school-year`}>学年</label>
                </th>
                <td className="py-[7px] align-baseline">
                  <select
                    id={`${formId}-school-year`}
                    name="schoolYear"
                    value={schoolYear}
                    required
                    onChange={(e) => setSchoolYear(e.target.value)}
                    className="border-0 border-b border-border bg-transparent py-[5px] text-sm text-ink outline-none focus:border-brand"
                  >
                    <option value="" disabled>
                      選択してください
                    </option>
                    {schoolYearOptions(facultyKind).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr className="border-t border-border-soft">
                <th className="w-[72px] whitespace-nowrap py-[7px] text-left align-baseline text-xs font-normal text-ink-meta">
                  <label htmlFor={`${formId}-phone`}>電話</label>
                </th>
                <td className="py-[7px] align-baseline">
                  <input
                    id={`${formId}-phone`}
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={cn(UNDERLINE_CLASS, !phone && 'border-accent')}
                  />
                  {!phone && (
                    <div className="mt-[3px] text-xs text-accent-fg">
                      遠征届の名簿に載せるため、電話番号が必要です
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="pt-1.5 text-xs text-ink-meta">
            ここで入れた内容はプロフィールに保存され、次回からは聞かれません。
          </p>
        </section>
      )}

      {/* 行程: 行き／帰りの3択＋日ごとのタイムライン。 */}
      <section className="pt-[22px]">
        <div className="mb-[13px] flex items-baseline justify-between gap-2 border-b border-border-strong pb-[7px]">
          <h2 className="font-display text-[18px] font-semibold text-ink">行程</h2>
          <span className="text-xs text-ink-meta">出場日は名簿から自動</span>
        </div>

        <div className="pb-1.5">
          <div className="flex items-center gap-2.5 py-[5px]">
            <span className="w-[34px] flex-none text-xs text-ink-meta">行き</span>
            <WaySegment
              ariaLabel="行き"
              value={departureKind}
              onChange={(kind) => applyWayUpdate({ departureKind: kind })}
              labels={DEPARTURE_KIND_LABELS}
            />
          </div>
          {departureKind === 'other' && (
            <div className="flex items-center gap-2 pb-1 pl-11">
              <input
                aria-label="行きの地名"
                value={departurePlace}
                onChange={(e) => applyWayUpdate({ departurePlace: e.target.value })}
                maxLength={PLACE_MAX_LENGTH}
                className="w-40 border-0 border-b border-border bg-transparent px-0 py-[5px] text-sm text-ink outline-none focus:border-brand"
              />
              <span className="text-xs text-ink-meta">から向かう地名</span>
            </div>
          )}
          <div className="flex items-center gap-2.5 py-[5px]">
            <span className="w-[34px] flex-none text-xs text-ink-meta">帰り</span>
            <WaySegment
              ariaLabel="帰り"
              value={returnKind}
              onChange={(kind) => applyWayUpdate({ returnKind: kind })}
              labels={RETURN_KIND_LABELS}
            />
          </div>
          {returnKind === 'other' && (
            <div className="flex items-center gap-2 pb-1 pl-11">
              <input
                aria-label="帰りの地名"
                value={returnPlace}
                onChange={(e) => applyWayUpdate({ returnPlace: e.target.value })}
                maxLength={PLACE_MAX_LENGTH}
                className="w-40 border-0 border-b border-border bg-transparent px-0 py-[5px] text-sm text-ink outline-none focus:border-brand"
              />
              <span className="text-xs text-ink-meta">へ向かう地名</span>
            </div>
          )}
          {(departureKind === 'hometown' || returnKind === 'hometown') && (
            <p className="pt-1.5 text-xs leading-relaxed text-ink-meta">
              帰省先へ向かう移動が大会の直前なら、日を足して書いてください（例:
              10/8 札幌→八戸）。帰省先に滞在するなら、出場のあとは何も書かなくて大丈夫です。
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={addDayBefore}
          className="block w-full py-1.5 text-left text-xs text-brand"
        >
          ＋ 前の日を足す
        </button>

        <div className="mt-0.5">
          {visibleDates.map((date) => {
            const dow = weekdayIndexOf(date)
            const isAttendance = attendanceLabelByDate.has(date)
            const dayLegs = legs
              .map((leg, i) => ({ leg, i }))
              .filter(({ leg }) => leg.date === date)
            return (
              <div
                key={date}
                className="flex gap-2.5 border-t border-border-soft py-[9px] first:border-t-0"
              >
                <div
                  className={cn(
                    'w-16 flex-none pt-[6px] text-xs tabular-nums text-ink-2',
                    isAttendance && 'font-bold text-ink',
                  )}
                >
                  {monthDayOf(date)}{' '}
                  <span
                    className={cn(
                      dow === 6 && 'text-brand',
                      dow === 0 && 'text-accent-fg',
                      dow !== 6 && dow !== 0 && 'text-ink-meta',
                    )}
                  >
                    ({WEEKDAY_JA[dow] ?? ''})
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {isAttendance && (
                    <span
                      className={cn(
                        'inline-flex h-7 w-fit flex-none items-center gap-1.5 self-start rounded-full px-2.5 text-xs font-semibold',
                        departureKind === 'hometown'
                          ? 'bg-info-bg text-info-fg'
                          : 'bg-brand-bg text-brand-fg',
                      )}
                    >
                      {attendanceLabelByDate.get(date)}
                      {attendanceGrade && (
                        <span className="font-mono font-normal text-ink-meta">
                          {attendanceGrade}級
                        </span>
                      )}
                    </span>
                  )}
                  {dayLegs.length === 0 && !isAttendance && (
                    <span className="pt-[6px] text-xs text-ink-muted">移動なし</span>
                  )}
                  {dayLegs.map(({ leg, i }) => (
                    <div key={i} className="flex min-w-0 items-center gap-1.5">
                      <input
                        aria-label={`${date} 出発地`}
                        value={leg.from}
                        onChange={(e) => updateLeg(i, 'from', e.target.value)}
                        maxLength={PLACE_MAX_LENGTH}
                        className="min-w-0 flex-1 basis-[40%] border-0 border-b border-border bg-transparent px-0 py-[5px] text-sm text-ink outline-none focus:border-brand"
                      />
                      <span className="flex-none text-xs text-ink-meta">→</span>
                      <input
                        aria-label={`${date} 到着地`}
                        value={leg.to}
                        onChange={(e) => updateLeg(i, 'to', e.target.value)}
                        maxLength={PLACE_MAX_LENGTH}
                        className="min-w-0 flex-1 basis-[40%] border-0 border-b border-border bg-transparent px-0 py-[5px] text-sm text-ink outline-none focus:border-brand"
                      />
                      <button
                        type="button"
                        aria-label="この移動を削除"
                        onClick={() => removeLeg(i)}
                        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-sm text-ink-meta"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addLeg(date)}
                    className="self-start py-0.5 text-xs text-brand"
                  >
                    ＋ 移動を足す
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={addDayAfter}
          className="block w-full py-1.5 text-left text-xs text-brand"
        >
          ＋ 後の日を足す
        </button>
      </section>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-accent-fg">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="mt-3 text-sm text-brand-fg">
          保存しました
        </p>
      )}

      <div className="sticky bottom-0 z-[3] mt-auto -mx-4 border-t border-border bg-surface px-4 py-3">
        <Btn type="submit" size="lg" block disabled={pending}>
          {pending ? '保存中…' : saved ? '修正を保存' : 'この行程で保存'}
        </Btn>
      </div>
    </form>
  )
}

function WaySegment({
  ariaLabel,
  value,
  onChange,
  labels,
}: {
  ariaLabel: string
  value: TravelWayKind
  onChange: (v: TravelWayKind) => void
  labels: Record<TravelWayKind, string>
}) {
  const kinds: TravelWayKind[] = ['sapporo', 'hometown', 'other']
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-md border border-border-strong"
    >
      {kinds.map((kind, i) => (
        <button
          key={kind}
          type="button"
          role="radio"
          aria-checked={value === kind}
          onClick={() => onChange(kind)}
          className={cn(
            'px-[11px] py-[5px] text-xs',
            i > 0 && 'border-l border-border-strong',
            value === kind
              ? 'bg-brand font-semibold text-ink-on-brand'
              : 'text-ink-meta',
          )}
        >
          {labels[kind]}
        </button>
      ))}
    </div>
  )
}
