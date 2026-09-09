import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { main } from '../renewal-daily'

/**
 * renewal-daily: バッチの配線だけを見る（annual-registration-renewal タスク8）。
 * 対象日判定・分割・表示名解決・学年反映の中身は `lib/membership-renewal/
 * reminders.test.ts` / `apply-school-year.test.ts` が担保しているので、ここでは
 * 「引数検証」「--dry-run が候補を列挙するだけで副作用ゼロ」を確認する。
 *
 * DATABASE_URL は vitest.setup.ts でテスト DB に固定されているため、
 * `@/lib/db` が向く DB もテスト DB と一致する。
 */

const stdout: string[] = []

beforeEach(async () => {
  await truncateAll()
  stdout.length = 0
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeTestDb()
})

describe('renewal-daily main() — 引数検証', () => {
  it('--reminders も --apply-school-year も指定しなければ throw する', async () => {
    await expect(main([])).rejects.toThrow(
      '--reminders または --apply-school-year のいずれかを指定してください',
    )
  })

  it('--dry-run だけでは throw する（サブコマンドが必須）', async () => {
    await expect(main(['--dry-run'])).rejects.toThrow()
  })
})

describe('renewal-daily main() — --dry-run', () => {
  it('--reminders --dry-run は進行中の年度確認が無ければ skipped を出力するだけ', async () => {
    await main(['--reminders', '--dry-run'])
    expect(stdout.join('')).toContain('DRY RUN')
    expect(stdout.join('')).toContain('skipped: no-open-renewal')
  })

  it('--apply-school-year --dry-run は候補 0 件を出力するだけ', async () => {
    await main(['--apply-school-year', '--dry-run'])
    expect(stdout.join('')).toContain('DRY RUN')
    expect(stdout.join('')).toContain('0 candidate(s)')
  })

  it('両方同時に指定しても両方の DRY RUN が出力される', async () => {
    await main(['--reminders', '--apply-school-year', '--dry-run'])
    const output = stdout.join('')
    expect(output).toContain('renewal-daily reminders')
    expect(output).toContain('renewal-daily apply-school-year')
  })
})
