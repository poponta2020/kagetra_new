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
  listGroupSiblings,
  listMergeCandidateGroups,
  type EntryGroupFormAction,
} from '@/lib/entry-groups'
import { EventForm } from '@/components/events/event-form'
import { EntryGroupFieldset } from '@/components/events/entry-group-fieldset'

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

  // entry-groups: 「申込グループ」欄の pre-fill データ。entry-group-page (AC-21)
  // で締切系伝播ダイアログは撤去したが、グループの付け替え自体は日ページに残る。
  const [groupSiblings, mergeCandidates] = await Promise.all([
    listGroupSiblings(db, eventId),
    listMergeCandidateGroups(db, eventId, todayInJst()),
  ])

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

    // entry-group-page (AC-21): グループ共通7項目（締切4種・支払方法・振込先・
    // 申込方法）はこのフォームから消えた。`extractEventFormData` はそれらを null
    // として読んでしまうため、UPDATE の SET から必ず除外する —— 含めると
    // グループページ（`/admin/entries/[groupId]`）で設定した値が日ページの
    // 保存のたびに null で上書きされて消える。
    const {
      entryDeadline: _entryDeadline,
      internalDeadline: _internalDeadline,
      lotteryDate: _lotteryDate,
      paymentDeadline: _paymentDeadline,
      paymentDeadlineKind: _paymentDeadlineKind,
      paymentMethod: _paymentMethod,
      paymentInfo: _paymentInfo,
      entryMethod: _entryMethod,
      ...dayLocalData
    } = data

    // tournament-entry-rosters (Codex R6): edition 紐付けを解決して更新（link OFF なら null=解除）。
    await db.transaction(async (tx) => {
      const editionId = await resolveEditionFromForm(tx, formData, {
        kind: data.kind,
        year: editionYear,
        status: 'unconfirmed',
      })

      await tx
        .update(events)
        .set({
          ...dayLocalData,
          eligibleGrades: eligibleGrades.length > 0 ? eligibleGrades : null,
          editionId,
          updatedAt: new Date(),
        })
        .where(eq(events.id, eventId))

      // entry-groups: グループ付け替え（単独化/合流）。entry-group-page (AC-21) で
      // 締切系の伝播確認ダイアログは撤去したので、ここは付け替え自体のみ行う。
      await applyEntryGroupChange(tx, eventId, groupAction, targetGroupId)
    })

    revalidatePath(`/events/${eventId}`)
    revalidatePath('/events')

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
        hideGroupCommonFields
        defaultValues={{
          title: event.title,
          formalName: event.formalName,
          official: event.official,
          kind: event.kind,
          eventDate: event.eventDate,
          location: event.location,
          capacity: event.capacity,
          eligibleGrades: event.eligibleGrades,
          description: event.description,
          status: event.status,
          feeJpy: event.feeJpy,
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
      />
    </div>
  )
}
