import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * systemd unit と scoped sudoers の網羅性を機械的に照合する。
 *
 * `scripts/deploy/auto-deploy.sh` は unit を `sudo -n /usr/bin/install ...` で配置し、
 * timer は `enable --now` → `restart` → `is-active` まで実行する。`infra/sudoers/kagetra-deploy`
 * はワイルドカードを禁止して**unit 名を1行ずつ固定列挙**しているため（privilege escalation 対策）、
 * unit を増やしたのに sudoers へ足し忘れると、そのコマンドだけ sudo に蹴られて**本番デプロイが失敗する**。
 *
 * 実際に2回踏んでいる:
 * - entry-overdue-alert: sudoers 未反映のままマージして install で失敗
 * - annual-registration-renewal (PR #631): install / enable --now / restart は足したが
 *   **`is-active` の2行だけ漏れ**ていた（timer を次に変更したときに初めて失敗する遅延地雷）
 *
 * 人間のレビューでは「4種類×N個の行が全部あるか」を数え落とすので、ここで機械的に見る。
 *
 * 注: vitest の cwd は `apps/web`（`src/lib/entry-form/cell-map.test.ts` と同じ前提）。
 */
const REPO_ROOT = resolve(process.cwd(), '../..')
const SUDOERS_PATH = resolve(REPO_ROOT, 'infra/sudoers/kagetra-deploy')

/** `apps/<app>/systemd/kagetra-*.{service,timer}` を全て集める。 */
function listUnits(): { name: string; repoPath: string; isTimer: boolean }[] {
  const appsDir = resolve(REPO_ROOT, 'apps')
  const units: { name: string; repoPath: string; isTimer: boolean }[] = []
  for (const app of readdirSync(appsDir, { withFileTypes: true })) {
    if (!app.isDirectory()) continue
    const systemdDir = resolve(appsDir, app.name, 'systemd')
    let entries: string[]
    try {
      entries = readdirSync(systemdDir)
    } catch {
      continue // systemd ディレクトリを持たないアプリ
    }
    for (const name of entries) {
      if (!name.startsWith('kagetra-')) continue
      if (!name.endsWith('.service') && !name.endsWith('.timer')) continue
      units.push({
        name,
        repoPath: `apps/${app.name}/systemd/${name}`,
        isTimer: name.endsWith('.timer'),
      })
    }
  }
  return units.sort((a, b) => a.repoPath.localeCompare(b.repoPath))
}

const units = listUnits()
const sudoers = readFileSync(SUDOERS_PATH, 'utf8')
const sudoersLines = new Set(sudoers.split('\n').map((line) => line.trim()))

/** sudoers は1行1コマンドの完全一致で列挙する形なので、部分一致ではなく行として照合する。 */
function hasLine(command: string): boolean {
  return sudoersLines.has(`kagetra ALL=(root) NOPASSWD: ${command}`)
}

describe('systemd unit と infra/sudoers/kagetra-deploy の対応', () => {
  it('unit を1つ以上見つけている（glob が壊れて空振りしていない）', () => {
    expect(units.length).toBeGreaterThan(5)
  })

  it.each(units)('$repoPath — install 行がある', ({ name, repoPath }) => {
    expect(
      hasLine(`/usr/bin/install -m 644 -o root -g root /opt/kagetra/${repoPath} /etc/systemd/system/${name}`),
    ).toBe(true)
  })

  const timers = units.filter((u) => u.isTimer)

  it.each(timers)('$name — enable --now / restart / is-active が揃っている', ({ name }) => {
    // auto-deploy.sh は timer に対してこの3つを順に実行する。1つでも欠けると
    // `sudo: a password is required` でデプロイが中断する。
    expect(hasLine(`/usr/bin/systemctl enable --now ${name}`)).toBe(true)
    expect(hasLine(`/usr/bin/systemctl restart ${name}`)).toBe(true)
    expect(hasLine(`/usr/bin/systemctl is-active ${name}`)).toBe(true)
  })

  it.each(units.filter((u) => !u.isTimer))(
    '$name — User=kagetra / Group=kagetra を宣言している（auto-deploy の権限昇格ガード）',
    ({ repoPath }) => {
      const body = readFileSync(resolve(REPO_ROOT, repoPath), 'utf8')
      expect(body).toMatch(/^User=kagetra$/m)
      expect(body).toMatch(/^Group=kagetra$/m)
    },
  )

  it('sudoers に CR が混じっていない（visudo は CRLF を syntax error で蹴る）', () => {
    expect(sudoers).not.toContain('\r')
  })
})
