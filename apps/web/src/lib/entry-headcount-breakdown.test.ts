import { describe, expect, it } from 'vitest'
import type { GroupHeadcountFacts, HeadcountRoleHolder } from './entry-headcount'
import { buildHeadcountBreakdown } from './entry-headcount-breakdown'
import { buildMentionMessage } from './line-mention'

function holder(userId: string, displayName: string): HeadcountRoleHolder {
  return { userId, displayName }
}

function makeFacts(overrides: Partial<GroupHeadcountFacts> = {}): GroupHeadcountFacts {
  return {
    entrantUserIds: new Set<string>(),
    hasGuestEntrant: false,
    hasCircleMemberEntrant: false,
    admins: [],
    treasurers: [],
    travelReportSubmitters: [],
    ...overrides,
  }
}

/** 実際に送られる本文（`buildMentionMessage` を通したもの）。 */
function render(facts: GroupHeadcountFacts): string {
  const { template, values } = buildHeadcountBreakdown(facts)
  const message = buildMentionMessage({
    mention: { kind: 'users', userIds: [] },
    label: '@管理者',
    template,
    values,
  })
  return message.text
}

/** `管理者：0名（未設定）` のような1行を取り出す。 */
function row(facts: GroupHeadcountFacts, label: string): string {
  const line = render(facts)
    .split('\n')
    .find((l) => l.startsWith(`${label}：`))
  if (line === undefined) throw new Error(`行が見つかりません: ${label}`)
  return line
}

/**
 * ★AC-H2 の独立計算。**返り値の行を足さない** — facts から
 * 「グループにいるはずの人」の集合を作り直してその要素数を数える。
 * こうしないと「合計＝行の和」が恒真になり、排他のバグを何も検出しない。
 */
function expectedTotal(facts: GroupHeadcountFacts): number {
  const inGroup = new Set<string>(facts.entrantUserIds)
  for (const h of facts.treasurers) inGroup.add(h.userId)
  // 副連絡責任者は遠征届が要るときだけグループに入る（§3.1.3b）。
  if (facts.hasCircleMemberEntrant || facts.hasGuestEntrant) {
    for (const h of facts.travelReportSubmitters) inGroup.add(h.userId)
  }
  for (const h of facts.admins) inGroup.add(h.userId)
  return inGroup.size + 1 // Bot
}

function expectTotalMatchesHeadcount(facts: GroupHeadcountFacts): void {
  expect(render(facts).split('\n')[1]).toBe(
    `グループの人数が${expectedTotal(facts)}名であることを確認してください。`,
  )
}

describe('buildHeadcountBreakdown', () => {
  it('合計1行＋空行＋内訳＋5行の形で組み立てる（AC-H1）', () => {
    const facts = makeFacts({
      entrantUserIds: new Set(['e1', 'e2']),
      admins: [holder('a1', '酒井')],
      treasurers: [holder('t1', '飯塚')],
      travelReportSubmitters: [holder('s1', '土居')],
      hasCircleMemberEntrant: true,
    })

    // 1行目はメンション行（userIds 空なので素テキストの `@管理者`）。
    expect(render(facts).split('\n')).toEqual([
      '@管理者',
      'グループの人数が6名であることを確認してください。',
      '',
      '内訳',
      '大会参加者：2名',
      '管理者：1名（酒井）',
      '会計：1名（飯塚）',
      '副連絡責任者：1名（土居）',
      'Bot：1名',
    ])
  })

  it('「内他会」をどのケースでも併記しない（AC-H4）', () => {
    const withGuest = makeFacts({
      entrantUserIds: new Set(['e1']),
      hasGuestEntrant: true,
      travelReportSubmitters: [holder('s1', '土居')],
    })
    expect(render(withGuest)).not.toContain('内他会')
    expect(render(makeFacts())).not.toContain('内他会')
  })

  it('該当者が0人の役割行は 0名（未設定）（AC-H9）', () => {
    const facts = makeFacts({ entrantUserIds: new Set(['e1']), hasCircleMemberEntrant: true })
    expect(row(facts, '管理者')).toBe('管理者：0名（未設定）')
    expect(row(facts, '会計')).toBe('会計：0名（未設定）')
    expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：0名（未設定）')
  })

  it('複数該当は users.id 昇順の中黒区切りで全員並ぶ（AC-H7, AC-H8）', () => {
    const facts = makeFacts({ admins: [holder('a1', '酒井'), holder('a2', '飯塚')] })
    expect(row(facts, '管理者')).toBe('管理者：2名（酒井・飯塚）')
  })

  describe('排他（1人1バケット）', () => {
    it('大会参加者を兼ねる役割者はその行から外れ、注記が付く（AC-H10）', () => {
      const facts = makeFacts({
        entrantUserIds: new Set(['u1']),
        admins: [holder('u1', '酒井')],
      })
      expect(row(facts, '管理者')).toBe('管理者：0名（大会参加のため）')
      expectTotalMatchesHeadcount(facts)
    })

    it('会計を兼ねる管理者は会計の行へ寄る（AC-H11）', () => {
      const facts = makeFacts({
        admins: [holder('u1', '酒井')],
        treasurers: [holder('u1', '酒井')],
      })
      expect(row(facts, '会計')).toBe('会計：1名（酒井）')
      expect(row(facts, '管理者')).toBe('管理者：0名（会計として計上のため）')
      expectTotalMatchesHeadcount(facts)
    })

    it('副連絡責任者を兼ねる会計は会計の行へ寄る（AC-H11）', () => {
      const facts = makeFacts({
        hasCircleMemberEntrant: true,
        entrantUserIds: new Set(['e1']),
        treasurers: [holder('u1', '飯塚')],
        travelReportSubmitters: [holder('u1', '飯塚')],
      })
      expect(row(facts, '会計')).toBe('会計：1名（飯塚）')
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：0名（会計として計上のため）')
      expectTotalMatchesHeadcount(facts)
    })

    it('副連絡責任者を兼ねる管理者は副連絡責任者の行へ寄る（AC-H11）', () => {
      const facts = makeFacts({
        hasCircleMemberEntrant: true,
        entrantUserIds: new Set(['e1']),
        admins: [holder('u1', '土居')],
        travelReportSubmitters: [holder('u1', '土居')],
      })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：1名（土居）')
      expect(row(facts, '管理者')).toBe('管理者：0名（副連絡責任者として計上のため）')
      expectTotalMatchesHeadcount(facts)
    })

    it('複数該当の一部だけが外れたら、残った人数と名字をそのまま出す', () => {
      const facts = makeFacts({
        entrantUserIds: new Set(['a1']),
        admins: [holder('a1', '酒井'), holder('a2', '飯塚')],
      })
      expect(row(facts, '管理者')).toBe('管理者：1名（飯塚）')
      expectTotalMatchesHeadcount(facts)
    })
  })

  describe('副連絡責任者の特則（§3.1.3b）', () => {
    it('該当者が全員大会参加者なら 0名（大会参加のため）— 遠征届の要否より先に見る', () => {
      const facts = makeFacts({
        entrantUserIds: new Set(['u1']),
        hasCircleMemberEntrant: true,
        travelReportSubmitters: [holder('u1', '土居')],
      })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：0名（大会参加のため）')
    })

    it('遠征届不要なら 0名（遠征届不要のため）（AC-H12）', () => {
      const facts = makeFacts({
        entrantUserIds: new Set(['e1']),
        travelReportSubmitters: [holder('s1', '土居')],
      })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：0名（遠征届不要のため）')
    })

    it('遠征届不要なら該当者0人でも「未設定」と言わない', () => {
      const facts = makeFacts({ entrantUserIds: new Set(['e1']) })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：0名（遠征届不要のため）')
    })

    it('遠征届が要るのに該当者0人なら 0名（未設定）で設定漏れに気づける', () => {
      const facts = makeFacts({ entrantUserIds: new Set(['e1']), hasCircleMemberEntrant: true })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：0名（未設定）')
    })

    it('ゲスト参加者がいれば遠征届必要と判定し、注記を添える（AC-H13）', () => {
      const facts = makeFacts({
        entrantUserIds: new Set(['e1']),
        hasGuestEntrant: true,
        travelReportSubmitters: [holder('s1', '飯塚')],
      })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：1名（飯塚・他会参加者ありのため）')
    })

    it('サークル所属の参加会員がいてゲストがいなければ 1名（名字）（AC-H14）', () => {
      const facts = makeFacts({
        entrantUserIds: new Set(['e1']),
        hasCircleMemberEntrant: true,
        travelReportSubmitters: [holder('s1', '飯塚')],
      })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：1名（飯塚）')
    })

    it('複数該当かつゲストありなら、全員の名字のあとに注記を付ける', () => {
      const facts = makeFacts({
        hasGuestEntrant: true,
        travelReportSubmitters: [holder('s1', '飯塚'), holder('s2', '酒井')],
      })
      expect(row(facts, '副連絡責任者')).toBe(
        '副連絡責任者：2名（飯塚・酒井・他会参加者ありのため）',
      )
    })

    it('遠征届の要否はサークル所属とゲストだけで決まる（確定状況を参照しない・AC-H15）', () => {
      // travel-report R5 の「確定」は紐付け時点では存在しない。入力に無いことを
      // 「サークル所属 ON の参加者がいる」だけで必要と判定できることで示す。
      const facts = makeFacts({
        entrantUserIds: new Set(['e1']),
        hasCircleMemberEntrant: true,
        travelReportSubmitters: [holder('s1', '土居')],
      })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：1名（土居）')
    })

    it('★遠征届不要のとき、副連絡責任者を兼ねる管理者は管理者の行へ落ちる（AC-H2）', () => {
      // ここを取りこぼすと、その人がどの行にも計上されず合計が実人数より少なくなる。
      const facts = makeFacts({
        entrantUserIds: new Set(['e1']),
        admins: [holder('u1', '土居')],
        travelReportSubmitters: [holder('u1', '土居')],
      })
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：0名（遠征届不要のため）')
      expect(row(facts, '管理者')).toBe('管理者：1名（土居）')
      expectTotalMatchesHeadcount(facts)
    })
  })

  describe('合計（AC-H2）', () => {
    it('誰も居なくても Bot の1名を数える', () => {
      expectTotalMatchesHeadcount(makeFacts())
      expect(render(makeFacts()).split('\n')[1]).toBe(
        'グループの人数が1名であることを確認してください。',
      )
    })

    it('兼務だらけでも、独立に数えた実人数と一致する', () => {
      const facts = makeFacts({
        entrantUserIds: new Set(['e1', 'e2', 'u3']),
        hasCircleMemberEntrant: true,
        hasGuestEntrant: true,
        // u3 は参加者、u4 は会計かつ副連絡責任者かつ管理者、u5 は管理者のみ。
        admins: [holder('u3', '参加'), holder('u4', '兼務'), holder('u5', '酒井')],
        treasurers: [holder('u4', '兼務')],
        travelReportSubmitters: [holder('u4', '兼務')],
      })
      // e1, e2, u3, u4, u5 + Bot = 6
      expect(expectedTotal(facts)).toBe(6)
      expectTotalMatchesHeadcount(facts)
      expect(row(facts, '会計')).toBe('会計：1名（兼務）')
      expect(row(facts, '副連絡責任者')).toBe('副連絡責任者：0名（会計として計上のため）')
      expect(row(facts, '管理者')).toBe('管理者：1名（酒井）')
    })

    it('役割者が全員参加者でも二重計上しない', () => {
      const facts = makeFacts({
        entrantUserIds: new Set(['u1', 'u2']),
        hasCircleMemberEntrant: true,
        admins: [holder('u1', '酒井')],
        treasurers: [holder('u2', '飯塚')],
        travelReportSubmitters: [holder('u1', '酒井')],
      })
      expect(expectedTotal(facts)).toBe(3)
      expectTotalMatchesHeadcount(facts)
    })
  })

  it('名字に中括弧が混ざっても本文を壊さない（AC-H18）', () => {
    const facts = makeFacts({ admins: [holder('u1', '{m0}')] })
    expect(row(facts, '管理者')).toBe('管理者：1名（m0）')
  })
})
