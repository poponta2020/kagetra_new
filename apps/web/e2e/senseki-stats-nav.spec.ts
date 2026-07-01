import { expect, test } from '@playwright/test'
import {
  AUTHJS_SESSION_COOKIE,
  seedMemberSession,
} from '../src/test-utils/playwright-auth'
import { truncateAll } from '../src/test-utils/db'

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

// senseki-stats PR-2（ナビ）：「統計」タブ配下の 4 セクション横断ナビ（SectionTabs）
// で全セクションへ到達でき、既存の選手検索が非退行であることを担保する。
test.describe('統計タブ 4セクションナビ（SectionTabs）', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('一般会員: 4セクションを行き来でき、選手検索は非退行', async ({
    browser,
  }) => {
    const member = await seedMemberSession({ name: 'Member User' })
    const context = await browser.newContext()
    await addSessionCookie(context, member.sessionToken)
    const page = await context.newPage()

    // 着地点＝選手検索（/players）。SectionTabs が出て 選手検索 が active。
    await page.goto('/players')
    const segA = page.getByRole('navigation', { name: '統計セクション' })
    await expect(segA).toBeVisible()
    await expect(segA.getByRole('link', { name: '選手検索' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // 既存の検索フォーム（非退行）。
    await expect(page.getByRole('searchbox', { name: '選手名' })).toBeVisible()

    // ボトムナビの「統計」タブがアクティブ（/players 配下）。SectionTabs には
    // ちょうど「統計」というラベルの項目が無い（大会統計など）ので exact 一致で
    // ボトムナビのリンクだけを掴める。
    const statsTab = page.getByRole('link', { name: '統計', exact: true })
    await expect(statsTab).toHaveClass(/border-brand/)

    // → 大会結果（/tournaments）
    await segA.getByRole('link', { name: '大会結果', exact: true }).click()
    await expect(page).toHaveURL(/\/tournaments$/)
    await expect(
      page.getByRole('heading', { name: '大会結果', exact: true }),
    ).toBeVisible()

    // → 選手ランキング（/players/ranking）
    await segA.getByRole('link', { name: 'ランキング' }).click()
    await expect(page).toHaveURL(/\/players\/ranking$/)
    // PR-3 で本実装：指標チップ（tablist）が出る（旧 scaffold の h1 は撤去）。
    await expect(page.getByRole('tablist', { name: '指標' })).toBeVisible()
    await expect(
      segA.getByRole('link', { name: 'ランキング' }),
    ).toHaveAttribute('aria-current', 'page')

    // → 大会統計（/tournaments/stats）：PR-4 本実装。全体サマリーの図見出しが出る
    // （旧 scaffold の h1「大会統計」は撤去）。
    await segA.getByRole('link', { name: '大会統計' }).click()
    await expect(page).toHaveURL(/\/tournaments\/stats$/)
    await expect(page.getByRole('heading', { name: '級別構成の推移' })).toBeVisible()
    await expect(segA.getByRole('link', { name: '大会統計' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    // → 選手検索へ戻れる（既存検索の非退行を再確認）
    await segA.getByRole('link', { name: '選手検索' }).click()
    await expect(page).toHaveURL(/\/players$/)
    await expect(page.getByRole('searchbox', { name: '選手名' })).toBeVisible()

    await context.close()
  })

  test('大会詳細（プッシュ表示）は SectionTabs を出さず戻れる', async ({
    browser,
  }) => {
    const member = await seedMemberSession({ name: 'Member User' })
    const context = await browser.newContext()
    await addSessionCookie(context, member.sessionToken)
    const page = await context.newPage()

    await page.goto('/tournaments/123')
    // プッシュ画面には横断ナビ（SectionTabs）を出さない（requirements §3.1）。
    await expect(
      page.getByRole('navigation', { name: '統計セクション' }),
    ).toHaveCount(0)
    // 戻る導線で大会結果へ。
    await page.getByRole('link', { name: '大会結果へ戻る' }).click()
    await expect(page).toHaveURL(/\/tournaments$/)
    await expect(
      page.getByRole('navigation', { name: '統計セクション' }),
    ).toBeVisible()

    await context.close()
  })
})
