import { describe, it, expect } from 'vitest'
import { pickDestinationContacts, pickHomeContact, type ContactCandidate } from './contacts'
import { formatDateRun, sanitizeFilenamePart, travelReportFilename } from './filename'

const c = (o: Partial<ContactCandidate> & { userId: string }): ContactCandidate => ({
  name: o.name ?? o.userId,
  phone: null,
  role: 'member',
  isCircleLeader: false,
  isTravelReportSubmitter: false,
  isTreasurer: false,
  birthDate: null,
  ...o,
})

describe('遠征先 連絡者の既定（R9・AC-25）', () => {
  it('役職の優先順は サークル長 → 管理者 → 副管理者 → 副連絡責任者 → 会計', () => {
    const all = [
      c({ userId: 'treasurer', isTreasurer: true }),
      c({ userId: 'submitter', isTravelReportSubmitter: true }),
      c({ userId: 'vice', role: 'vice_admin' }),
      c({ userId: 'admin', role: 'admin' }),
      c({ userId: 'leader', isCircleLeader: true }),
    ]
    expect(pickDestinationContacts(all).map((x) => x.userId)).toEqual(['leader'])
    expect(pickDestinationContacts(all.slice(0, 4)).map((x) => x.userId)).toEqual(['admin'])
    expect(pickDestinationContacts(all.slice(0, 3)).map((x) => x.userId)).toEqual(['vice'])
    expect(pickDestinationContacts(all.slice(0, 2)).map((x) => x.userId)).toEqual(['submitter'])
    expect(pickDestinationContacts(all.slice(0, 1)).map((x) => x.userId)).toEqual(['treasurer'])
  })

  it('役職持ちが誰もいなければ生年月日が最も早い人', () => {
    const all = [
      c({ userId: 'a', birthDate: '2005-04-01' }),
      c({ userId: 'b', birthDate: '2003-12-31' }),
      c({ userId: 'd', birthDate: null }),
    ]
    expect(pickDestinationContacts(all).map((x) => x.userId)).toEqual(['b'])
  })

  it('生年月日が同じなら全員出す（2人までを想定）', () => {
    const all = [
      c({ userId: 'b', birthDate: '2003-12-31' }),
      c({ userId: 'a', birthDate: '2003-12-31' }),
      c({ userId: 'z', birthDate: '2005-01-01' }),
    ]
    expect(pickDestinationContacts(all).map((x) => x.userId)).toEqual(['a', 'b'])
  })

  it('生年月日が誰にも無ければ userId 順の先頭1人', () => {
    expect(pickDestinationContacts([c({ userId: 'b' }), c({ userId: 'a' })]).map((x) => x.userId)).toEqual(['a'])
  })

  it('サークル長は役職の中で最優先（管理者でもある人がいても）', () => {
    const all = [c({ userId: 'admin', role: 'admin' }), c({ userId: 'leader', isCircleLeader: true })]
    expect(pickDestinationContacts(all).map((x) => x.userId)).toEqual(['leader'])
  })

  it('出場者が0人なら空', () => {
    expect(pickDestinationContacts([])).toEqual([])
  })
})

describe('留守連絡先の既定（R9・AC-25）', () => {
  const leader = c({ userId: 'leader', isCircleLeader: true })
  const sub1 = c({ userId: 's1', isTravelReportSubmitter: true })
  const sub2 = c({ userId: 's2', isTravelReportSubmitter: true })

  it('サークル長が出場しないならサークル長', () => {
    const r = pickHomeContact({
      circleLeader: leader,
      participantIds: new Set(['x']),
      submitters: [sub1],
    })
    expect(r?.userId).toBe('leader')
  })

  it('サークル長が出場者に含まれるなら、出場しない副連絡責任者（userId 順の先頭）', () => {
    const r = pickHomeContact({
      circleLeader: leader,
      participantIds: new Set(['leader', 's1']),
      submitters: [sub2, sub1],
    })
    expect(r?.userId).toBe('s2')
  })

  it('副連絡責任者も全員出場していれば空欄', () => {
    const r = pickHomeContact({
      circleLeader: leader,
      participantIds: new Set(['leader', 's1', 's2']),
      submitters: [sub1, sub2],
    })
    expect(r).toBeNull()
  })

  it('サークル長が未設定なら空欄（作成は成功する。R13）', () => {
    expect(
      pickHomeContact({ circleLeader: null, participantIds: new Set(), submitters: [sub1] }),
    ).toBeNull()
  })
})

describe('ファイル名（R9）', () => {
  it('記入例の形になる', () => {
    expect(
      travelReportFilename({ dates: ['2026-06-13', '2026-06-14'], tournamentName: '青森大会' }),
    ).toBe('2026.6.13,14 青森大会 遠征届.docx')
  })

  it('月が変わるところでは月から書く', () => {
    expect(formatDateRun(['2026-06-30', '2026-07-01'])).toBe('2026.6.30,7.1')
    expect(formatDateRun(['2026-11-06'])).toBe('2026.11.6')
    expect(formatDateRun([])).toBe('')
  })

  it('日付は昇順・重複なしに整う', () => {
    expect(formatDateRun(['2026-06-14', '2026-06-13', '2026-06-14'])).toBe('2026.6.13,14')
  })

  it('大会名が空でも落ちない', () => {
    expect(travelReportFilename({ dates: ['2026-06-13'], tournamentName: '  ' })).toBe(
      '2026.6.13 遠征届.docx',
    )
  })

  it('ファイル名に使えない文字を全角へ寄せる', () => {
    expect(sanitizeFilenamePart('A/B:C*D?E"F<G>H|I\\J')).toBe('A／B：C＊D？E”F＜G＞H｜I＼J')
    expect(sanitizeFilenamePart('  ..前後..  ')).toBe('前後')
    // 改行は制御文字として落とされる（空白へは寄せない）。
    expect(sanitizeFilenamePart('改\n行')).toBe('改行')
    expect(sanitizeFilenamePart('全角　空白')).toBe('全角 空白')
  })
})
