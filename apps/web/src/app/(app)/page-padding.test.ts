import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// AC-16b: nav-settings-hub §3.5 で「上部バー廃止に伴い、根要素に padding を
// 持たないページの見出しが画面最上端 (y=0) に張り付く」問題を、各ページ側に
// `p-4` を足すことで解消した。<main>（共通シェル）に padding を足さない境界
// は PR #345 の回帰ガードとして維持したまま（mobile-shell.test.tsx 参照）、
// この 14 ページ側の p-4 だけを機械的に固定する。
//
// サーバーコンポーネントを 14 個実際にレンダリングして DOM を検証するのは
// mock コスト（認可ガード・DB 呼び出し・Server Action 等を全ページ分スタブ
// する必要がある）が見合わないため、<main> の padding 禁止ガードと同種の
// 「ソースレベルの機械ガード」として実装する。
//
// アンカー規則（14 ファイル全てで実測済み）:
//   1. ファイル全体から `^  return \($`（2 スペースインデント + `return (`
//      + 行末）にマッチする行を集める。
//   2. ちょうど 1 本であることを assert する（複数あればアンカーが曖昧に
//      なったということ＝このテストで検出したい退行）。
//   3. その次の行が padding utility（`/\bp[xytrbl]?-/`）にマッチすることを
//      assert する（その行が default export の JSX 根要素）。
const RETURN_ANCHOR = /^ {2}return \($/

// requirements.md §3.5: 対象 14 ページ（(app) 配下からの相対パス）。
// 対象外（意図的な全幅レイアウト。ここには含めない）:
//   - players/page.tsx, players/ranking/page.tsx（sticky フィルタバーが全幅）
//   - admin/mail-inbox/attachments/[id]/page.tsx（画像ビューア）
const TARGET_PAGES: readonly string[] = [
  'dashboard/page.tsx',
  'admin/entries/page.tsx',
  'admin/members/page.tsx',
  'admin/members/[id]/edit/page.tsx',
  'admin/mail-inbox/page.tsx',
  'admin/mail-inbox/[id]/page.tsx',
  'admin/mail-inbox/mail/[id]/page.tsx',
  'admin/mail-inbox/result-drafts/[id]/page.tsx',
  'admin/mail-inbox/roster-drafts/[id]/page.tsx',
  'events-archive/page.tsx',
  'events/new/page.tsx',
  'events/[id]/page.tsx',
  'events/[id]/edit/page.tsx',
  'settings/notifications/page.tsx',
]

const appDir = dirname(fileURLToPath(import.meta.url))

describe('ページ余白の統一（AC-16b）', () => {
  it.each(TARGET_PAGES)('%s の根要素に padding utility が付いている', (relPath) => {
    const source = readFileSync(join(appDir, relPath), 'utf-8')
    // Windows の checkout では autocrlf により行末が CRLF になる。`'\n'` で
    // 割ると各行末に `\r` が残り、アンカー正規表現の `$` が外れて
    // 「ローカルだけ全件 red・CI(Linux) は green」になる。
    const lines = source.split(/\r?\n/)
    const anchorIndexes = lines
      .map((line, i) => (RETURN_ANCHOR.test(line) ? i : -1))
      .filter((i) => i !== -1)

    // アンカーが曖昧（0本 or 2本以上）なら、根要素の行を機械的に特定できない
    // ということなので、そこ自体を退行として検出する。
    expect(anchorIndexes).toHaveLength(1)

    const rootElementLine = lines[(anchorIndexes[0] ?? -1) + 1]
    expect(rootElementLine).toMatch(/\bp[xytrbl]?-/)
  })
})
