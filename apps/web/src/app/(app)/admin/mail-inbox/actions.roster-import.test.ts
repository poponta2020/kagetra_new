import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import {
  events,
  mailAttachments,
  mailWorkerJobs,
  resultDrafts,
  tournamentClasses,
  tournamentConfirmedRosterPublications,
  tournamentEditionGradeLotteryFacts,
  tournamentEntryRosters,
  tournamentRosterImportDrafts,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createMailMessage, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

const { revalidatePathMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/line-broadcast', () => ({
  broadcastMailToEvent: vi.fn(),
  loadActiveBinding: vi.fn(async () => null),
}))
vi.mock('@kagetra/mail-worker/classify/classifier', () => ({
  classifyMail: vi.fn(),
  persistOutcome: vi.fn(),
}))
vi.mock('@kagetra/mail-worker/classify/llm/anthropic', () => ({
  AnthropicSonnet46Extractor: class {},
}))
vi.mock('@kagetra/mail-worker/config', () => ({
  loadLlmConfig: () => ({ anthropicApiKey: 'test' }),
}))

const {
  approveResultDraft,
  approveRosterImportDraft,
  replaceActualResultFact,
  triggerRosterParse,
} = await import('./actions')

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'

async function createEditionFixture(grade: Grade = 'A') {
  const [series] = await testDb
    .insert(tournamentSeries)
    .values({ name: `テスト系列-${crypto.randomUUID()}`, kind: 'individual' })
    .returning()
  const [edition] = await testDb
    .insert(tournamentSeriesEditions)
    .values({ seriesId: series!.id, editionNumber: 1, year: 2030, status: 'held' })
    .returning()
  const [event] = await testDb
    .insert(events)
    .values({
      title: '第1回テスト大会',
      eventDate: '2030-06-01',
      kind: 'individual',
      editionId: edition!.id,
      eligibleGrades: [grade],
    })
    .returning()
  return { series: series!, edition: edition!, event: event! }
}

async function createAttachment(mailId: number, filename = 'roster.xlsx') {
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mailId,
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 16,
      data: Buffer.from('test'),
      extractionStatus: 'pending',
    })
    .returning()
  return attachment!
}

function rosterPayload(grade: Grade = 'A', count = 2, outcome = 'unknown') {
  return {
    parserVersion: 'roster-deterministic-v1',
    format: 'excel',
    sheetName: `${grade}級`,
    sheetNames: [`${grade}級`],
    validationIssues: [],
    entries: Array.from({ length: count }, (_, index) => ({
      rawName: `選手${index + 1}`,
      rawKana: null,
      grade,
      rawAffiliation: 'テスト会',
      rawDan: null,
      statusText: null,
      selectionOutcome: outcome,
      selectionExempt: false,
      seqNo: index + 1,
      sourceSheetName: `${grade}級`,
    })),
  }
}

async function createRosterDraft(input: {
  mailId: number
  attachmentId?: number | null
  grade?: Grade
  count?: number
  outcome?: 'accepted' | 'waitlisted' | 'rejected' | 'unknown'
}) {
  const [draft] = await testDb
    .insert(tournamentRosterImportDrafts)
    .values({
      sourceKind: input.attachmentId == null ? 'body' : 'attachment',
      sourceMailMessageId: input.mailId,
      sourceAttachmentId: input.attachmentId ?? null,
      parserVersion: 'roster-deterministic-v1',
      status: 'pending_review',
      inferredGrade: input.grade ?? 'A',
      extractedPayload: rosterPayload(
        input.grade ?? 'A',
        input.count ?? 2,
        input.outcome ?? 'unknown',
      ),
    })
    .returning()
  return draft!
}

function approvalForm(input: {
  editionId: number
  eventId: number
  grade?: Grade
  purpose?: 'applicant' | 'selection_result' | 'confirmed_publication'
  selectionStatus?: 'lottery' | 'under_capacity' | 'no_capacity' | 'unknown'
  capacity?: number | null
  exemptionClassificationVerified?: boolean
  revisionKind?: 'initial' | 'correction' | 'additional'
  correctionTargetRosterId?: number
}) {
  const form = new FormData()
  form.set('editionId', String(input.editionId))
  form.set('eventId', String(input.eventId))
  form.set('purpose', input.purpose ?? 'applicant')
  form.set('publishedAt', '2030-05-20')
  form.set('revisionKind', input.revisionKind ?? 'initial')
  form.set('gradeConfigs', JSON.stringify([{
    grade: input.grade ?? 'A',
    selectionStatus: input.selectionStatus ?? 'unknown',
    capacity: input.capacity ?? null,
    applicationStartDate: '2030-04-01',
    publishAsConfirmed: false,
    exemptionClassificationVerified: input.exemptionClassificationVerified ?? true,
  }]))
  if (input.correctionTargetRosterId != null) {
    form.set('correctionTargetRosterId', String(input.correctionTargetRosterId))
  }
  return form
}

function resultPayload(grade: Grade = 'A') {
  return {
    parserVersion: '1.0.0',
    classes: [
      {
        className: `${grade}級`,
        grade,
        sheetName: `${grade}級`,
        participants: [
          {
            seqNo: 1,
            name: '結果選手',
            nameKana: null,
            affiliation: null,
            prefecture: null,
            dan: null,
            memberNo: null,
            finalRank: '優勝',
            matches: [],
          },
        ],
      },
    ],
  }
}

async function createResultDraft(mailId: number) {
  const [draft] = await testDb
    .insert(resultDrafts)
    .values({
      messageId: mailId,
      status: 'pending_review',
      parserVersion: '1.0.0',
      extractedPayload: resultPayload(),
    })
    .returning()
  return draft!
}

describe('roster import review actions', () => {
  beforeEach(async () => {
    await truncateAll()
    revalidatePathMock.mockClear()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('adminだけが attachment/body 単位で起動でき、未完了jobの二重起動を防ぐ', async () => {
    const admin = await createAdmin()
    const mail = await createMailMessage({ bodyText: '本文名簿' })
    const attachment = await createAttachment(mail.id)
    await setAuthSession({ id: admin.id, role: 'admin' })

    const first = await triggerRosterParse(mail.id, attachment.id)
    expect(first.ok).toBe(true)
    const duplicate = await triggerRosterParse(mail.id, attachment.id)
    expect(duplicate.ok).toBe(true)
    if (first.ok && duplicate.ok) expect(duplicate.jobId).toBe(first.jobId)

    const body = await triggerRosterParse(mail.id, null)
    expect(body.ok).toBe(true)
    const jobs = await testDb.select().from(mailWorkerJobs)
    expect(jobs).toHaveLength(2)
    expect(jobs.map((job) => job.payload)).toEqual(
      expect.arrayContaining([
        { mail_message_id: mail.id, attachment_id: attachment.id },
        { mail_message_id: mail.id, attachment_id: null },
      ]),
    )

    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(triggerRosterParse(mail.id, null)).rejects.toThrow('Forbidden')
  })

  it('定員未満の申込名簿を1トランザクションで採用し、seriesをrevalidateする', async () => {
    const admin = await createAdmin()
    const { series, edition, event } = await createEditionFixture()
    const mail = await createMailMessage()
    const attachment = await createAttachment(mail.id)
    const draft = await createRosterDraft({ mailId: mail.id, attachmentId: attachment.id })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await approveRosterImportDraft(
      draft.id,
      approvalForm({ editionId: edition.id, eventId: event.id, selectionStatus: 'under_capacity', capacity: 3 }),
    )
    expect(result.ok).toBe(true)

    const fact = await testDb.query.tournamentEditionGradeLotteryFacts.findFirst({
      where: eq(tournamentEditionGradeLotteryFacts.editionId, edition.id),
    })
    expect(fact).toMatchObject({
      grade: 'A',
      selectionStatus: 'under_capacity',
      capacity: 3,
      applicationStartDate: '2030-04-01',
    })
    expect(fact?.applicantRosterId).not.toBeNull()
    expect(revalidatePathMock).toHaveBeenCalledWith(`/tournaments/series/${series.id}`)
  })

  it('定員なしは正の申込者数とcapacityなしで採用する', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    const mail = await createMailMessage()
    const draft = await createRosterDraft({ mailId: mail.id, count: 1 })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await approveRosterImportDraft(
      draft.id,
      approvalForm({
        editionId: edition.id,
        eventId: event.id,
        selectionStatus: 'no_capacity',
        capacity: null,
      }),
    )
    expect(result.ok).toBe(true)
    expect(await testDb.query.tournamentEditionGradeLotteryFacts.findFirst({
      where: eq(tournamentEditionGradeLotteryFacts.editionId, edition.id),
    })).toMatchObject({ selectionStatus: 'no_capacity', capacity: null })
  })

  it('lottery は申込・抽選結果原本が揃わない限り採用せずrollbackする', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    const mail = await createMailMessage()
    const draft = await createRosterDraft({ mailId: mail.id })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await approveRosterImportDraft(
      draft.id,
      approvalForm({ editionId: edition.id, eventId: event.id, selectionStatus: 'lottery', capacity: 10 }),
    )
    expect(result.ok).toBe(false)
    expect(await testDb.select().from(tournamentEntryRosters)).toHaveLength(0)
  })

  it('lottery は当落不明を拒否し、当選者を持つ結果原本で採用する', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const applicantMail = await createMailMessage()
    const applicantDraft = await createRosterDraft({ mailId: applicantMail.id })
    expect((await approveRosterImportDraft(
      applicantDraft.id,
      approvalForm({ editionId: edition.id, eventId: event.id }),
    )).ok).toBe(true)

    const unknownMail = await createMailMessage()
    const unknownDraft = await createRosterDraft({ mailId: unknownMail.id, outcome: 'unknown' })
    expect((await approveRosterImportDraft(
      unknownDraft.id,
      approvalForm({
        editionId: edition.id,
        eventId: event.id,
        purpose: 'selection_result',
        selectionStatus: 'lottery',
        capacity: 10,
      }),
    )).ok).toBe(false)

    const acceptedMail = await createMailMessage()
    const acceptedDraft = await createRosterDraft({ mailId: acceptedMail.id, outcome: 'accepted' })
    expect((await approveRosterImportDraft(
      acceptedDraft.id,
      approvalForm({
        editionId: edition.id,
        eventId: event.id,
        purpose: 'selection_result',
        selectionStatus: 'lottery',
        capacity: 10,
      }),
    )).ok).toBe(true)

    expect(await testDb.query.tournamentEditionGradeLotteryFacts.findFirst({
      where: and(
        eq(tournamentEditionGradeLotteryFacts.editionId, edition.id),
        isNull(tournamentEditionGradeLotteryFacts.validTo),
      ),
    })).toMatchObject({ selectionStatus: 'lottery' })
  })

  it('名簿採用も未認証/memberから呼べない', async () => {
    const { edition, event } = await createEditionFixture()
    const mail = await createMailMessage()
    const draft = await createRosterDraft({ mailId: mail.id })
    const form = approvalForm({ editionId: edition.id, eventId: event.id })

    await setAuthSession(null)
    await expect(approveRosterImportDraft(draft.id, form)).rejects.toThrow('Unauthorized')
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    await expect(approveRosterImportDraft(draft.id, form)).rejects.toThrow('Forbidden')
  })

  it('publishedAt/applicationStartDateの存在しない暦日を拒否する', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    const mail = await createMailMessage()
    const draft = await createRosterDraft({ mailId: mail.id })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const invalidPublishedAt = approvalForm({ editionId: edition.id, eventId: event.id })
    invalidPublishedAt.set('publishedAt', '2030-02-30')
    expect((await approveRosterImportDraft(draft.id, invalidPublishedAt)).ok).toBe(false)

    const invalidApplicationStart = approvalForm({ editionId: edition.id, eventId: event.id })
    invalidApplicationStart.set('gradeConfigs', JSON.stringify([{
      grade: 'A', selectionStatus: 'unknown', capacity: null,
      applicationStartDate: '2030-02-30', publishAsConfirmed: false,
    }]))
    expect((await approveRosterImportDraft(draft.id, invalidApplicationStart)).ok).toBe(false)
    expect(await testDb.select().from(tournamentEntryRosters)).toHaveLength(0)
  })

  it('A級抽選は主催者枠・抽選除外の分類確認なしに採用できない', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    const mail = await createMailMessage()
    const draft = await createRosterDraft({ mailId: mail.id })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const result = await approveRosterImportDraft(draft.id, approvalForm({
      editionId: edition.id,
      eventId: event.id,
      selectionStatus: 'lottery',
      capacity: 10,
      exemptionClassificationVerified: false,
    }))

    expect(result).toEqual({
      ok: false,
      error: 'A級抽選では主催者枠・抽選除外の分類確認が必要です',
    })
    expect(await testDb.select().from(tournamentEntryRosters)).toHaveLength(0)
  })

  it('同じdraftの二重承認を防ぐ', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    const mail = await createMailMessage()
    const draft = await createRosterDraft({ mailId: mail.id })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const form = approvalForm({ editionId: edition.id, eventId: event.id })

    expect((await approveRosterImportDraft(draft.id, form)).ok).toBe(true)
    expect((await approveRosterImportDraft(draft.id, form)).ok).toBe(false)
    expect(await testDb.select().from(tournamentEntryRosters)).toHaveLength(1)
  })

  it('correctionは旧roster/factを監査保持し、active factを新版へ切り替える', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const firstMail = await createMailMessage()
    const firstDraft = await createRosterDraft({ mailId: firstMail.id, count: 2 })
    const first = await approveRosterImportDraft(
      firstDraft.id,
      approvalForm({ editionId: edition.id, eventId: event.id, selectionStatus: 'under_capacity', capacity: 4 }),
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const correctionMail = await createMailMessage()
    const correctionDraft = await createRosterDraft({ mailId: correctionMail.id, count: 3 })
    const corrected = await approveRosterImportDraft(
      correctionDraft.id,
      approvalForm({
        editionId: edition.id,
        eventId: event.id,
        selectionStatus: 'under_capacity',
        capacity: 4,
        revisionKind: 'correction',
        correctionTargetRosterId: first.rosterId,
      }),
    )
    expect(corrected.ok).toBe(true)

    const oldRoster = await testDb.query.tournamentEntryRosters.findFirst({
      where: eq(tournamentEntryRosters.id, first.rosterId),
    })
    expect(oldRoster?.supersededAt).not.toBeNull()
    const facts = await testDb.select().from(tournamentEditionGradeLotteryFacts)
    expect(facts).toHaveLength(2)
    expect(facts.filter((fact) => fact.validTo === null)).toHaveLength(1)
    expect(facts.find((fact) => fact.validTo === null)?.supersedesFactId).not.toBeNull()
  })

  it('additional publicationは旧発表を残して確定名簿発表を追加する', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const firstMail = await createMailMessage()
    const firstDraft = await createRosterDraft({
      mailId: firstMail.id,
      outcome: 'accepted',
    })
    const first = await approveRosterImportDraft(
      firstDraft.id,
      approvalForm({
        editionId: edition.id,
        eventId: event.id,
        purpose: 'confirmed_publication',
      }),
    )
    expect(first.ok).toBe(true)

    const secondMail = await createMailMessage()
    const secondDraft = await createRosterDraft({
      mailId: secondMail.id,
      outcome: 'accepted',
    })
    const second = await approveRosterImportDraft(
      secondDraft.id,
      approvalForm({
        editionId: edition.id,
        eventId: event.id,
        purpose: 'confirmed_publication',
        revisionKind: 'additional',
      }),
    )
    expect(second.ok).toBe(true)

    expect(await testDb.select().from(tournamentConfirmedRosterPublications)).toHaveLength(2)
    const rosters = await testDb.select().from(tournamentEntryRosters)
    expect(rosters).toHaveLength(2)
    expect(rosters.every((roster) => roster.supersededAt === null)).toBe(true)
  })

  it('申込名簿の確定兼用を明示でき、訂正時は新版publicationを追加する', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const firstMail = await createMailMessage()
    const firstDraft = await createRosterDraft({ mailId: firstMail.id })
    const firstForm = approvalForm({ editionId: edition.id, eventId: event.id })
    firstForm.set('gradeConfigs', JSON.stringify([{
      grade: 'A', selectionStatus: 'unknown', capacity: null,
      applicationStartDate: '2030-04-01', publishAsConfirmed: true,
    }]))
    const first = await approveRosterImportDraft(firstDraft.id, firstForm)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const secondMail = await createMailMessage()
    const secondDraft = await createRosterDraft({ mailId: secondMail.id })
    const secondForm = approvalForm({
      editionId: edition.id,
      eventId: event.id,
      revisionKind: 'correction',
      correctionTargetRosterId: first.rosterId,
    })
    secondForm.set('gradeConfigs', JSON.stringify([{
      grade: 'A', selectionStatus: 'unknown', capacity: null,
      applicationStartDate: '2030-04-01', publishAsConfirmed: true,
    }]))
    expect((await approveRosterImportDraft(secondDraft.id, secondForm)).ok).toBe(true)

    const publications = await testDb.select().from(tournamentConfirmedRosterPublications)
    expect(publications).toHaveLength(2)
    expect(new Set(publications.map((publication) => publication.rosterId)).size).toBe(2)
  })

  it('複数grade payloadをgradeConfigsで一括採用し、全級のfactを作る', async () => {
    const admin = await createAdmin()
    const { edition, event } = await createEditionFixture()
    await testDb.update(events).set({ eligibleGrades: ['A', 'B'] }).where(eq(events.id, event.id))
    const mail = await createMailMessage()
    const [draft] = await testDb.insert(tournamentRosterImportDrafts).values({
      sourceKind: 'body',
      sourceMailMessageId: mail.id,
      parserVersion: 'test',
      extractedPayload: {
        parserVersion: 'test',
        sheetName: 'A級',
        sheetNames: ['A級', 'B級'],
        validationIssues: [],
        entries: [
          ...rosterPayload('A', 1).entries,
          ...rosterPayload('B', 1).entries.map((entry) => ({ ...entry, rawName: 'B級選手' })),
        ],
      },
    }).returning()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const form = approvalForm({ editionId: edition.id, eventId: event.id })
    form.set('gradeConfigs', JSON.stringify([
      { grade: 'A', selectionStatus: 'unknown', capacity: null, applicationStartDate: null, publishAsConfirmed: false },
      { grade: 'B', selectionStatus: 'unknown', capacity: null, applicationStartDate: null, publishAsConfirmed: false },
    ]))

    expect((await approveRosterImportDraft(draft!.id, form)).ok).toBe(true)
    const facts = await testDb.select().from(tournamentEditionGradeLotteryFacts)
    expect(facts.map((fact) => fact.grade).sort()).toEqual(['A', 'B'])
  })

  it('結果承認はedition/grade一意なら初回自動リンクし、既存リンクは明示時だけfact新版へ置換する', async () => {
    const admin = await createAdmin()
    const { edition } = await createEditionFixture()
    await setAuthSession({ id: admin.id, role: 'admin' })

    const firstMail = await createMailMessage()
    const firstDraft = await createResultDraft(firstMail.id)
    const firstForm = new FormData()
    firstForm.set('tournamentName', '第1回テスト大会')
    firstForm.set('editionId', String(edition.id))
    const first = await approveResultDraft(firstDraft.id, firstForm)
    expect(first.ok).toBe(true)

    const firstClass = await testDb.query.tournamentClasses.findFirst()
    let active = await testDb.query.tournamentEditionGradeLotteryFacts.findFirst({
      where: eq(tournamentEditionGradeLotteryFacts.editionId, edition.id),
    })
    expect(active?.actualResultClassId).toBe(firstClass?.id)

    const secondMail = await createMailMessage()
    const secondDraft = await createResultDraft(secondMail.id)
    const secondForm = new FormData()
    secondForm.set('tournamentName', '第1回テスト大会 訂正版')
    secondForm.set('editionId', String(edition.id))
    const second = await approveResultDraft(secondDraft.id, secondForm)
    expect(second.ok).toBe(true)
    active = await testDb.query.tournamentEditionGradeLotteryFacts.findFirst({
      where: eq(tournamentEditionGradeLotteryFacts.editionId, edition.id),
    })
    expect(active?.actualResultClassId).toBe(firstClass?.id)

    const secondClass = (await testDb
      .select()
      .from(tournamentClasses)
      .where(eq(tournamentClasses.tournamentId, second.ok ? second.tournamentId : -1)))[0]!
    const stale = await replaceActualResultFact(
      secondDraft.id,
      'A',
      active!.id + 1,
    )
    expect(stale).toMatchObject({ ok: false })
    expect((await testDb.query.tournamentEditionGradeLotteryFacts.findFirst({
      where: and(
        eq(tournamentEditionGradeLotteryFacts.editionId, edition.id),
        isNull(tournamentEditionGradeLotteryFacts.validTo),
      ),
    }))?.actualResultClassId).toBe(firstClass?.id)

    const replaced = await replaceActualResultFact(
      secondDraft.id,
      'A',
      active!.id,
    )
    expect(replaced.ok).toBe(true)

    const facts = await testDb.select().from(tournamentEditionGradeLotteryFacts)
    expect(facts).toHaveLength(2)
    expect(facts.find((fact) => fact.validTo === null)?.actualResultClassId).toBe(secondClass.id)
  })
})
