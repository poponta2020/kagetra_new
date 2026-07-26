import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { events } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import { eventFormSchema, extractEventFormData } from '@/lib/form-schemas'
import { resolveEditionFromForm } from '@/lib/edition/resolve'
import { todayInJst } from '@/lib/jst-date'
import {
  applyEntryGroupChange,
  diffPropagatableFields,
  listGroupSiblings,
  listMergeCandidateGroups,
  propagateFieldsToGroup,
  type EntryGroupFormAction,
} from '@/lib/entry-groups'
import { EventForm } from '@/components/events/event-form'
import { EntryGroupFieldset } from '@/components/events/entry-group-fieldset'
import { EventEditSubmit } from '@/components/events/event-edit-submit'

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const idNum = Number(id)
  if (!Number.isInteger(idNum) || idNum <= 0) notFound()
  const session = await auth()
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'vice_admin')) {
    redirect('/403')
  }

  const event = await db.query.events.findFirst({
    where: eq(events.id, idNum),
    // tournament-entry-rosters (Codex R6): 現在の開催(edition) 紐付けを編集フォームに pre-fill。
    with: { edition: { with: { series: true } } },
  })

  if (!event) notFound()

  const eventId = event.id
  const editionDefault = event.edition
    ? {
        seriesName: event.edition.series?.name ?? '',
        editionNumber: event.edition.editionNumber,
        linked: true,
      }
    : { seriesName: '', editionNumber: null, linked: false }

  // entry-groups: 「申込グループ」欄・締切系伝播ダイアログの pre-fill データ。
  const [groupSiblings, mergeCandidates] = await Promise.all([
    listGroupSiblings(db, eventId),
    listMergeCandidateGroups(db, eventId, todayInJst()),
  ])
  const propagationSiblings = groupSiblings
    .filter((s) => s.id !== eventId)
    .map((s) => ({ id: s.id, title: s.title, eventDate: s.eventDate }))

  async function updateEvent(formData: FormData) {
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

    // entry-groups: 「申込グループ」欄（フォームの生値。zod スキーマは通さない——
    // resolveEditionFromForm の editionLink 系と同じ規約で、tx 内で再検証してから使う）。
    const groupActionRaw = formData.get('entry_group_action')
    const groupAction: EntryGroupFormAction =
      groupActionRaw === 'standalone' || groupActionRaw === 'merge' ? groupActionRaw : 'keep'
    const targetGroupIdRaw = formData.get('entry_group_target_id')
    const targetGroupId =
      typeof targetGroupIdRaw === 'string' && targetGroupIdRaw !== '' ? Number(targetGroupIdRaw) : null

    // entry-groups: 伝播ダイアログで選ばれた event id（クライアントの申告。tx 内で
    // 同一グループかを再検証してから使う。グループ付け替えと同時には適用しない
    // ——ダイアログは旧グループの日一覧から作られているため、旧グループに他の日が
    // 残っている場合でも意味がズレる。両者を同時にしない設計は EventEditSubmit 側にも
    // 明記している）。
    const propagateEventIds = formData
      .getAll('propagate_event_ids')
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n))

    // tournament-entry-rosters (Codex R6): edition 紐付けを解決して更新（link OFF なら null=解除）。
    const propagationResult = await db.transaction(async (tx) => {
      const editionId = await resolveEditionFromForm(tx, formData, {
        kind: data.kind,
        year: editionYear,
        status: 'unconfirmed',
      })

      // entry-groups: 伝播フィールドの差分検出用に「保存前」の値を読んでおく。
      const before = await tx.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          entryDeadline: true,
          internalDeadline: true,
          paymentDeadline: true,
          lotteryDate: true,
          paymentMethod: true,
          paymentInfo: true,
          entryMethod: true,
        },
      })

      await tx
        .update(events)
        .set({
          ...data,
          eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
          editionId,
          updatedAt: new Date(),
        })
        .where(eq(events.id, eventId))

      // entry-groups: グループ付け替え（単独化/合流）。
      const groupResult = await applyEntryGroupChange(tx, eventId, groupAction, targetGroupId)

      // entry-groups: 締切・支払い系の伝播は「グループを変更しない」保存のときだけ行う
      // （groupAction==='keep' 以外はダイアログの前提が崩れるため、送られてきていても無視する）。
      if (groupAction === 'keep' && propagateEventIds.length > 0 && before) {
        const changed = diffPropagatableFields(before, {
          entryDeadline: data.entryDeadline,
          internalDeadline: data.internalDeadline,
          paymentDeadline: data.paymentDeadline,
          lotteryDate: data.lotteryDate,
          paymentMethod: data.paymentMethod,
          paymentInfo: data.paymentInfo,
          entryMethod: data.entryMethod,
        })
        await propagateFieldsToGroup(tx, {
          groupId: groupResult.entryGroupId,
          excludeEventId: eventId,
          targetEventIds: propagateEventIds,
          changed,
        })
        return { propagatedIds: Object.keys(changed).length > 0 ? propagateEventIds : [] }
      }

      return { propagatedIds: [] as number[] }
    })

    revalidatePath(`/events/${eventId}`)
    revalidatePath('/events')
    for (const id of propagationResult.propagatedIds) {
      revalidatePath(`/events/${id}`)
    }

    redirect(`/events/${eventId}`)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-xl font-bold text-ink mb-4">イベント編集</h1>
      <EventForm
        mode="edit"
        action={updateEvent}
        cancelHref={`/events/${event.id}`}
        editionDefault={editionDefault}
        defaultValues={{
          title: event.title,
          formalName: event.formalName,
          official: event.official,
          kind: event.kind,
          eventDate: event.eventDate,
          location: event.location,
          capacity: event.capacity,
          entryDeadline: event.entryDeadline,
          internalDeadline: event.internalDeadline,
          lotteryDate: event.lotteryDate,
          eligibleGrades: event.eligibleGrades,
          description: event.description,
          status: event.status,
          feeJpy: event.feeJpy,
          paymentDeadline: event.paymentDeadline,
          paymentInfo: event.paymentInfo,
          paymentMethod: event.paymentMethod,
          entryMethod: event.entryMethod,
          organizer: event.organizer,
          capacityA: event.capacityA,
          capacityB: event.capacityB,
          capacityC: event.capacityC,
          capacityD: event.capacityD,
          capacityE: event.capacityE,
        }}
        entryGroupSection={
          <EntryGroupFieldset siblings={groupSiblings} mergeCandidates={mergeCandidates} />
        }
        submitButton={
          <EventEditSubmit
            label="更新"
            initialValues={{
              entryDeadline: event.entryDeadline,
              internalDeadline: event.internalDeadline,
              paymentDeadline: event.paymentDeadline,
              lotteryDate: event.lotteryDate,
              paymentMethod: event.paymentMethod,
              paymentInfo: event.paymentInfo,
              entryMethod: event.entryMethod,
            }}
            siblings={propagationSiblings}
          />
        }
      />
    </div>
  )
}
