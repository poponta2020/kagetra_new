import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { EntryBoardClient } from './EntryBoardClient'
import { displayName, type EntryBoardItem } from './entry-board-utils'

// 描画側の要件（区画の常設・折りたたみ・強調・残日数の出し分け・遷移先）を固定する。
// 仕分けと日付計算そのものは entry-board-utils.test.ts が持つ。

const TODAY = '2026-07-10'

/**
 * `entryGroupId` の既定値は自分自身の `id`——各行が独立したシングルトン
 * グループになる（従来の「1行=1大会」相当）。複数行を同じグループへ
 * まとめたいテストは `entryGroupId` に加えて `groupDisplayName` /
 * `groupRepresentativeEventId` も明示で上書きする（本番では page.tsx が
 * グループごとに一度だけ計算して全メンバーに同じ値をコピーする。
 * entry-board-utils.ts はそれを読むだけで自前で計算しない）。
 *
 * `groupDisplayName` の既定値は `displayName()`（shortName+級／title
 * フォールバック）——page.tsx が実際に行う導出手順1（要件 §3.2.5）を
 * そのまま模している。単独グループのテストはこの自動導出に任せてよい。
 */
function makeItem(overrides: Partial<EntryBoardItem> = {}): EntryBoardItem {
  const id = overrides.id ?? 1
  const title = overrides.title ?? '大会'
  const shortName = overrides.shortName ?? null
  const eligibleGrades = overrides.eligibleGrades ?? null
  return {
    id,
    entryGroupId: id,
    groupName: title,
    groupDisplayName: displayName({ title, shortName, eligibleGrades }),
    groupRepresentativeEventId: id,
    title,
    shortName,
    eventDate: '2026-08-01',
    eligibleGrades,
    internalDeadline: null,
    entryDeadline: null,
    paymentDeadline: null,
    paymentDeadlineKind: 'unspecified',
    lotteryDate: null,
    entryStatus: 'not_applied',
    paymentType: null,
    paymentStatus: 'unpaid',
    attendCount: 0,
    hasConfirmedRoster: false,
    ...overrides,
  }
}

/** 区画見出しの h2 から、その区画の <section> を取る。 */
function sectionOf(label: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: label })
  const section = heading.closest('section')
  if (!section) throw new Error(`section not found for ${label}`)
  return section
}

/** 強調（面の塗り）が掛かっているか。design-spec §3-6: 塗りだけで枠線は付けない。 */
function isHot(label: string): boolean {
  return sectionOf(label).querySelector('.bg-danger-bg') !== null
}

// round 13 で改称した区画名（design-spec §2-6）。旧名（要対応 / 申込済み・
// 抽選待ち / 名簿確定・振込待ち）はもう使わない。
const AREA_LABELS = [
  '締切前',
  '要申込',
  '申込完了・抽選待ち',
  '名簿確定・要振込',
  '完了',
] as const

describe('EntryBoardClient', () => {
  // AC-25 後段: 区画は件数で消えない。位置が動くと「いつも同じ場所を見れば
  // 同じフェーズが分かる」という一目性が失われる。
  it('AC-25: 0 件の区画も見出しを残して「なし」を出す（区画は消えない）', () => {
    render(
      <EntryBoardClient
        items={[makeItem({ id: 1, internalDeadline: '2026-07-20' })]}
        todayStr={TODAY}
      />,
    )

    for (const label of AREA_LABELS) {
      expect(screen.getByRole('heading', { name: label })).toBeTruthy()
    }
    // 「締切前」以外の 4 区画は 0 件なので「なし」が出る
    expect(screen.getAllByText('なし')).toHaveLength(4)
    expect(within(sectionOf('締切前')).queryByText('なし')).toBeNull()
  })

  // round 13: 区画見出しは新名称のみ。旧名は DOM に出ない。
  it('区画見出しが新名称で、旧名（要対応・申込済み・抽選待ち・名簿確定・振込待ち）は DOM に無い', () => {
    render(
      <EntryBoardClient
        items={[makeItem({ id: 1, internalDeadline: '2026-07-20' })]}
        todayStr={TODAY}
      />,
    )

    for (const label of AREA_LABELS) {
      expect(screen.getByRole('heading', { name: label })).toBeTruthy()
    }
    for (const oldLabel of ['要対応', '申込済み・抽選待ち', '名簿確定・振込待ち']) {
      expect(screen.queryByText(oldLabel)).toBeNull()
    }
  })

  // AC-25 前段。母集団は非表示条件を引いた後の件数なので、取得行が
  // あっても全件が非表示に落ちたら空状態を出す。
  it('AC-25: 母集団 0 件なら空状態メッセージを出す', () => {
    render(<EntryBoardClient items={[]} todayStr={TODAY} />)
    expect(screen.getByText('管理対象の大会はありません')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '締切前' })).toBeNull()
  })

  it('AC-25: 取得行はあっても全件が非表示条件に該当するなら空状態を出す', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({ id: 1, entryStatus: 'not_applying' }),
          // 締切超過かつ出欠 0 名
          makeItem({ id: 2, internalDeadline: '2026-06-01', attendCount: 0 }),
        ]}
        todayStr={TODAY}
      />,
    )
    expect(screen.getByText('管理対象の大会はありません')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '締切前' })).toBeNull()
  })

  // AC-20: 日付の種類名は区画見出しに 1 回だけ。全行に出すと 375px で幅が足りない。
  it('AC-20: 日付の種類名が区画見出しに 1 回だけ出て、行には出ない', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({ id: 1, internalDeadline: '2026-07-20', attendCount: 2 }),
        ]}
        todayStr={TODAY}
      />,
    )

    for (const hint of ['会内締切', '本締切', '抽選日', '支払締切', '開催日']) {
      expect(screen.getAllByText(hint)).toHaveLength(1)
    }
    const row = screen.getByRole('link')
    expect(row.textContent).not.toContain('会内締切')
  })

  it('AC-16: 行に「通称+級（N名）」が出る（通称なしは title へフォールバック・0名は人数非表示）', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({
            id: 1,
            shortName: '札幌',
            eligibleGrades: ['A', 'B'],
            attendCount: 3,
            internalDeadline: '2026-07-20',
          }),
          makeItem({
            id: 2,
            title: '第10回とても長い名前の大会',
            shortName: null,
            eligibleGrades: null,
            attendCount: 0,
            internalDeadline: '2026-07-21',
          }),
        ]}
        todayStr={TODAY}
      />,
    )

    const links = screen.getAllByRole('link')
    expect(links[0]?.textContent).toContain('札幌AB')
    expect(links[0]?.textContent).toContain('（3名）')
    expect(links[1]?.textContent).toContain('第10回とても長い名前の大会')
    expect(links[1]?.textContent).not.toContain('名）')
  })

  // AC-26: 表示専用。状態変更は進行管理パネル（申込グループページ側）に
  // 一本化されており、一覧から直接押せると LINE 通知 2 通が飛ぶ操作を誤タップ
  // できてしまう。
  // entry-group-page AC-27: 行の遷移先は申込グループページ
  // （/admin/entries/[groupId]）。makeItem の既定では entryGroupId = id。
  it('AC-26: 行タップで /admin/entries/[groupId] へ遷移し、状態を変える操作は存在しない', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({ id: 42, internalDeadline: '2026-07-20' }),
          makeItem({ id: 7, entryStatus: 'applied' }),
        ]}
        todayStr={TODAY}
      />,
    )

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/admin/entries/42', '/admin/entries/7'])

    // ボタンは「締切前」の折りたたみトグルだけ。フォーム要素も無い。
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.textContent).toContain('締切前')
    expect(document.querySelectorAll('form, input, select')).toHaveLength(0)
  })

  // AC-23: 折りたためるのは「締切前」だけ。既定は開（出欠の集まり具合を
  // 眺めるのが主用途のため）。
  it('AC-23: 「締切前」だけ開閉でき、既定は開いた状態', () => {
    render(
      <EntryBoardClient
        items={[makeItem({ id: 1, internalDeadline: '2026-07-20' })]}
        todayStr={TODAY}
      />,
    )

    const toggle = screen.getByRole('button')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(sectionOf('締切前')).getByRole('link')).toBeTruthy()

    // 他 4 区画の見出しはボタンではない
    for (const label of AREA_LABELS.filter((l) => l !== '締切前')) {
      expect(within(sectionOf(label)).queryByRole('button')).toBeNull()
    }
  })

  // AC-24: 畳んだまま締切を跨ぐ事故を防ぐため、3 日以内の行は残す。
  it('AC-24: 畳んでも会内締切 3 日以内の行は残り、隠れた行数が「ほかN件」で出る', () => {
    render(
      <EntryBoardClient
        items={[
          // 3 日以内 → 畳んでも残る
          makeItem({ id: 1, shortName: '近い', internalDeadline: '2026-07-13' }),
          // 4 日以上先 → 隠れる
          makeItem({ id: 2, shortName: '遠い', internalDeadline: '2026-07-14' }),
          // 締切未設定 → 判定不能なので隠れる
          makeItem({ id: 3, shortName: '未設定' }),
        ]}
        todayStr={TODAY}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    const section = sectionOf('締切前')
    expect(within(section).getByText('近い')).toBeTruthy()
    expect(within(section).queryByText('遠い')).toBeNull()
    expect(within(section).queryByText('未設定')).toBeNull()
    expect(within(section).getByText('ほか2件')).toBeTruthy()
    // 件数ピルは畳んでも母数のまま
    expect(within(section).getByText('3件')).toBeTruthy()
  })

  // 回帰: 残す行が 1 件も無いのが「締切前」の通常の状態（締切が全部先）。
  // 行一覧の描画条件を visible.length > 0 だけにすると、この状態で
  // 「ほかN件」ごと消えて畳んだ区画が完全に無言になる。
  it('AC-24: 3 日以内の行が 1 件も無くても「ほかN件」は出る', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({ id: 1, shortName: '遠い', internalDeadline: '2026-07-20' }),
          makeItem({ id: 2, shortName: '未設定' }),
        ]}
        todayStr={TODAY}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    const section = sectionOf('締切前')
    expect(within(section).queryByRole('link')).toBeNull()
    expect(within(section).getByText('ほか2件')).toBeTruthy()
  })

  // AC-21 / AC-22: 強調は行動フェーズ 2 区画に限り、締切到来済みが 1 件以上
  // あるときだけ。常時赤いと赤が背景と化して効かなくなる。
  it('AC-21: 「要申込」は締切到来済みが 1 件以上あるときだけ強調される', () => {
    const overdue = makeItem({
      id: 1,
      internalDeadline: '2026-06-01',
      entryDeadline: '2026-07-09',
      attendCount: 1,
    })
    const { unmount } = render(
      <EntryBoardClient items={[overdue]} todayStr={TODAY} />,
    )
    expect(isHot('要申込')).toBe(true)
    unmount()

    // 本締切がまだ 4 日以上先なら強調しない
    render(
      <EntryBoardClient
        items={[{ ...overdue, entryDeadline: '2026-07-20' }]}
        todayStr={TODAY}
      />,
    )
    expect(isHot('要申込')).toBe(false)
  })

  it('AC-21b: 「要申込」に本締切未設定の大会が 1 件でもあれば強調される（fail-safe）', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({
            id: 1,
            internalDeadline: '2026-06-01',
            entryDeadline: null,
            attendCount: 1,
          }),
        ]}
        todayStr={TODAY}
      />,
    )
    expect(isHot('要申込')).toBe(true)
  })

  it('AC-21: 「名簿確定・要振込」も支払締切が到来していれば強調される', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({
            id: 1,
            entryStatus: 'applied',
            hasConfirmedRoster: true,
            paymentType: 'advance',
            paymentStatus: 'unpaid',
            paymentDeadline: '2026-07-10',
          }),
        ]}
        todayStr={TODAY}
      />,
    )
    expect(isHot('名簿確定・要振込')).toBe(true)
  })

  it('AC-22: 行動フェーズ以外の 3 区画は締切が超過していても強調されない', () => {
    render(
      <EntryBoardClient
        items={[
          // 締切前（会内締切は今日）
          makeItem({ id: 1, internalDeadline: TODAY }),
          // 抽選待ち（抽選日が過去）。事前払い・未振込でないと完了へ抜ける
          makeItem({
            id: 2,
            entryStatus: 'applied',
            paymentType: 'advance',
            paymentStatus: 'unpaid',
            lotteryDate: '2026-06-01',
          }),
          // 完了（開催日が今日）
          makeItem({
            id: 3,
            entryStatus: 'applied',
            hasConfirmedRoster: true,
            paymentType: 'onsite',
            eventDate: TODAY,
          }),
        ]}
        todayStr={TODAY}
      />,
    )

    expect(isHot('締切前')).toBe(false)
    expect(isHot('申込完了・抽選待ち')).toBe(false)
    expect(isHot('完了')).toBe(false)
  })

  // AC-22b: 「0 件の区画は行動フェーズでも朱にしない」（design-spec §2 採らなかった
  // もの / requirements §3.2.7 設計判断12）。見出し・玉・件数ピルすべてグレーで、
  // 朱系クラスが一切付かないことを固定する。
  it('AC-22b: 0 件の行動フェーズ区画は見出し・玉・件数ピルすべてグレーで朱系クラスを持たない', () => {
    render(
      <EntryBoardClient
        items={[makeItem({ id: 1, internalDeadline: '2026-07-20' })]}
        todayStr={TODAY}
      />,
    )

    for (const label of ['要申込', '名簿確定・要振込']) {
      const section = sectionOf(label)

      const heading = within(section).getByRole('heading', { name: label })
      expect(heading.className).not.toMatch(/text-danger/)
      expect(heading.className).toContain('text-ink-muted')

      const node = section.querySelector('[data-testid="area-node"]')
      expect(node).toBeTruthy()
      expect(node?.className).not.toMatch(/border-danger|bg-danger/)
      expect(node?.className).toContain('border-border')

      const countPill = within(section).getByText('0件')
      expect(countPill.className).not.toMatch(/bg-danger|text-danger/)
      expect(countPill.className).toContain('text-ink-muted')
    }
  })

  // AC-19: まだ手を動かす段階ではないフェーズに残日数を出さない。
  it('AC-19: 「申込完了・抽選待ち」と「完了」の行には残日数が出ない', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({
            id: 1,
            shortName: '抽選',
            entryStatus: 'applied',
            paymentType: 'advance',
            paymentStatus: 'unpaid',
            lotteryDate: '2026-07-11',
          }),
          makeItem({
            id: 2,
            shortName: '完了',
            entryStatus: 'applied',
            hasConfirmedRoster: true,
            paymentType: 'onsite',
            eventDate: '2026-07-11',
          }),
        ]}
        todayStr={TODAY}
      />,
    )

    for (const label of ['申込完了・抽選待ち', '完了']) {
      const row = within(sectionOf(label)).getByRole('link')
      expect(row.textContent).not.toContain('あと')
      expect(row.textContent).not.toContain('本日')
      expect(row.textContent).not.toContain('超過')
      expect(row.textContent).toContain('7/11')
    }
  })

  it('抽選日が未設定の行は日付列に「未定」を出す', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({
            id: 1,
            entryStatus: 'applied',
            paymentType: 'advance',
            paymentStatus: 'unpaid',
            lotteryDate: null,
          }),
        ]}
        todayStr={TODAY}
      />,
    )
    const row = within(sectionOf('申込完了・抽選待ち')).getByRole('link')
    expect(row.textContent).toContain('未定')
  })

  // AC-18: 4 日以上先の残日数は読む必要がないので出さない（日付だけ残す）。
  it('AC-18: 残日数は超過・本日・あと1〜3日のときだけ出る', () => {
    render(
      <EntryBoardClient
        items={[
          makeItem({ id: 1, shortName: '当日大会', internalDeadline: TODAY }),
          makeItem({ id: 2, shortName: '三日後大会', internalDeadline: '2026-07-13' }),
          makeItem({ id: 3, shortName: '四日後大会', internalDeadline: '2026-07-14' }),
        ]}
        todayStr={TODAY}
      />,
    )

    const section = sectionOf('締切前')
    const rowOf = (name: string) =>
      within(section).getByText(name).closest('a')!.textContent ?? ''

    expect(rowOf('当日大会')).toContain('本日')
    expect(rowOf('三日後大会')).toContain('あと3日')
    expect(rowOf('四日後大会')).not.toContain('あと4日')
    expect(rowOf('四日後大会')).toContain('7/14')
  })

  // ---------------------------------------------------------------------------
  // round 13: 1 グループ = 常に 1 行（日別行への展開は廃止。design-spec §2-5）
  // ---------------------------------------------------------------------------

  describe('グループの1行化', () => {
    it('複数日グループが1行で描画され、グループ表示名・共通の締切・合計人数が1回だけ出る', () => {
      render(
        <EntryBoardClient
          items={[
            makeItem({
              id: 11,
              entryGroupId: 900,
              title: '多摩A',
              groupDisplayName: '多摩AB',
              groupRepresentativeEventId: 11,
              eligibleGrades: ['A'],
              eventDate: '2026-08-01',
              internalDeadline: '2026-06-01',
              entryDeadline: '2026-07-20',
              attendCount: 2,
            }),
            makeItem({
              id: 12,
              entryGroupId: 900,
              title: '多摩B',
              groupDisplayName: '多摩AB',
              groupRepresentativeEventId: 11,
              eligibleGrades: ['B'],
              eventDate: '2026-08-02',
              internalDeadline: '2026-06-01',
              entryDeadline: '2026-07-20',
              attendCount: 3,
            }),
          ]}
          todayStr={TODAY}
        />,
      )

      const section = sectionOf('要申込')
      const links = within(section).getAllByRole('link')
      expect(links).toHaveLength(1) // 1グループ=1行。日別行は増えない
      expect(links[0]?.textContent).toContain('多摩AB')
      expect(links[0]?.textContent).toContain('（5名）') // 2 + 3 の合計
      expect(links[0]?.textContent).toContain('7/20') // 共通の本締切
    })

    it('複数日グループでも日別行（開催日・級・日別状態）は DOM に出ない', () => {
      render(
        <EntryBoardClient
          items={[
            makeItem({
              id: 51,
              entryGroupId: 903,
              title: '多摩A',
              groupDisplayName: '多摩AB',
              groupRepresentativeEventId: 51,
              eventDate: '2026-08-01',
              entryStatus: 'applied',
              hasConfirmedRoster: true,
              paymentType: 'onsite',
            }),
            makeItem({
              id: 52,
              entryGroupId: 903,
              title: '多摩B',
              groupDisplayName: '多摩AB',
              groupRepresentativeEventId: 51,
              eventDate: '2026-08-02',
              entryStatus: 'not_applied',
              internalDeadline: '2026-06-01',
              attendCount: 1,
            }),
          ]}
          todayStr={TODAY}
        />,
      )

      // グループは「最も対応が必要」な区画（要申込）に載る
      const section = sectionOf('要申込')
      const links = within(section).getAllByRole('link')
      expect(links).toHaveLength(1) // 日別行は増えない
      // 日別の開催日はどこにも出ない
      expect(document.body.textContent).not.toContain('8/1')
      expect(document.body.textContent).not.toContain('8/2')
    })

    // entry-group-page AC-27: 遷移先は代表イベントではなく申込グループページ
    // （groupId=entryGroupId）。representativeEventId はもう href に使わない。
    it('行タップは申込グループページ（/admin/entries/[groupId]）へ遷移する', () => {
      render(
        <EntryBoardClient
          items={[
            makeItem({
              id: 21,
              entryGroupId: 901,
              title: '多摩A',
              groupDisplayName: '多摩AB',
              groupRepresentativeEventId: 21, // 今日以降で最も近い → 代表
              eventDate: '2026-08-01',
              internalDeadline: '2026-06-01',
              attendCount: 1,
            }),
            makeItem({
              id: 22,
              entryGroupId: 901,
              title: '多摩B',
              groupDisplayName: '多摩AB',
              groupRepresentativeEventId: 21,
              eventDate: '2026-08-10',
              internalDeadline: '2026-06-01',
              attendCount: 1,
            }),
          ]}
          todayStr={TODAY}
        />,
      )

      const section = sectionOf('要申込')
      const links = within(section).getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]?.getAttribute('href')).toBe('/admin/entries/901')
    })

    // design-spec §3-5: 日別展開の廃止で失う情報を受容する。締切が食い違う
    // 場合、行にはその区画の観点で最も早い日の締切だけが出る。
    it('締切がグループ内で食い違う場合は最も早い日の締切だけが行に出る（情報欠落は受容）', () => {
      render(
        <EntryBoardClient
          items={[
            makeItem({
              id: 31,
              entryGroupId: 902,
              title: '多摩A',
              groupDisplayName: '多摩AB',
              groupRepresentativeEventId: 31,
              eventDate: '2026-08-01',
              internalDeadline: '2026-06-01',
              entryDeadline: '2026-07-20',
              attendCount: 1,
            }),
            makeItem({
              id: 32,
              entryGroupId: 902,
              title: '多摩B',
              groupDisplayName: '多摩AB',
              groupRepresentativeEventId: 31,
              eventDate: '2026-08-02',
              internalDeadline: '2026-06-01',
              entryDeadline: '2026-07-25',
              attendCount: 1,
            }),
          ]}
          todayStr={TODAY}
        />,
      )

      const section = sectionOf('要申込')
      const links = within(section).getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]?.textContent).toContain('7/20')
      expect(links[0]?.textContent).not.toContain('7/25')
    })

    it('シングルトングループは従来どおり1行のまま出る（回帰）', () => {
      render(
        <EntryBoardClient
          items={[
            makeItem({
              id: 41,
              shortName: '単独',
              internalDeadline: '2026-07-20',
            }),
          ]}
          todayStr={TODAY}
        />,
      )

      const section = sectionOf('締切前')
      expect(within(section).getAllByRole('link')).toHaveLength(1)
      expect(within(section).getByRole('link').textContent).toContain('単独')
    })
  })
})
