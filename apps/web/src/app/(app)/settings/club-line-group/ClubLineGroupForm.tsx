'use client'

import { useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { Btn, Pill } from '@/components/ui'
import type { PillTone } from '@/components/ui'
import type {
  AvailableClubChatChannel,
  ClubLineGroupTaskRow,
  ClubLineGroupView,
  SaveClubLineGroupInput,
} from '@/lib/club-line-group'

export interface ClubLineGroupFormProps {
  initial: ClubLineGroupView | null
  availableChannels: AvailableClubChatChannel[]
  saveAction: (input: SaveClubLineGroupInput) => Promise<void>
  revertAction: () => Promise<void>
  retryTaskAction: (taskId: number) => Promise<{ error?: string }>
}

const STEPS = [
  '上の Bot を会の LINE グループに招待する',
  'グループで誰かが一言発言する（Bot がルームを認識します）',
  'LINE Official Account Manager でこの Bot のチャットを開き、グループのルームを開く',
  'ブラウザの URL（https://chat.line.biz/U…/chat/C…）と、画面上部のグループ名を下に貼る',
]

const TASK_KIND_LABEL: Record<ClubLineGroupTaskRow['kind'], string> = {
  announcement: '案内',
  reminder: 'リマインド',
}

const TASK_STATUS_LABEL: Record<ClubLineGroupTaskRow['status'], { label: string; tone: PillTone }> = {
  PENDING: { label: '待機中', tone: 'neutral' },
  RESERVING: { label: '予約中', tone: 'info' },
  RESERVED: { label: '予約済み', tone: 'success' },
  FAILED: { label: '失敗', tone: 'danger' },
  MANUAL_REVIEW_REQUIRED: { label: '要確認', tone: 'warn' },
  DRY_RUN_SUCCEEDED: { label: 'テスト送信済み', tone: 'info' },
  CANCEL_PENDING: { label: '取消中', tone: 'neutral' },
  CANCELLED: { label: '取消済み', tone: 'neutral' },
}

function toDate(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value
}

function formatTaskTime(value: Date | string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).format(toDate(value))
}

function formatCapturedDate(value: Date | string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(toDate(value))
}

/**
 * design-spec S3: 「予定と要約」＋「分割は (分割 n/m) で同じ日の別行」。
 * 要約はリマインドのみ（案内は宛先を絞らないので人数の要約が無い）。
 */
function taskSummary(task: ClubLineGroupTaskRow): string {
  const parts = [formatTaskTime(task.scheduledSendAt)]
  if (task.kind === 'reminder') {
    parts.push(`未回答 ${task.targetUserCount}名`)
  }
  const base = parts.join(' ・ ')
  return task.splitTotal > 1
    ? `${base}（分割 ${task.splitIndex + 1}/${task.splitTotal}）`
    : base
}

function taskErrorLine(task: ClubLineGroupTaskRow): string | null {
  if (!task.errorMessage && !task.errorCode) return null
  const prefix = task.status === 'MANUAL_REVIEW_REQUIRED' ? '要確認' : '予約に失敗'
  const code = task.errorCode ? `（${task.errorCode}）` : ''
  return `${prefix}: ${task.errorMessage ?? ''}${code}`
}

// design-mock `club-line-group.html` は U…/C… の全桁を出さず先頭 5 文字＋
// 「…」で丸める（例:「U16c4…」「Cd663…」）。33 文字の hex をそのまま出すと
// 375px 幅でラベル(72px)・バッジと同居できず、忠実度チェックの「横スクロール
// なし」を割る（`GradeGroupList` の `…${tail}` 省略と同じ発想の先頭版）。
function headEllipsis(value: string, headLen = 5): string {
  return value.length <= headLen ? value : `${value.slice(0, headLen)}…`
}

function KvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-2 text-sm">
      <span className="w-[72px] shrink-0 text-xs text-ink-meta">{label}</span>
      <span className={mono ? 'min-w-0 flex-1 font-mono text-xs text-ink' : 'min-w-0 flex-1 text-ink'}>
        {value}
      </span>
    </div>
  )
}

function Steps() {
  return (
    <ol className="flex flex-col gap-0.5">
      {STEPS.map((step, index) => (
        <li key={step} className="flex items-start gap-2.5 py-1.5 text-sm text-ink-2">
          <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-bg text-[11px] font-bold text-brand-fg">
            {index + 1}
          </span>
          <span className="leading-relaxed">{step}</span>
        </li>
      ))}
    </ol>
  )
}

function RoomUrlField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="club-line-group-url" className="text-xs text-ink-meta">
        ルーム URL<span className="ml-0.5 text-danger-fg">*</span>
      </label>
      <input
        id="club-line-group-url"
        type="text"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://chat.line.biz/U…/chat/C…"
        className="w-full rounded-md border border-border bg-surface px-[10px] py-[9px] font-mono text-xs text-ink"
      />
    </div>
  )
}

function RoomNameField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="club-line-group-name" className="text-xs text-ink-meta">
        グループ表示名<span className="ml-0.5 text-danger-fg">*</span>
      </label>
      <input
        id="club-line-group-name"
        type="text"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="令和8年度北海道大学かるた会"
        className="w-full rounded-md border border-border bg-surface px-[10px] py-[9px] text-sm text-ink"
      />
      <p className="text-[11px] leading-relaxed text-ink-meta">
        OAM の見出しと同じ文字列を貼ってください（人数の括弧は保存時に自動で取り除きます）。
      </p>
    </div>
  )
}

function TaskRow({
  task,
  retryTaskAction,
}: {
  task: ClubLineGroupTaskRow
  retryTaskAction: (taskId: number) => Promise<{ error?: string }>
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [retried, setRetried] = useState(false)
  const statusInfo = TASK_STATUS_LABEL[task.status]
  const errorLine = taskErrorLine(task)

  function handleRetry() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await retryTaskAction(task.id)
        if (result.error) setError(result.error)
        else setRetried(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : '再試行に失敗しました')
      }
    })
  }

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-16 shrink-0 text-xs text-ink-meta">{TASK_KIND_LABEL[task.kind]}</span>
        <span className="min-w-0 flex-1 leading-relaxed text-ink tabular-nums">
          {taskSummary(task)}
          {errorLine ? <span className="mt-0.5 block text-xs text-danger-fg">{errorLine}</span> : null}
        </span>
        <Pill tone={statusInfo.tone} size="sm">
          {statusInfo.label}
        </Pill>
      </div>
      {/* R10: 再試行は送信予定が未来の FAILED のみ（`retryable` はサーバー側で
          現在時刻を見て判定済み。クライアントで Date.now() と比較しない）。 */}
      {task.retryable ? (
        <div className="pl-[72px]">
          <button
            type="button"
            onClick={handleRetry}
            disabled={pending || retried}
            className="text-xs text-brand disabled:opacity-50"
          >
            {pending ? '再試行中…' : retried ? '再試行しました' : '再試行'}
          </button>
          {error ? (
            <p role="alert" className="mt-1 text-xs text-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ClubLineGroupForm({
  initial,
  availableChannels,
  saveAction,
  revertAction,
  retryTaskAction,
}: ClubLineGroupFormProps) {
  const [editingRoom, setEditingRoom] = useState(initial == null)
  const [channelId, setChannelId] = useState<string>(
    availableChannels[0] ? String(availableChannels[0].id) : '',
  )
  const [roomUrl, setRoomUrl] = useState('')
  const [chatRoomName, setChatRoomName] = useState(initial?.chatRoomName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function openEdit() {
    setError(null)
    setSaved(false)
    setRoomUrl(initial ? `https://chat.line.biz/${initial.oamAccountPath}/chat/${initial.oamChatRoomId}` : '')
    setChatRoomName(initial?.chatRoomName ?? '')
    setEditingRoom(true)
  }

  function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await saveAction({
          channelId: initial ? null : channelId ? Number(channelId) : null,
          roomUrl,
          chatRoomName,
        })
        setSaved(true)
        setEditingRoom(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    })
  }

  function handleRevert() {
    setError(null)
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        '会 LINE グループの設定を解除し、Bot をプールへ戻します。よろしいですか？',
      )
      if (!ok) return
    }
    startTransition(async () => {
      try {
        await revertAction()
      } catch (e) {
        setError(e instanceof Error ? e.message : '解除に失敗しました')
      }
    })
  }

  // ── 未設定: Bot 選択 + 手順 + URL/表示名 を1本のフォームで保存する ──
  if (!initial) {
    const noBotAvailable = availableChannels.length === 0
    return (
      <form onSubmit={submitRoom} className="flex flex-col gap-6 pb-24">
        <section className="flex flex-col gap-2">
          <div className="border-b border-border-strong pb-2">
            <h2 className="text-sm font-semibold text-ink">Bot</h2>
          </div>
          {noBotAvailable ? (
            <p className="text-xs text-danger-fg">
              プールに空き Bot がありません。/admin/line-channels で確認してください。
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="club-line-group-bot" className="text-xs text-ink-meta">
                使う Bot<span className="ml-0.5 text-danger-fg">*</span>
              </label>
              <select
                id="club-line-group-bot"
                required
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
                className="w-full appearance-none rounded-md border border-border bg-surface px-[10px] py-[9px] text-sm text-ink"
              >
                {availableChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] leading-relaxed text-ink-meta">
                選ぶと大会・級別の配信には使われなくなります。
              </p>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="border-b border-border-strong pb-2">
            <h2 className="text-sm font-semibold text-ink">グループ</h2>
          </div>
          <Steps />
          <RoomUrlField value={roomUrl} onChange={setRoomUrl} />
          <RoomNameField value={chatRoomName} onChange={setChatRoomName} />
          <div className="flex items-baseline gap-2 border-t border-border-soft pt-2 text-xs">
            <span className="w-[72px] shrink-0 text-ink-meta">グループ ID</span>
            <span className="min-w-0 flex-1 text-ink-meta">
              未捕捉
              <span className="mt-0.5 block leading-relaxed">
                Bot を招待すると自動で入ります。未捕捉の間はリマインドのメンションが使えず、名前の列挙になります
              </span>
            </span>
            <Pill tone="warn" size="sm">
              未捕捉
            </Pill>
          </div>
        </section>

        {error ? (
          <p role="alert" className="text-xs text-danger-fg">
            {error}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface px-4 py-3">
          <Btn kind="primary" size="lg" type="submit" disabled={pending || noBotAvailable} block>
            {pending ? '保存中…' : '保存'}
          </Btn>
        </div>
      </form>
    )
  }

  // ── 設定済み: kv 表示 + 編集 + プールへ戻す + 送信タスク一覧 ──
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 border-b border-border-strong pb-2">
          <h2 className="text-sm font-semibold text-ink">Bot</h2>
          <button
            type="button"
            onClick={handleRevert}
            disabled={pending}
            className="text-xs text-danger-fg disabled:opacity-50"
          >
            プールへ戻す
          </button>
        </div>
        <div className="divide-y divide-border-soft">
          <KvRow label="Bot" value={initial.botLabel} />
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 border-b border-border-strong pb-2">
          <h2 className="text-sm font-semibold text-ink">グループ</h2>
          {!editingRoom ? (
            <button type="button" onClick={openEdit} className="text-xs text-brand">
              編集
            </button>
          ) : null}
        </div>

        {editingRoom ? (
          <form onSubmit={submitRoom} className="flex flex-col gap-3 pt-1">
            <RoomUrlField value={roomUrl} onChange={setRoomUrl} />
            <RoomNameField value={chatRoomName} onChange={setChatRoomName} />
            {error ? (
              <p role="alert" className="text-xs text-danger-fg">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Btn
                type="button"
                kind="secondary"
                size="sm"
                onClick={() => setEditingRoom(false)}
                disabled={pending}
              >
                キャンセル
              </Btn>
              <Btn type="submit" kind="primary" size="sm" disabled={pending}>
                {pending ? '保存中…' : '保存'}
              </Btn>
            </div>
          </form>
        ) : (
          <>
            <div className="divide-y divide-border-soft">
              <KvRow label="表示名" value={initial.chatRoomName} />
              <KvRow
                label="OAM ルーム"
                value={`${headEllipsis(initial.oamAccountPath)}／${headEllipsis(initial.oamChatRoomId)}`}
                mono
              />
              <div className="flex items-baseline gap-2 py-2 text-sm">
                <span className="w-[72px] shrink-0 text-xs text-ink-meta">グループ ID</span>
                <span className="min-w-0 flex-1 font-mono text-xs text-ink">
                  {initial.lineGroupId ? headEllipsis(initial.lineGroupId) : '未捕捉'}
                  {initial.lineGroupId && initial.lineGroupCapturedAt ? (
                    <span className="ml-1.5 font-sans text-[11px] text-ink-meta">
                      {formatCapturedDate(initial.lineGroupCapturedAt)} に捕捉
                    </span>
                  ) : null}
                </span>
                <Pill tone={initial.lineGroupId ? 'success' : 'warn'} size="sm">
                  {initial.lineGroupId ? '捕捉済み' : '未捕捉'}
                </Pill>
              </div>
            </div>
            {!initial.lineGroupId ? (
              <p className="text-xs leading-relaxed text-ink-meta">
                未捕捉のため、リマインドのメンションは使えません（未回答者を氏名の列挙で知らせます）。
              </p>
            ) : null}
          </>
        )}
      </section>

      {saved && !editingRoom ? (
        <p role="status" className="-mt-4 text-xs text-success-fg">
          保存しました
        </p>
      ) : null}

      <section className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 border-b border-border-strong pb-2">
          <h2 className="text-sm font-semibold text-ink">送信タスク</h2>
          <span className="text-xs text-ink-meta">直近 10 件</span>
        </div>
        {initial.tasks.length === 0 ? (
          <p className="py-3 text-xs text-ink-meta">送信タスクはまだありません。</p>
        ) : (
          <div className="divide-y divide-border-soft">
            {initial.tasks.map((task) => (
              <TaskRow key={task.id} task={task} retryTaskAction={retryTaskAction} />
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-meta">
          失敗・要確認は管理者の LINE にも届きます。ワーカー（match-tracker）が止まっている間は
          「待機中」のまま残ります。
        </p>
      </section>
    </div>
  )
}
