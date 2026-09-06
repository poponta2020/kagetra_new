import { describe, it, expect } from 'vitest'
import {
  affiliationLine,
  buildRemarks,
  computePeriod,
  duplicatedSurnameUserIds,
  reiwaYear,
  rosterFullName,
  sortRosterMembers,
  surnameOf,
  toEraDate,
  type TravelReportMember,
  type TravelReportRoute,
} from './render'

const member = (o: Partial<TravelReportMember> & { userId: string }): TravelReportMember => ({
  displayName: o.displayName ?? `${o.familyName ?? ''} ${o.givenName ?? ''}`.trim(),
  familyName: null,
  givenName: null,
  familyKana: null,
  givenKana: null,
  faculty: null,
  schoolYear: null,
  phone: null,
  ...o,
})

describe('氏名（R10）', () => {
  it('名簿の氏名は姓と名をスペース無しで連結する', () => {
    expect(
      rosterFullName(member({ userId: 'u1', familyName: '北海', givenName: '太郎' })),
    ).toBe('北海太郎')
  })

  it('分割氏名が無い会員は表示名から空白を除く（全角空白も）', () => {
    expect(rosterFullName(member({ userId: 'u2', displayName: '旭川　さくら' }))).toBe('旭川さくら')
    expect(rosterFullName(member({ userId: 'u3', displayName: '室蘭 凛' }))).toBe('室蘭凛')
  })

  it('備考の姓は familyName、無ければ表示名の先頭トークン', () => {
    expect(surnameOf(member({ userId: 'u1', familyName: '北海', givenName: '太郎' }))).toBe('北海')
    expect(surnameOf(member({ userId: 'u2', displayName: '旭川　さくら' }))).toBe('旭川')
    expect(surnameOf(member({ userId: 'u3', displayName: '釧路颯' }))).toBe('釧路颯')
  })
})

describe('名簿の並び（R10・AC-22）', () => {
  it('学年の高い順 → 同学年はかな順 → かな無しは末尾で氏名順', () => {
    const members = [
      member({ userId: 'a', familyName: '藤野', givenName: '美咲', familyKana: 'ふじの', givenKana: 'みさき', schoolYear: '2年' }),
      member({ userId: 'b', familyName: '北海', givenName: '太郎', familyKana: 'ほっかい', givenKana: 'たろう', schoolYear: '博士4年' }),
      member({ userId: 'c', familyName: '室蘭', givenName: '凛', familyKana: 'むろらん', givenKana: 'りん', schoolYear: '修士1年' }),
      member({ userId: 'd', familyName: '青森', givenName: '花', familyKana: 'あおもり', givenKana: 'はな', schoolYear: '2年' }),
      // かな無しのゲスト（同学年でも末尾）。
      member({ userId: 'e', displayName: '釧路颯', schoolYear: '2年' }),
    ]
    expect(sortRosterMembers(members).map((m) => m.userId)).toEqual(['b', 'c', 'd', 'a', 'e'])
  })

  it('専門職は修士の後・学部の前（SCHOOL_YEAR_ORDER に従う）', () => {
    const members = [
      member({ userId: 'u1', displayName: 'い', schoolYear: '6年' }),
      member({ userId: 'u2', displayName: 'ろ', schoolYear: '専門職1年' }),
      member({ userId: 'u3', displayName: 'は', schoolYear: '修士1年' }),
    ]
    expect(sortRosterMembers(members).map((m) => m.schoolYear)).toEqual(['修士1年', '専門職1年', '6年'])
  })

  it('学年が未設定の人は末尾へ送られる', () => {
    const members = [
      member({ userId: 'u1', displayName: 'あ' }),
      member({ userId: 'u2', displayName: 'い', schoolYear: '1年' }),
    ]
    expect(sortRosterMembers(members).map((m) => m.userId)).toEqual(['u2', 'u1'])
  })
})

describe('期間・令和（R10・AC-24）', () => {
  it('令和は西暦 − 2018', () => {
    expect(reiwaYear('2019-05-01')).toBe(1)
    expect(reiwaYear('2026-06-13')).toBe(8)
    expect(toEraDate('2026-11-09')).toEqual({ reiwa: 8, month: 11, day: 9 })
  })

  it('自至は移動行と出場日の両方から取り、暦日数を数える', () => {
    const routes: TravelReportRoute[] = [
      {
        userId: 'u1',
        departureKind: 'sapporo',
        legs: [
          { date: '2026-11-06', from: '札幌', to: '八戸' },
          { date: '2026-11-09', from: '八戸', to: '札幌' },
        ],
        attendanceDates: ['2026-11-07', '2026-11-08'],
      },
      {
        // 出場日しか無い人（未入力）も期間に算入される。
        userId: 'u2',
        departureKind: 'hometown',
        legs: [],
        attendanceDates: ['2026-11-08'],
      },
    ]
    expect(computePeriod(routes)).toEqual({ from: '2026-11-06', to: '2026-11-09', days: 4 })
  })

  it('行が1つも無ければ null', () => {
    expect(computePeriod([])).toBeNull()
    expect(computePeriod([{ userId: 'u1', departureKind: 'sapporo', legs: [], attendanceDates: [] }])).toBeNull()
  })
})

describe('備考の集約（R10・AC-23）', () => {
  const members = sortRosterMembers([
    member({ userId: 'u1', familyName: '北海', givenName: '太郎', familyKana: 'ほっかい', givenKana: 'たろう', schoolYear: '4年' }),
    member({ userId: 'u2', familyName: '藤野', givenName: '美咲', familyKana: 'ふじの', givenKana: 'みさき', schoolYear: '3年' }),
    member({ userId: 'u3', familyName: '室蘭', givenName: '凛', familyKana: 'むろらん', givenKana: 'りん', schoolYear: '2年' }),
  ])

  it('日付順に1日1行、同一内容の人を [姓、姓] でまとめる', () => {
    const routes: TravelReportRoute[] = ['u1', 'u2', 'u3'].map((userId) => ({
      userId,
      departureKind: 'sapporo',
      legs: [
        { date: '2026-11-06', from: '札幌', to: '八戸' },
        { date: '2026-11-09', from: '八戸', to: '札幌' },
      ],
      attendanceDates: ['2026-11-07'],
    }))
    const remarks = buildRemarks({ members, routes, destinationLabel: '八戸' })
    expect(remarks.map((r) => r.text)).toEqual([
      '11/6 [北海、藤野、室蘭]札幌→八戸',
      '11/7 [北海、藤野、室蘭]大会出場',
      '11/9 [北海、藤野、室蘭]八戸→札幌',
    ])
  })

  it('姓は名簿順に並ぶ（入力順ではない）', () => {
    const routes: TravelReportRoute[] = ['u3', 'u1', 'u2'].map((userId) => ({
      userId,
      departureKind: 'sapporo',
      legs: [{ date: '2026-11-06', from: '札幌', to: '八戸' }],
      attendanceDates: [],
    }))
    // 名簿順は 4年(北海) → 3年(藤野) → 2年(室蘭)。
    expect(buildRemarks({ members, routes, destinationLabel: '八戸' })[0].text).toBe(
      '11/6 [北海、藤野、室蘭]札幌→八戸',
    )
  })

  it('同一日内は 開催地へ向かう移動 → 大会出場 → 開催地から離れる移動 → その他の移動', () => {
    const routes: TravelReportRoute[] = [
      {
        userId: 'u1',
        departureKind: 'sapporo',
        legs: [
          { date: '2026-11-07', from: '青森', to: '弘前' }, // その他
          { date: '2026-11-07', from: '八戸', to: '青森' }, // 離れる
          { date: '2026-11-07', from: '札幌', to: '八戸' }, // 向かう
        ],
        attendanceDates: ['2026-11-07'],
      },
    ]
    expect(buildRemarks({ members, routes, destinationLabel: '八戸' })[0].text).toBe(
      '11/7 [北海]札幌→八戸 [北海]大会出場 [北海]八戸→青森 [北海]青森→弘前',
    )
  })

  it('同姓が複数いる人だけフルネームになる', () => {
    const dupMembers = sortRosterMembers([
      member({ userId: 'a', familyName: '北海', givenName: '太郎', familyKana: 'ほっかい', givenKana: 'たろう', schoolYear: '4年' }),
      member({ userId: 'b', familyName: '北海', givenName: '花子', familyKana: 'ほっかい', givenKana: 'はなこ', schoolYear: '3年' }),
      member({ userId: 'c', familyName: '藤野', givenName: '美咲', familyKana: 'ふじの', givenKana: 'みさき', schoolYear: '2年' }),
    ])
    expect(duplicatedSurnameUserIds(dupMembers)).toEqual(new Set(['a', 'b']))
    const routes: TravelReportRoute[] = ['a', 'b', 'c'].map((userId) => ({
      userId,
      departureKind: 'sapporo',
      legs: [{ date: '2026-11-06', from: '札幌', to: '八戸' }],
      attendanceDates: [],
    }))
    expect(buildRemarks({ members: dupMembers, routes, destinationLabel: '八戸' })[0].text).toBe(
      '11/6 [北海太郎、北海花子、藤野]札幌→八戸',
    )
  })

  it('帰省先から出場 の人は出場表記が分かれる', () => {
    const routes: TravelReportRoute[] = [
      { userId: 'u1', departureKind: 'sapporo', legs: [], attendanceDates: ['2026-11-07'] },
      { userId: 'u2', departureKind: 'hometown', legs: [], attendanceDates: ['2026-11-07'] },
    ]
    expect(buildRemarks({ members, routes, destinationLabel: '八戸' })[0].text).toBe(
      '11/7 [北海]大会出場 [藤野]大会出場（帰省先から出場）',
    )
  })

  it('名簿に載っていない人の行は載せない', () => {
    const routes: TravelReportRoute[] = [
      { userId: 'unknown', departureKind: 'sapporo', legs: [{ date: '2026-11-06', from: '札幌', to: '八戸' }], attendanceDates: [] },
    ]
    expect(buildRemarks({ members, routes, destinationLabel: '八戸' })).toEqual([])
  })

  it('開催地が未設定でも落ちず、移動はすべて「その他」の順になる', () => {
    const routes: TravelReportRoute[] = [
      {
        userId: 'u1',
        departureKind: 'sapporo',
        legs: [{ date: '2026-11-06', from: '札幌', to: '八戸' }],
        attendanceDates: ['2026-11-06'],
      },
    ]
    // 大会出場（order 1）が移動（order 3）より先に来る。
    expect(buildRemarks({ members, routes, destinationLabel: null })[0].text).toBe(
      '11/6 [北海]大会出場 [北海]札幌→八戸',
    )
  })
})

describe('団体代表者の所属欄', () => {
  it('学部等名と学年をスペースでつなぐ', () => {
    expect(affiliationLine({ faculty: '法学部', schoolYear: '2年' })).toBe('法学部 2年')
  })

  it('片方または両方が未設定でも落ちない', () => {
    expect(affiliationLine({ faculty: '法学部', schoolYear: null })).toBe('法学部')
    expect(affiliationLine({ faculty: null, schoolYear: null })).toBe('')
  })
})
