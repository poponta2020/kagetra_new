import Link from 'next/link'
import type { EventKind, EventStatus } from '@kagetra/shared/types'
import { Btn, Card } from '@/components/ui'

export interface EventFormProps {
  mode: 'create' | 'edit'
  action: (formData: FormData) => void | Promise<void>
  cancelHref: string
  /**
   * tournament-entry-rosters: 手動作成/編集での開催(edition) 紐付けの pre-fill。
   * event_group 撤去の代替として、手動イベントも edition ハブに紐付けられるようにする
   * （Codex R6 should_fix）。embedded（承認画面）では描画しない（ApprovalForm が別途持つ）。
   */
  editionDefault?: {
    seriesName: string
    editionNumber: number | null
    linked: boolean
  }
  /**
   * tournament-title-grade-split: namespace every field `name` with this
   * prefix so multiple EventForms can be submitted from one parent `<form>`
   * (the multi-unit approval screen renders one form per event unit). Defaults
   * to '' so events/new and events/[id]/edit keep their bare field names.
   */
  fieldPrefix?: string
  defaultValues?: {
    title?: string | null
    formalName?: string | null
    official?: boolean
    kind?: EventKind
    eventDate?: string | null
    location?: string | null
    capacity?: number | null
    entryDeadline?: string | null
    internalDeadline?: string | null
    // entry-notify-lottery-treasurer: 抽選日（NULL=抽選なし）。承認画面 (embedded) では描画しない。
    lotteryDate?: string | null
    eligibleGrades?: string[] | null
    description?: string | null
    status?: EventStatus
    feeJpy?: number | null
    paymentDeadline?: string | null
    paymentInfo?: string | null
    paymentMethod?: string | null
    entryMethod?: string | null
    organizer?: string | null
    capacityA?: number | null
    capacityB?: number | null
    capacityC?: number | null
    capacityD?: number | null
    capacityE?: number | null
  }
}

const LABEL_CLASS = 'block text-xs font-semibold text-ink-meta tracking-[0.02em]'
const FIELD_CLASS =
  'mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30'
const REQUIRED_MARK = <span className="ml-0.5 text-accent">*</span>
const GRADES = ['A', 'B', 'C', 'D', 'E'] as const
// Btn primary/secondary share these base classes; mirror them for the
// `<Link>`-rendered cancel action since wrapping <Link> in <Btn> would
// nest it inside a <button>.
const CANCEL_LINK_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors h-10 px-4 text-sm bg-surface text-ink-2 border border-border hover:bg-surface-alt'

/**
 * Shared event create/edit form. Renders inside a {@link Card} and submits via
 * the `action` server action. Field markup stays as plain HTML elements +
 * Tailwind tokens so server-action wiring remains straightforward and so the
 * lower-level inputs do not need to be lifted into separate primitives.
 */
export function EventForm({
  mode,
  action,
  cancelHref,
  fieldPrefix = '',
  defaultValues,
  editionDefault,
}: EventFormProps) {
  const eligibleGrades = defaultValues?.eligibleGrades ?? null
  const submitLabel = mode === 'create' ? '作成' : '更新'
  // tournament-title-grade-split: in multi-unit mode the parent supplies the
  // outer <form>/submit, so EventForm only emits the namespaced fields (no
  // Card / form / action / buttons here).
  const embedded = fieldPrefix !== ''
  const n = (name: string) => `${fieldPrefix}${name}`

  const fields = (
    <>
        <div>
          <label className={LABEL_CLASS}>
            タイトル{REQUIRED_MARK}
          </label>
          <input
            name={n('title')}
            type="text"
            required
            defaultValue={defaultValues?.title ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>正式名称</label>
          <input
            name={n('formalName')}
            type="text"
            defaultValue={defaultValues?.formalName ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-meta tracking-[0.02em]">
            <input
              name={n('official')}
              type="checkbox"
              defaultChecked={defaultValues?.official ?? true}
              className="rounded border-border"
            />
            公認大会
          </label>
        </div>

        <input
          type="hidden"
          name={n('kind')}
          value={defaultValues?.kind ?? 'individual'}
        />

        <div>
          <label className={LABEL_CLASS}>
            日付{REQUIRED_MARK}
          </label>
          <input
            name={n('eventDate')}
            type="date"
            required
            defaultValue={defaultValues?.eventDate ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>場所</label>
          <input
            name={n('location')}
            type="text"
            defaultValue={defaultValues?.location ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>定員</label>
          <input
            name={n('capacity')}
            type="number"
            min="1"
            defaultValue={defaultValues?.capacity ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>大会申込締切</label>
            <input
              name={n('entryDeadline')}
              type="date"
              defaultValue={defaultValues?.entryDeadline ?? ''}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>会内締切</label>
            <input
              name={n('internalDeadline')}
              type="date"
              defaultValue={defaultValues?.internalDeadline ?? ''}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        {/* entry-notify-lottery-treasurer: 抽選日は単体行で締切群の直下に置く。
            承認画面 (embedded) では描画しない（要件 §5.2: 承認直後は NULL、編集画面で後入力）。
            申込完了通知の参加者向け文面に「抽選日は M/D です」を差し込むため手動入力。 */}
        {!embedded && (
          <div>
            <label className={LABEL_CLASS}>抽選日</label>
            <input
              name={n('lotteryDate')}
              type="date"
              defaultValue={defaultValues?.lotteryDate ?? ''}
              className={FIELD_CLASS}
            />
            <p className="mt-1 text-xs text-ink-meta">
              指定すると申込完了の LINE 通知に「抽選日は M/D です」が追記されます。
            </p>
          </div>
        )}

        {/* tournament-entry-rosters (Codex R6): 手動作成/編集でも開催(edition) に紐付けられる
            導線（event_group 撤去の代替）。承認画面 (embedded) は ApprovalForm 側が持つので出さない。 */}
        {!embedded && (
          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                name="editionLink"
                defaultChecked={editionDefault?.linked ?? false}
                className="rounded border-border"
              />
              開催（第N回○○大会）に紐付ける
            </label>
            <p className="mt-1 text-xs text-ink-meta">
              系列名が既存と一致すればその系列の開催に紐付けます。一致する既存系列が無い場合は
              下の「新規系列を作成」も入れてください。
            </p>
            <div className="mt-2 grid grid-cols-[1fr_6rem] gap-3">
              <div>
                <label className={LABEL_CLASS}>系列名</label>
                <input
                  name="editionSeriesName"
                  type="text"
                  defaultValue={editionDefault?.seriesName ?? ''}
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>回次</label>
                <input
                  name="editionNumber"
                  type="number"
                  min="1"
                  defaultValue={editionDefault?.editionNumber ?? ''}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                name="editionCreateNewSeries"
                defaultChecked={false}
                className="rounded border-border"
              />
              一致する既存系列が無い場合、この系列名で新規系列を作成する
            </label>
          </div>
        )}

        <div>
          <label className={`${LABEL_CLASS} mb-2`}>参加可能な級</label>
          <div className="flex gap-4">
            {GRADES.map((g) => (
              <label
                key={g}
                className="flex items-center gap-1 text-sm text-ink"
              >
                <input
                  name={n(`grade_${g}`)}
                  type="checkbox"
                  defaultChecked={eligibleGrades?.includes(g) ?? false}
                  className="rounded border-border"
                />
                {g}級
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>参加費 (円)</label>
            <input
              name={n('feeJpy')}
              type="number"
              min="0"
              step="100"
              defaultValue={defaultValues?.feeJpy ?? ''}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>支払締切</label>
            <input
              name={n('paymentDeadline')}
              type="date"
              defaultValue={defaultValues?.paymentDeadline ?? ''}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>支払方法</label>
          <input
            name={n('paymentMethod')}
            type="text"
            defaultValue={defaultValues?.paymentMethod ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>支払情報</label>
          <textarea
            name={n('paymentInfo')}
            rows={2}
            defaultValue={defaultValues?.paymentInfo ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>申込方法</label>
          <input
            name={n('entryMethod')}
            type="text"
            defaultValue={defaultValues?.entryMethod ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>主催</label>
          <input
            name={n('organizer')}
            type="text"
            defaultValue={defaultValues?.organizer ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={`${LABEL_CLASS} mb-2`}>級別定員</label>
          <div className="grid grid-cols-5 gap-2">
            <div>
              <label className={LABEL_CLASS}>A 級</label>
              <input
                name={n('capacityA')}
                type="number"
                min="1"
                defaultValue={defaultValues?.capacityA ?? ''}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>B 級</label>
              <input
                name={n('capacityB')}
                type="number"
                min="1"
                defaultValue={defaultValues?.capacityB ?? ''}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>C 級</label>
              <input
                name={n('capacityC')}
                type="number"
                min="1"
                defaultValue={defaultValues?.capacityC ?? ''}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>D 級</label>
              <input
                name={n('capacityD')}
                type="number"
                min="1"
                defaultValue={defaultValues?.capacityD ?? ''}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>E 級</label>
              <input
                name={n('capacityE')}
                type="number"
                min="1"
                defaultValue={defaultValues?.capacityE ?? ''}
                className={FIELD_CLASS}
              />
            </div>
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>説明</label>
          <textarea
            name={n('description')}
            rows={3}
            defaultValue={defaultValues?.description ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        {/* draft 廃止: 作成は常に published（status コントロールを出さない）。
            編集時のみ 公開(通常)/中止/終了 を選べる（中止からの復帰=「公開(通常)」）。
            作成経路（手動 events/new・承認 ApprovalForm はどちらも mode="create"）では
            status 入力自体を描画しないので、form-schemas の既定 'published' が採用される。 */}
        {mode === 'edit' && (
          <div>
            <label className={LABEL_CLASS}>ステータス</label>
            <select
              name={n('status')}
              defaultValue={defaultValues?.status ?? 'published'}
              className={FIELD_CLASS}
            >
              <option value="published">公開（通常）</option>
              <option value="cancelled">中止</option>
              <option value="done">終了</option>
            </select>
          </div>
        )}
    </>
  )

  // Embedded (multi-unit) mode: emit fields only; parent owns <form>/submit.
  if (embedded) {
    return <div className="space-y-4">{fields}</div>
  }

  return (
    <Card>
      <form action={action} className="space-y-4">
        {fields}

        <div className="flex justify-end gap-2 pt-2">
          <Link href={cancelHref} className={CANCEL_LINK_CLASS}>
            キャンセル
          </Link>
          <Btn type="submit" kind="primary" size="md">
            {submitLabel}
          </Btn>
        </div>
      </form>
    </Card>
  )
}
