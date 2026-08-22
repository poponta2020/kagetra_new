import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroups,
  mailAttachments,
  tournamentEntryRosterFiles,
  tournamentEntryRosters,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createMailMessage } from '@/test-utils/seed'
import {
  isConfirmedRosterSettled,
  loadConfirmedRosterState,
  loadConfirmedRosterStates,
  type ConfirmedRosterSignals,
} from './confirmed-roster'

/**
 * confirmed-roster-signal タスク1: 「確定名簿あり」判定の正典。
 *
 * 純関数（4材料の OR）と、グループ単位で材料を集めるローダーの両方をここで固定する。
 * `classify` / `buildEntryFlow` への結線（AC-2 / AC-9 / AC-10 / AC-18）は各画面の
 * テスト、出場者解決を広げない回帰（AC-14）は `lib/upcoming-entrants.test.ts` が持つ。
 */

const NONE: ConfirmedRosterSignals = {
  hasParsedRoster: false,
  hasAdoptedFile: false,
  hasConfirmedRosterMail: false,
  override: false,
}

/** 採用済み原本ファイルを1件積む（ファイル実体は mail_attachments が正）。 */
async function seedRosterFile(entryGroupId: number, rosterType: 'applicant' | 'confirmed') {
  const mail = await createMailMessage({ subject: '名簿添付' })
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mail.id,
      filename: '名簿.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 3,
      data: Buffer.from('xls'),
    })
    .returning()
  await testDb.insert(tournamentEntryRosterFiles).values({
    entryGroupId,
    rosterType,
    sourceAttachmentId: attachment!.id,
    sourceMailMessageId: mail.id,
  })
}

/** 確定名簿メール（処理済み）を1件、指定イベントに紐付ける。 */
async function seedConfirmedRosterMail(
  linkedEventId: number,
  overrides: {
    mailKind?: 'confirmed_roster' | 'applicant_roster' | 'tournament_notice' | null
    triageStatus?: 'unprocessed' | 'processed'
  } = {},
) {
  return createMailMessage({
    subject: '第三回全国競技かるた杉並大会(AB級)確定連絡',
    linkedEventId,
    mailKind: overrides.mailKind === undefined ? 'confirmed_roster' : overrides.mailKind,
    triageStatus: overrides.triageStatus ?? 'processed',
  })
}

/** グループの手動フラグを直接書き換える（Server Action はタスク2）。 */
async function setOverride(entryGroupId: number, value: boolean) {
  await testDb
    .update(entryGroups)
    .set({ confirmedRosterOverride: value })
    .where(eq(entryGroups.id, entryGroupId))
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('isConfirmedRosterSettled（純関数・4材料の OR）', () => {
  it('材料が1つも無ければ false', () => {
    expect(isConfirmedRosterSettled(NONE)).toBe(false)
  })

  it.each([
    ['hasParsedRoster', 'パース済み確定名簿'],
    ['hasAdoptedFile', '採用済み原本ファイル'],
    ['hasConfirmedRosterMail', '確定名簿メール'],
    ['override', '手動フラグ'],
  ] as const)('%s だけでも成立する（%s）', (key) => {
    expect(isConfirmedRosterSettled({ ...NONE, [key]: true })).toBe(true)
  })

  it('AC-7: 手動フラグが false なら他の材料が無い限り false', () => {
    expect(isConfirmedRosterSettled({ ...NONE, override: false })).toBe(false)
  })

  it('複数材料が同時に立っても true（OR なので相殺しない）', () => {
    expect(
      isConfirmedRosterSettled({
        hasParsedRoster: true,
        hasAdoptedFile: true,
        hasConfirmedRosterMail: true,
        override: true,
      }),
    ).toBe(true)
  })
})

describe('loadConfirmedRosterStates（グループ単位のローダー）', () => {
  it('groupIds が空なら空の Map（inArray に空配列を渡さない）', async () => {
    expect((await loadConfirmedRosterStates([])).size).toBe(0)
  })

  it('材料が無いグループも Map に必ず入る（settled=false / override=false）', async () => {
    const group = await createEntryGroup()
    const states = await loadConfirmedRosterStates([group.id])
    expect(states.get(group.id)).toEqual({ settled: false, override: false })
  })

  it('AC-1: 確定名簿メールが紐づくグループは名簿0件でも settled=true', async () => {
    const ev = await createEvent({ title: '杉並B' })
    await seedConfirmedRosterMail(ev.id)

    const state = await loadConfirmedRosterState(ev.entryGroupId)
    expect(state.settled).toBe(true)
    // メール由来なので手動フラグは立っていない（トグルの現在値は OFF のまま）。
    expect(state.override).toBe(false)
  })

  it('AC-3: 添付があり未採用でもシグナルは成立する（採用の有無を問わない）', async () => {
    const ev = await createEvent({ title: '添付あり未採用' })
    const mail = await seedConfirmedRosterMail(ev.id)
    // 添付は入っているが tournament_entry_roster_files には採用していない。
    await testDb.insert(mailAttachments).values({
      mailMessageId: mail.id,
      filename: '確定名簿.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 3,
      data: Buffer.from('xls'),
    })

    expect((await loadConfirmedRosterState(ev.entryGroupId)).settled).toBe(true)
  })

  it('AC-4: mail_kind が null（未処理へ戻した後）はシグナルにならない', async () => {
    const ev = await createEvent({ title: '未処理へ戻した' })
    await seedConfirmedRosterMail(ev.id, { mailKind: null })

    expect((await loadConfirmedRosterState(ev.entryGroupId)).settled).toBe(false)
  })

  it.each(['applicant_roster', 'tournament_notice'] as const)(
    'AC-5: mail_kind=%s はシグナルにならない',
    async (mailKind) => {
      const ev = await createEvent({ title: `他種別: ${mailKind}` })
      await seedConfirmedRosterMail(ev.id, { mailKind })

      expect((await loadConfirmedRosterState(ev.entryGroupId)).settled).toBe(false)
    },
  )

  it('triage_status=unprocessed はシグナルにならない（§3.2.1 の連言）', async () => {
    const ev = await createEvent({ title: '未処理のまま' })
    await seedConfirmedRosterMail(ev.id, { triageStatus: 'unprocessed' })

    expect((await loadConfirmedRosterState(ev.entryGroupId)).settled).toBe(false)
  })

  it('別グループのイベントに紐づく確定名簿メールは影響しない', async () => {
    const other = await createEvent({ title: 'よその大会' })
    await seedConfirmedRosterMail(other.id)
    const target = await createEntryGroup()

    const states = await loadConfirmedRosterStates([target.id, other.entryGroupId])
    expect(states.get(target.id)?.settled).toBe(false)
    expect(states.get(other.entryGroupId)?.settled).toBe(true)
  })

  it('どのイベントにも紐付いていない（linked_event_id=NULL）確定名簿メールは影響しない', async () => {
    const group = await createEntryGroup()
    await createMailMessage({ mailKind: 'confirmed_roster', triageStatus: 'processed' })

    expect((await loadConfirmedRosterState(group.id)).settled).toBe(false)
  })

  it('AC-6/AC-7: override の ON/OFF がそのまま settled と override に出る', async () => {
    const group = await createEntryGroup()

    await setOverride(group.id, true)
    expect(await loadConfirmedRosterState(group.id)).toEqual({
      settled: true,
      override: true,
    })

    await setOverride(group.id, false)
    expect(await loadConfirmedRosterState(group.id)).toEqual({
      settled: false,
      override: false,
    })
  })

  it('AC-8: 判定はグループ単位（同じグループの2日は必ず同じ値）', async () => {
    const group = await createEntryGroup()
    const day1 = await createEvent({
      title: '杉並B 9/5',
      eventDate: '2030-09-05',
      entryGroupId: group.id,
    })
    await createEvent({
      title: '杉並A 9/6',
      eventDate: '2030-09-06',
      entryGroupId: group.id,
    })
    // メールは 9/5 の日にしか紐付いていないが、判定はグループ単位なので両日で同じ。
    await seedConfirmedRosterMail(day1.id)

    const states = await loadConfirmedRosterStates([group.id, group.id])
    expect(states.size).toBe(1)
    expect(states.get(group.id)?.settled).toBe(true)
  })

  it('AC-15 回帰: パース済み確定名簿があるグループの判定は変わらない', async () => {
    const group = await createEntryGroup()
    await testDb
      .insert(tournamentEntryRosters)
      .values({ entryGroupId: group.id, rosterType: 'confirmed' })

    expect((await loadConfirmedRosterState(group.id)).settled).toBe(true)
  })

  it('AC-15 回帰: 採用済み原本ファイルがあるグループの判定は変わらない', async () => {
    const group = await createEntryGroup()
    await seedRosterFile(group.id, 'confirmed')

    expect((await loadConfirmedRosterState(group.id)).settled).toBe(true)
  })

  it('回帰: applicant のみ / 差し替え済み確定名簿のみ は従来どおり false', async () => {
    const applicantOnly = await createEntryGroup()
    await testDb
      .insert(tournamentEntryRosters)
      .values({ entryGroupId: applicantOnly.id, rosterType: 'applicant' })
    await seedRosterFile(applicantOnly.id, 'applicant')

    const supersededOnly = await createEntryGroup()
    await testDb.insert(tournamentEntryRosters).values({
      entryGroupId: supersededOnly.id,
      rosterType: 'confirmed',
      supersededAt: new Date(),
    })

    const states = await loadConfirmedRosterStates([applicantOnly.id, supersededOnly.id])
    expect(states.get(applicantOnly.id)?.settled).toBe(false)
    expect(states.get(supersededOnly.id)?.settled).toBe(false)
  })

  it('複数グループをまとめて引いても材料が混線しない', async () => {
    const mailEvent = await createEvent({ title: 'メールのみ' })
    await seedConfirmedRosterMail(mailEvent.id)
    const rosterGroup = await createEntryGroup()
    await testDb
      .insert(tournamentEntryRosters)
      .values({ entryGroupId: rosterGroup.id, rosterType: 'confirmed' })
    const emptyGroup = await createEntryGroup()

    const states = await loadConfirmedRosterStates([
      mailEvent.entryGroupId,
      rosterGroup.id,
      emptyGroup.id,
    ])
    expect(states.get(mailEvent.entryGroupId)?.settled).toBe(true)
    expect(states.get(rosterGroup.id)?.settled).toBe(true)
    expect(states.get(emptyGroup.id)?.settled).toBe(false)
  })
})
