import { expect, test } from '@playwright/test'
import type { ParsedResultPayload } from '@kagetra/mail-worker/result-import/schema'
import {
  AUTHJS_SESSION_COOKIE,
  seedMemberSession,
} from '../src/test-utils/playwright-auth'
import { testDb, truncateAll } from '../src/test-utils/db'
import { materializeResultDraft } from '../src/lib/result-import/materialize'

async function addSessionCookie(
  context: import('@playwright/test').BrowserContext,
  token: string,
) {
  await context.addCookies([
    {
      name: AUTHJS_SESSION_COOKIE,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

/** 優勝太郎（優勝）vs 準優花子（準優勝）の D 級 1 大会を仕込む（PR-5 大会詳細用）。 */
async function seedTournament(): Promise<number> {
  const classes: ParsedResultPayload['classes'] = [
    {
      className: 'D級',
      grade: 'D',
      sheetName: null,
      participants: [
        {
          seqNo: 1,
          name: '優勝太郎',
          nameKana: null,
          affiliation: '札幌',
          prefecture: null,
          dan: null,
          memberNo: null,
          finalRank: null,
          matches: [{ round: 1, roundLabel: '決勝', opponentName: '準優花子', scoreDiff: 5, result: 'win', status: 'normal' }],
        },
        {
          seqNo: 2,
          name: '準優花子',
          nameKana: null,
          affiliation: null,
          prefecture: null,
          dan: null,
          memberNo: null,
          finalRank: null,
          matches: [{ round: 1, roundLabel: '決勝', opponentName: '優勝太郎', scoreDiff: 5, result: 'lose', status: 'normal' }],
        },
      ],
    },
  ]
  const { tournamentId } = await testDb.transaction((tx) =>
    materializeResultDraft(
      tx,
      { parserVersion: '1.0.0', classes },
      { tournamentName: 'E2E大会', eventDate: '2025-04-01', venue: '札幌', sourceResultDraftId: 1 },
    ),
  )
  return tournamentId
}

// senseki-stats PR-2（ナビ）＋PR-5（大会結果）：「統計」タブ配下の 4 セクション横断ナビで
// 全セクションへ到達でき、大会結果→大会詳細→戦績詳細の閲覧導線が通ることを担保する。
test.describe('統計タブ ナビ＋大会結果導線', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('一般会員: 4セクションを行き来でき、選手検索は非退行', async ({ browser }) => {
    const member = await seedMemberSession({ name: 'Member User' })
    const context = await browser.newContext()
    await addSessionCookie(context, member.sessionToken)
    const page = await context.newPage()

    // 着地点＝選手検索（/players）。SectionTabs が出て 選手検索 が active。
    await page.goto('/players')
    const segA = page.getByRole('navigation', { name: '統計セクション' })
    await expect(segA).toBeVisible()
    await expect(segA.getByRole('link', { name: '選手検索' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('searchbox', { name: '選手名' })).toBeVisible()

    // ボトムナビの「統計」タブがアクティブ（/players 配下）。
    const statsTab = page.getByRole('link', { name: '統計', exact: true })
    await expect(statsTab).toHaveClass(/border-brand/)

    // → 大会結果（/tournaments）：PR-5 本実装。年別/大会別トグル＋大会名検索が出る。
    await segA.getByRole('link', { name: '大会結果', exact: true }).click()
    await expect(page).toHaveURL(/\/tournaments$/)
    await expect(page.getByRole('tab', { name: '年別' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '大会別' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: '大会名で検索' })).toBeVisible()
    await expect(segA.getByRole('link', { name: '大会結果', exact: true })).toHaveAttribute('aria-current', 'page')

    // → 選手ランキング（/players/ranking）
    await segA.getByRole('link', { name: 'ランキング' }).click()
    await expect(page).toHaveURL(/\/players\/ranking$/)
    await expect(page.getByRole('tablist', { name: '指標' })).toBeVisible()

    // → 大会統計（/tournaments/stats）
    await segA.getByRole('link', { name: '大会統計' }).click()
    await expect(page).toHaveURL(/\/tournaments\/stats$/)
    await expect(page.getByRole('heading', { name: '級別構成の推移' })).toBeVisible()

    // → 選手検索へ戻れる（既存検索の非退行）
    await segA.getByRole('link', { name: '選手検索' }).click()
    await expect(page).toHaveURL(/\/players$/)
    await expect(page.getByRole('searchbox', { name: '選手名' })).toBeVisible()

    await context.close()
  })

  test('大会結果→大会詳細→戦績詳細へ遷移できる（プッシュは SectionTabs 無し）', async ({ browser }) => {
    const member = await seedMemberSession({ name: 'Member User' })
    await seedTournament()
    const context = await browser.newContext()
    await addSessionCookie(context, member.sessionToken)
    const page = await context.newPage()

    // 年別一覧に大会が出る。行タップ → 大会詳細。
    await page.goto('/tournaments')
    await expect(page.getByText('E2E大会')).toBeVisible()
    await page.getByText('E2E大会').click()
    await expect(page).toHaveURL(/\/tournaments\/\d+$/)

    // プッシュ画面には横断ナビ（SectionTabs）を出さない（requirements §3.1）。
    await expect(page.getByRole('navigation', { name: '統計セクション' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'E2E大会' })).toBeVisible()

    // 入賞者タブ（既定）に優勝者が出る。氏名タップ → 戦績詳細（/players/[id]）。
    await expect(page.getByRole('tab', { name: '入賞者' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('link', { name: '優勝太郎' }).click()
    await expect(page).toHaveURL(/\/players\/\d+$/)

    await context.close()
  })
})
