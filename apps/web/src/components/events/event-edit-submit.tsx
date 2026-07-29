'use client'

import { useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Btn } from '@/components/ui'

/**
 * entry-groups タスク2: `/events/[id]/edit` の submit ボタン。締切・支払い系フィールド
 * （requirements §3.2.7）が変更されたときだけ、同グループの他の日への伝播確認ダイアログ
 * を出す。それ以外はそのまま通常の保存として送信する。
 *
 * ダイアログで選ばれた event id は `propagate_event_ids`（複数値）としてフォームへ隠し
 * input で足してから送信する。**実際にどのフィールドが変わったか・送られてきた id が
 * 本当に同一グループかは Server Action 側（`diffPropagatableFields` /
 * `propagateFieldsToGroup`）が再検証する**——ここでのクライアント判定は「ダイアログを
 * 出すかどうか」の UX 判断に過ぎない。
 *
 * グループ付け替え（`entry_group_action` が keep 以外）とこの伝播は同時に成立させない
 * 設計にしている（ダイアログは旧グループの日一覧から作られており、付け替え後の
 * グループには意味を持たないため）。`entry_group_action` が keep 以外のときはダイアログ
 * を出さずそのまま送信する。Server Action 側も同じ理由で `entry_group_action !== 'keep'`
 * のときは `propagate_event_ids` を無視する（両側で同じ決定を守る）。
 */

const PROPAGATE_FIELD_NAMES = [
  'entryDeadline',
  'internalDeadline',
  'paymentDeadline',
  // mail-ai-extract-refinements §3.2.7: 状態だけを変えた（例: 後日連絡→未設定のまま
  // 日付は入れていない）ときも伝播確認ダイアログを出す。日付と状態は CHECK 制約で
  // 対になっているため、片方だけ伝播すると伝播先で制約違反になる
  // （entry-groups.ts の PROPAGATABLE_FIELD_KEYS が両方セットで束ねて返す設計と対応）。
  'paymentDeadlineKind',
  'lotteryDate',
  'paymentMethod',
  'paymentInfo',
  'entryMethod',
] as const

export interface PropagationSibling {
  id: number
  title: string
  /** `YYYY-MM-DD`。 */
  eventDate: string
}

export interface EventEditSubmitProps {
  label: string
  /** 保存前（フォーム初期表示時）の値。フォームの現在値と比較して変更を検知する。 */
  initialValues: Partial<Record<(typeof PROPAGATE_FIELD_NAMES)[number], string | null>>
  /** 現在のグループの自分以外の日（伝播ダイアログの対象。空なら伝播はそもそも起きない）。 */
  siblings: PropagationSibling[]
}

function readGroupAction(form: HTMLFormElement): string {
  const node = form.elements.namedItem('entry_group_action') as unknown as { value?: string } | null
  return node?.value ?? 'keep'
}

function hasChanges(
  form: HTMLFormElement,
  initialValues: EventEditSubmitProps['initialValues'],
): boolean {
  return PROPAGATE_FIELD_NAMES.some((name) => {
    // `paymentDeadlineKind` は `<select>` で描画される（HTMLSelectElement も
    // `.value` を持つので同じ読み方でよい）。要素が無い場合（フォーム構成が変わった
    // 等）は落とさず変更なし扱いにする。
    const el = form.elements.namedItem(name) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null
    if (!el) return false
    const current = el.value ?? ''
    const initial = initialValues[name] ?? ''
    return current !== initial
  })
}

export function EventEditSubmit({ label, initialValues, siblings }: EventEditSubmitProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(() => new Set(siblings.map((s) => s.id)))
  const formRef = useRef<HTMLFormElement | null>(null)

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form
    if (!form) return

    // グループ付け替え中は旧グループの日一覧を対象にした伝播ダイアログを出さない
    // （設計判断。上のファイル doc comment 参照）。
    if (readGroupAction(form) !== 'keep') return
    if (siblings.length === 0) return
    if (!hasChanges(form, initialValues)) return

    e.preventDefault()
    formRef.current = form
    setDialogOpen(true)
  }

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirmAndSubmit() {
    const form = formRef.current
    if (!form) return
    // ★前回生成した hidden input を必ず全部消してから積み直す（r4 review blocker）。
    // `requestSubmit()` はブラウザの必須入力検証で中断されることがあり、その場合
    // フォームは残る。追加するだけだと、次の確認でチェックを外した日の id が前回分と
    // して残り、**明示的に除外した日の締切・支払い情報まで上書き**してしまう。
    for (const stale of form.querySelectorAll('input[data-propagate-generated="1"]')) {
      stale.remove()
    }
    for (const id of checked) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'propagate_event_ids'
      input.value = String(id)
      input.dataset.propagateGenerated = '1'
      form.appendChild(input)
    }
    setDialogOpen(false)
    form.requestSubmit()
  }

  return (
    <>
      <Btn type="submit" kind="primary" size="md" onClick={handleClick}>
        {label}
      </Btn>
      {dialogOpen &&
        createPortal(
          // Portal + .modal-overlay-h (svh cascade): 祖先の stacking context を脱出し、
          // iOS viewport-fit=cover の dvh 罠を svh で回避（InviteCodeModal と同パターン）。
          <div
            role="dialog"
            aria-modal="true"
            aria-label="同じグループの他の日にも反映しますか？"
            className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
            onClick={() => setDialogOpen(false)}
          >
            <div
              className="flex max-h-full w-full max-w-md flex-col gap-4 rounded-t-2xl bg-surface p-4 sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="font-display text-lg font-bold text-ink">
                同じグループの他の日にも反映しますか？
              </h2>
              <p className="text-[13px] text-ink-meta">
                締切・支払い系の変更を、チェックした日にも同じ内容で保存します。外した日は
                この日だけの設定として扱われます。
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ul className="space-y-2">
                  {siblings.map((s) => (
                    <li key={s.id}>
                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={checked.has(s.id)}
                          onChange={() => toggle(s.id)}
                          className="rounded border-border"
                        />
                        {s.eventDate} {s.title}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex justify-end gap-2">
                <Btn type="button" kind="secondary" size="md" onClick={() => setDialogOpen(false)}>
                  キャンセル
                </Btn>
                <Btn type="button" kind="primary" size="md" onClick={confirmAndSubmit}>
                  保存
                </Btn>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
