import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { events } from '@kagetra/shared/schema'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
import { broadcastEventsToGradeGroups } from '@/lib/event-grade-broadcast'
import { resolveEditionFromForm } from '@/lib/edition/resolve'
import { EventForm } from '@/components/events/event-form'

export default async function NewEventPage() {
  const session = await auth()
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
    redirect('/403')
  }

  async function createEvent(formData: FormData) {
    'use server'
    const session = await auth()
    if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
      throw new Error('Unauthorized')
    }

    const parsed = eventFormSchema.safeParse(extractEventFormData(formData))
    if (!parsed.success) {
      throw new Error(`入力が不正です: ${parsed.error.issues[0]?.message ?? ''}`)
    }
    const data = parsed.data

    const eligibleGrades = (['A', 'B', 'C', 'D', 'E'] as const).filter(g => formData.get(`grade_${g}`) === 'on')
    const editionYear =
      data.eventDate && /^\d{4}-/.test(data.eventDate) ? Number(data.eventDate.slice(0, 4)) : null

    // tournament-entry-rosters (Codex R6): 手動作成でも開催(edition) に紐付けられる。
    // edition 解決(系列の find-or-create)と events 挿入を 1 tx で。redirect は tx 外。
    const created = await db.transaction(async (tx) => {
      const editionId = await resolveEditionFromForm(tx, formData, {
        kind: data.kind,
        year: editionYear,
        status: 'unconfirmed',
      })
      const result = await tx
        .insert(events)
        .values({
          ...data,
          createdBy: session.user.id,
          eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
          editionId,
        })
        .returning({ id: events.id })
      return result[0]!
    })

    // event-grade-group-broadcast: 手動作成でも級別グループへ概要を配信する。
    // `redirect()` は例外を投げて関数を抜けるため、after() の登録は redirect より
    // **前**に行う。after() 自体はレスポンス flush 後に走るので、配信の遅さが
    // リダイレクトを待たせることはない。配信の失敗は作成を巻き戻さない。
    //
    // 要綱 URL は承認フォームでしか選べない（手動作成の時点で添付が存在しない）
    // ため、この経路の文面からは URL 行が省略される。
    after(async () => {
      try {
        await broadcastEventsToGradeGroups(db, [created.id])
      } catch (err) {
        console.error('[createEvent] broadcastEventsToGradeGroups failed', err)
      }
    })

    redirect(`/events/${created.id}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold text-ink mb-4">イベント作成</h1>
      <EventForm
        mode="create"
        action={createEvent}
        cancelHref="/events"
      />
    </div>
  )
}
