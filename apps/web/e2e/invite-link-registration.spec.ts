import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { registrationInvites, users } from '@kagetra/shared/schema'
import {
  AUTHJS_SESSION_COOKIE,
  issueUnboundLineSession,
  seedAdminSession,
  seedMemberSession,
} from '../src/test-utils/playwright-auth'
import { createUser } from '../src/test-utils/seed'
import { testDb, truncateAll } from '../src/test-utils/db'

/**
 * invite-link-registration E2E (invite-register-redesign).
 *
 * Covers the registrant side (welcome → structured-name + 条件付き PII form →
 * create, per-grade patterns, name collision, expired-link rejection,
 * already-bound redirect) and the admin issue side. The real LINE OAuth
 * round-trip is skipped: the "logged in via LINE, not yet bound" state is
 * injected directly via issueUnboundLineSession (lineUserId set, id unset) —
 * the same technique self-identify-flow.spec.ts uses.
 *
 * The webServer runs in dev (webpack) mode, so rendering the client form here
 * also guards against node: import breakage in the client bundle.
 */
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

const DAY_MS = 24 * 60 * 60 * 1000

/** Seed a registration_invites row (with a throwaway issuer for the FK). */
async function seedInvite(
  token: string,
  opts?: { expiresAt?: Date; revokedAt?: Date | null },
) {
  const issuer = await createUser({ name: `issuer-${token}`, role: 'admin' })
  await testDb.insert(registrationInvites).values({
    token,
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
    createdBy: issuer.id,
    revokedAt: opts?.revokedAt ?? null,
  })
}

type Page = import('@playwright/test').Page

async function fillNames(page: Page, family = '山田', given = '太郎') {
  await page.getByLabel('姓（漢字）').fill(family)
  await page.getByLabel('名（漢字）').fill(given)
  await page.getByLabel('せい（ふりがな）').fill('やまだ')
  await page.getByLabel('めい（ふりがな）').fill('たろう')
}

/** Click a 下線セグメント option by its visible label (e.g. 級 'B', 段位 '六段'). */
async function pickSegment(page: Page, label: string) {
  await page.getByText(label, { exact: true }).click()
}

const INVALID_LINK_TEXT =
  'この招待リンクは無効か期限切れです。お手数ですが管理者にご連絡ください。'

test.describe('invite-link-registration', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('未ログインで開くと ウェルカム + LINE認証ボタンが出る（フォームは出ない）', async ({
    browser,
  }) => {
    await seedInvite('e2e-welcome')

    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('/register/e2e-welcome')
    await expect(page.getByRole('button', { name: 'LINE で認証する' })).toBeVisible()
    // The profile form must not appear before LINE auth.
    await expect(page.getByLabel('姓（漢字）')).toHaveCount(0)

    await context.close()
  })

  test('D級: 氏名+級のみ → 登録 → dashboard、段位/全日協/PII は null', async ({
    browser,
  }) => {
    await seedInvite('e2e-d')
    const { sessionToken } = await issueUnboundLineSession('Ureg-e2e-d')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/register/e2e-d')
    await expect(page.getByLabel('姓（漢字）')).toBeVisible()
    await fillNames(page)
    await pickSegment(page, 'D')
    await page.getByRole('button', { name: '登録する' }).click()

    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })

    const created = await testDb.query.users.findFirst({
      where: eq(users.name, '山田 太郎'),
    })
    expect(created?.role).toBe('member')
    expect(created?.isInvited).toBe(true)
    expect(created?.grade).toBe('D')
    expect(created?.familyName).toBe('山田')
    expect(created?.givenName).toBe('太郎')
    expect(created?.familyKana).toBe('やまだ')
    expect(created?.dan).toBeNull()
    expect(created?.zenNichikyo).toBe(false)
    expect(created?.gender).toBeNull()
    expect(created?.postalCode).toBeNull()
    expect(created?.lineUserId).toBe('Ureg-e2e-d')
    expect(created?.lineLinkedMethod).toBe('invite_link')

    await context.close()
  })

  test('B級 全日協ON: 全PII（住所2あり）を保存して登録', async ({ browser }) => {
    await seedInvite('e2e-b')
    const { sessionToken } = await issueUnboundLineSession('Ureg-e2e-b')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/register/e2e-b')
    await fillNames(page, '全日協', '太郎')
    await pickSegment(page, 'B')
    // 全日協チェックは既定 ON → PII ブロックが開く。
    await expect(page.getByText('全日協登録情報')).toBeVisible()
    await pickSegment(page, '男性')
    await page.getByLabel('生年月日').fill('1990-04-01')
    await page.getByLabel('電話番号').fill('090-1234-5678')
    await page.getByLabel('郵便番号').fill('001-0010')
    await page.getByLabel('住所1（丁目・番地まで）').fill('札幌市北区北十条西1-1')
    await page.getByLabel('住所2（建物名・部屋番号）').fill('カゲトラマンション101')
    await page.getByRole('button', { name: '登録する' }).click()

    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })

    const created = await testDb.query.users.findFirst({
      where: eq(users.name, '全日協 太郎'),
    })
    expect(created?.grade).toBe('B')
    expect(created?.zenNichikyo).toBe(true)
    expect(created?.gender).toBe('male')
    expect(created?.birthDate).toBe('1990-04-01')
    expect(created?.phone).toBe('090-1234-5678')
    expect(created?.postalCode).toBe('0010010')
    expect(created?.address1).toBe('札幌市北区北十条西1-1')
    expect(created?.address2).toBe('カゲトラマンション101')

    await context.close()
  })

  test('C級 全日協ON + 戸建てチェック: 住所2 は null で登録', async ({ browser }) => {
    await seedInvite('e2e-c')
    const { sessionToken } = await issueUnboundLineSession('Ureg-e2e-c')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/register/e2e-c')
    await fillNames(page, '戸建て', '花子')
    await pickSegment(page, 'C')
    await pickSegment(page, '女性')
    await page.getByLabel('生年月日').fill('1985-12-20')
    await page.getByLabel('電話番号').fill('011-700-1000')
    await page.getByLabel('郵便番号').fill('0600001')
    await page.getByLabel('住所1（丁目・番地まで）').fill('札幌市中央区北一条西2')
    // 戸建てチェック → 住所2 無効化・未入力。
    await page.getByRole('checkbox', { name: '集合住宅ではない（一軒家）のため未入力' }).check()
    await page.getByRole('button', { name: '登録する' }).click()

    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })

    const created = await testDb.query.users.findFirst({
      where: eq(users.name, '戸建て 花子'),
    })
    expect(created?.grade).toBe('C')
    expect(created?.zenNichikyo).toBe(true)
    expect(created?.gender).toBe('female')
    expect(created?.address1).toBe('札幌市中央区北一条西2')
    expect(created?.address2).toBeNull()

    await context.close()
  })

  test('A級: 段位（六段）＋全日協ON＋PII を保存して登録', async ({ browser }) => {
    await seedInvite('e2e-a')
    const { sessionToken } = await issueUnboundLineSession('Ureg-e2e-a')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/register/e2e-a')
    await fillNames(page, '段位', '持')
    await pickSegment(page, 'A')
    // 段位セグメントが出る。
    await expect(page.getByRole('radiogroup', { name: '段位' })).toBeVisible()
    await pickSegment(page, '六段')
    await pickSegment(page, '男性')
    await page.getByLabel('生年月日').fill('1980-01-01')
    await page.getByLabel('電話番号').fill('09011112222')
    await page.getByLabel('郵便番号').fill('100-0001')
    await page.getByLabel('住所1（丁目・番地まで）').fill('東京都千代田区千代田1-1')
    // 住所2 未入力 → 戸建てチェックで必須を免除（フロント検証）。
    await page.getByRole('checkbox', { name: '集合住宅ではない（一軒家）のため未入力' }).check()
    await page.getByRole('button', { name: '登録する' }).click()

    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })

    const created = await testDb.query.users.findFirst({
      where: eq(users.name, '段位 持'),
    })
    expect(created?.grade).toBe('A')
    expect(created?.dan).toBe(6)
    expect(created?.zenNichikyo).toBe(true)
    expect(created?.postalCode).toBe('1000001')

    await context.close()
  })

  test('合成名が既存会員と衝突するとエラー表示・新規行は作られない', async ({
    browser,
  }) => {
    await seedInvite('e2e-dup')
    await createUser({ name: '山田 太郎', lineUserId: null })
    const { sessionToken } = await issueUnboundLineSession('Ureg-e2e-dup')

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/register/e2e-dup')
    await fillNames(page)
    await pickSegment(page, 'D')
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(
      page.getByRole('alert').filter({ hasText: '同名の会員が既に存在します' }),
    ).toBeVisible()
    // The new LINE account was not bound to anything.
    expect(
      await testDb.query.users.findFirst({ where: eq(users.lineUserId, 'Ureg-e2e-dup') }),
    ).toBeUndefined()

    await context.close()
  })

  test('期限切れトークンは無効メッセージのみ（LINEボタンもフォームも出ない）', async ({
    browser,
  }) => {
    await seedInvite('e2e-expired', { expiresAt: new Date(Date.now() - DAY_MS) })

    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('/register/e2e-expired')
    await expect(page.getByText(INVALID_LINK_TEXT)).toBeVisible()
    await expect(page.getByRole('button', { name: 'LINE で認証する' })).toHaveCount(0)
    await expect(page.getByLabel('姓（漢字）')).toHaveCount(0)

    await context.close()
  })

  test('存在しないトークンも無効メッセージ', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('/register/no-such-token-at-all')
    await expect(page.getByText(INVALID_LINK_TEXT)).toBeVisible()

    await context.close()
  })

  test('既に紐付け済みの会員が開くと /register に留まらず dashboard へ', async ({
    browser,
  }) => {
    await seedInvite('e2e-bound')
    const { sessionToken } = await seedMemberSession({
      name: 'Bound Member',
      lineUserId: 'Ualready-bound',
      lineLinkedAt: new Date(),
      lineLinkedMethod: 'invite_link',
    })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/register/e2e-bound')
    await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 })
    expect(page.url()).not.toContain('/register/')

    await context.close()
  })

  test('管理者が会員管理画面から招待リンクを発行 → モーダルにURL表示 + DBに行', async ({
    browser,
  }) => {
    const { sessionToken } = await seedAdminSession({ name: 'Invite Issuer' })

    const context = await browser.newContext()
    await addSessionCookie(context, sessionToken)
    const page = await context.newPage()

    await page.goto('/admin/members')
    await page.getByRole('button', { name: '招待リンクを発行' }).click()

    await expect(
      page.getByRole('heading', { name: '招待リンクを発行しました' }),
    ).toBeVisible()
    // The modal shows the full /register/<token> URL.
    await expect(page.getByText(/\/register\//)).toBeVisible()

    const rows = await testDb.select().from(registrationInvites)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.revokedAt).toBeNull()

    await context.close()
  })
})
