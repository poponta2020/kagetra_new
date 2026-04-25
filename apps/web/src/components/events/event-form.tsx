import Link from 'next/link'
import type { EventKind, EventStatus } from '@kagetra/shared/types'
import { Btn, Card } from '@/components/ui'

export interface EventFormProps {
  mode: 'create' | 'edit'
  action: (formData: FormData) => void | Promise<void>
  groups: { id: number; name: string }[]
  cancelHref: string
  defaultValues?: {
    title?: string | null
    formalName?: string | null
    official?: boolean
    kind?: EventKind
    eventDate?: string | null
    startTime?: string | null
    endTime?: string | null
    location?: string | null
    capacity?: number | null
    entryDeadline?: string | null
    internalDeadline?: string | null
    eventGroupId?: number | null
    eligibleGrades?: string[] | null
    description?: string | null
    status?: EventStatus
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
  groups,
  cancelHref,
  defaultValues,
}: EventFormProps) {
  const eligibleGrades = defaultValues?.eligibleGrades ?? null
  const submitLabel = mode === 'create' ? '作成' : '更新'

  return (
    <Card>
      <form action={action} className="space-y-4">
        <div>
          <label className={LABEL_CLASS}>
            タイトル{REQUIRED_MARK}
          </label>
          <input
            name="title"
            type="text"
            required
            defaultValue={defaultValues?.title ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>正式名称</label>
          <input
            name="formalName"
            type="text"
            defaultValue={defaultValues?.formalName ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-meta tracking-[0.02em]">
            <input
              name="official"
              type="checkbox"
              defaultChecked={defaultValues?.official ?? true}
              className="rounded border-border"
            />
            公認大会
          </label>
        </div>

        <input
          type="hidden"
          name="kind"
          value={defaultValues?.kind ?? 'individual'}
        />

        <div>
          <label className={LABEL_CLASS}>
            日付{REQUIRED_MARK}
          </label>
          <input
            name="eventDate"
            type="date"
            required
            defaultValue={defaultValues?.eventDate ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>開始時間</label>
            <input
              name="startTime"
              type="time"
              defaultValue={defaultValues?.startTime ?? ''}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>終了時間</label>
            <input
              name="endTime"
              type="time"
              defaultValue={defaultValues?.endTime ?? ''}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>場所</label>
          <input
            name="location"
            type="text"
            defaultValue={defaultValues?.location ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>定員</label>
          <input
            name="capacity"
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
              name="entryDeadline"
              type="date"
              defaultValue={defaultValues?.entryDeadline ?? ''}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>会内締切</label>
            <input
              name="internalDeadline"
              type="date"
              defaultValue={defaultValues?.internalDeadline ?? ''}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>大会グループ</label>
          <select
            name="eventGroupId"
            defaultValue={defaultValues?.eventGroupId ?? ''}
            className={FIELD_CLASS}
          >
            <option value="">--</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={`${LABEL_CLASS} mb-2`}>参加可能な級</label>
          <div className="flex gap-4">
            {GRADES.map((g) => (
              <label
                key={g}
                className="flex items-center gap-1 text-sm text-ink"
              >
                <input
                  name={`grade_${g}`}
                  type="checkbox"
                  defaultChecked={eligibleGrades?.includes(g) ?? false}
                  className="rounded border-border"
                />
                {g}級
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>説明</label>
          <textarea
            name="description"
            rows={3}
            defaultValue={defaultValues?.description ?? ''}
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>ステータス</label>
          <select
            name="status"
            defaultValue={defaultValues?.status ?? 'draft'}
            className={FIELD_CLASS}
          >
            <option value="draft">下書き</option>
            <option value="published">公開</option>
            {mode === 'edit' && <option value="cancelled">中止</option>}
            {mode === 'edit' && <option value="done">終了</option>}
          </select>
        </div>

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
