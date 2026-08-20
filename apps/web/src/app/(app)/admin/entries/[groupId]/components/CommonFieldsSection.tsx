'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/components/ui'
import { formatFlowDate } from '@/lib/event-date'
import { cn } from '@/lib/utils'
import {
  DisclosureSection,
  FlatTable,
  LinkAction,
  type FlatTableRow,
} from '@/components/events/detail'
import {
  PAYMENT_DEADLINE_KINDS,
  PAYMENT_DEADLINE_KIND_LABELS,
  type PaymentDeadlineKind,
} from '@/lib/events/payment-deadline'
import type { GroupCommonFieldsInput } from '../actions'

/**
 * グループ共通7項目の表示とインライン編集（管理者のみ）。
 * 視覚の正は `design-mock/page-admin.html` §⑤ と `edge-cases.html` ③。
 *
 * **サブページ（`/admin/entries/[groupId]/edit`）にしない**（実装手順書 確定事項2）:
 * 7項目すべてが日付か短いテキストで往復するほどの分量ではなく、`/events/[id]/edit`
 * と役割が紛らわしくなるため。design-spec §10 はどちらでも忠実度チェックリストを
 * 満たすとしている。
 *
 * 食い違い（`varies`）は**最も早い値を主に出し、朱で「（日により異なる）」を添える**
 * （design-spec §3.3-5）。アクションは「編集して揃える」1本。朱を使うのはここと
 * 期限超過・要対応フェーズだけ（design-spec §8）。
 */

export interface CommonFieldValue<T> {
  value: T
  varies: boolean
}

export interface CommonFieldsView {
  entryDeadline: CommonFieldValue<string | null>
  internalDeadline: CommonFieldValue<string | null>
  lotteryDate: CommonFieldValue<string | null>
  paymentDeadline: CommonFieldValue<string | null>
  paymentDeadlineKind: CommonFieldValue<PaymentDeadlineKind>
  paymentMethod: CommonFieldValue<string | null>
  paymentInfo: CommonFieldValue<string | null>
  entryMethod: CommonFieldValue<string | null>
}

export interface CommonFieldsSectionProps {
  groupId: number
  fields: CommonFieldsView
  /** グループの日数（`全N日に反映` の N。cancelled も含む＝保存対象と同じ母数）。 */
  dayCount: number
  saveAction: (groupId: number, input: GroupCommonFieldsInput) => Promise<void>
}

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-canvas px-2 py-1 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/30'

/** 支払締切は日付が無くても「後日連絡」なら状態を出す（日ページと同一規則）。 */
function paymentDeadlineText(date: string | null, kind: PaymentDeadlineKind): string {
  if (date != null) return formatFlowDate(date)
  return kind === 'later_notice' ? '後日連絡' : '—'
}

function dateText(date: string | null): string {
  return date == null ? '—' : formatFlowDate(date)
}

function textOrDash(value: string | null): string {
  return value == null || value === '' ? '—' : value
}

/** 表示値＋食い違い注記。値そのものは最も早い値（design-spec §3.3-5）。 */
function readValue(text: string, varies: boolean) {
  if (!varies) return text
  return (
    <>
      {text}
      <span className="ml-1.5 text-xs text-accent-fg">（日により異なる）</span>
    </>
  )
}

export function CommonFieldsSection({
  groupId,
  fields,
  dayCount,
  saveAction,
}: CommonFieldsSectionProps) {
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // 食い違っている項目数（支払締切は日付と状態のどちらが割れていても1項目と数える）。
  const paymentDeadlineVaries =
    fields.paymentDeadline.varies || fields.paymentDeadlineKind.varies
  const variesCount = [
    fields.entryDeadline.varies,
    fields.internalDeadline.varies,
    fields.lotteryDate.varies,
    paymentDeadlineVaries,
    fields.paymentMethod.varies,
    fields.paymentInfo.varies,
    fields.entryMethod.varies,
  ].filter(Boolean).length

  function handleSubmit(formData: FormData) {
    setError(null)
    const read = (name: string): string | null => {
      const raw = formData.get(name)
      return typeof raw === 'string' && raw !== '' ? raw : null
    }
    const kindRaw = String(formData.get('paymentDeadlineKind'))
    const input: GroupCommonFieldsInput = {
      entryDeadline: read('entryDeadline'),
      internalDeadline: read('internalDeadline'),
      lotteryDate: read('lotteryDate'),
      paymentDeadline: read('paymentDeadline'),
      paymentDeadlineKind: (PAYMENT_DEADLINE_KINDS as readonly string[]).includes(kindRaw)
        ? (kindRaw as PaymentDeadlineKind)
        : 'unspecified',
      paymentMethod: read('paymentMethod'),
      paymentInfo: read('paymentInfo'),
      entryMethod: read('entryMethod'),
    }
    startTransition(async () => {
      try {
        await saveAction(groupId, input)
        setEditing(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    })
  }

  const readRows: FlatTableRow[] = [
    {
      label: '申込締切',
      value: readValue(dateText(fields.entryDeadline.value), fields.entryDeadline.varies),
      variant: 'date',
    },
    {
      label: '会内締切',
      value: readValue(
        dateText(fields.internalDeadline.value),
        fields.internalDeadline.varies,
      ),
      variant: 'date',
    },
    {
      label: '抽選日',
      value: readValue(dateText(fields.lotteryDate.value), fields.lotteryDate.varies),
      variant: 'date',
    },
    {
      label: '支払締切',
      value: readValue(
        paymentDeadlineText(fields.paymentDeadline.value, fields.paymentDeadlineKind.value),
        paymentDeadlineVaries,
      ),
      variant: 'date',
    },
    {
      label: '支払方法',
      value: readValue(textOrDash(fields.paymentMethod.value), fields.paymentMethod.varies),
    },
    {
      label: '振込先',
      value: readValue(textOrDash(fields.paymentInfo.value), fields.paymentInfo.varies),
      variant: 'prewrap',
    },
    {
      label: '申込方法',
      value: readValue(textOrDash(fields.entryMethod.value), fields.entryMethod.varies),
    },
  ]

  const editRows: FlatTableRow[] = [
    {
      label: '申込締切',
      value: (
        <input
          type="date"
          name="entryDeadline"
          defaultValue={fields.entryDeadline.value ?? ''}
          className={INPUT_CLASS}
        />
      ),
    },
    {
      label: '会内締切',
      value: (
        <input
          type="date"
          name="internalDeadline"
          defaultValue={fields.internalDeadline.value ?? ''}
          className={INPUT_CLASS}
        />
      ),
    },
    {
      label: '抽選日',
      value: (
        <input
          type="date"
          name="lotteryDate"
          defaultValue={fields.lotteryDate.value ?? ''}
          className={INPUT_CLASS}
        />
      ),
    },
    {
      label: '支払締切',
      value: (
        <>
          <input
            type="date"
            name="paymentDeadline"
            defaultValue={fields.paymentDeadline.value ?? ''}
            className={INPUT_CLASS}
          />
          {/* 日付を入れると保存時にサーバー側 `normalizePaymentDeadline` が
              `fixed` へ倒す（CHECK 制約。AC-20）。 */}
          <select
            name="paymentDeadlineKind"
            defaultValue={fields.paymentDeadlineKind.value}
            className={cn(INPUT_CLASS, 'mt-1')}
          >
            {PAYMENT_DEADLINE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {PAYMENT_DEADLINE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </>
      ),
    },
    {
      label: '支払方法',
      value: (
        <input
          type="text"
          name="paymentMethod"
          defaultValue={fields.paymentMethod.value ?? ''}
          className={INPUT_CLASS}
        />
      ),
    },
    {
      label: '振込先',
      value: (
        <textarea
          name="paymentInfo"
          rows={2}
          defaultValue={fields.paymentInfo.value ?? ''}
          className={INPUT_CLASS}
        />
      ),
    },
    {
      label: '申込方法',
      value: (
        <input
          type="text"
          name="entryMethod"
          defaultValue={fields.entryMethod.value ?? ''}
          className={INPUT_CLASS}
        />
      ),
    },
  ]

  return (
    <DisclosureSection
      title="共通項目"
      aux={variesCount > 0 ? `${variesCount}項目が日により異なる` : `全${dayCount}日に反映`}
      auxTone={variesCount > 0 ? 'warn' : 'meta'}
      nested
      className="pt-[34px]"
    >
      {editing ? (
        <form action={handleSubmit}>
          <FlatTable rows={editRows} />
          {error ? <p className="pt-2 text-xs text-danger-fg">{error}</p> : null}
          <div className="mt-[11px] flex items-center justify-end gap-2.5">
            <LinkAction disabled={isPending} onClick={() => setEditing(false)}>
              キャンセル
            </LinkAction>
            <Btn type="submit" size="sm" className="h-[30px] rounded-md" disabled={isPending}>
              全{dayCount}日へ保存
            </Btn>
          </div>
        </form>
      ) : (
        <>
          <FlatTable rows={readRows} />
          <div className="mt-[11px] flex items-center justify-end gap-2.5">
            <LinkAction onClick={() => setEditing(true)}>
              {variesCount > 0 ? '編集して揃える' : '編集'}
            </LinkAction>
          </div>
          <p className="mt-[3px] text-xs text-neutral-fg">
            ここでの保存はグループの全{dayCount}日へ同時に書き込む。開催日・級・定員・参加費は
            日ごとの項目なので大会詳細の編集で直す。
          </p>
        </>
      )}
    </DisclosureSection>
  )
}
