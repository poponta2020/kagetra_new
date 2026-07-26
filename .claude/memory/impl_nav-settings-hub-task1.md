---
name: impl-nav-settings-hub-task1
description: nav-settings-hub タスク1
type: project
---

nav-settings-hub タスク1（Issue #347）を worktree `C:/tmp/impl-nav-settings-hub`（ブランチ feature/nav-settings-hub）で実装。コミット `09b6dc4`。

## 実装内容
design-prototype.patch（27ファイル）を `git apply` して productionize。main は ef3ac60（patch 基点 c67f467 からは docs 差分のみ）だったため無修正で apply 成功。

- MobileShell から AppBarMain 除去 → 子は `<main>` と `<nav>` の2つだけ
- MobileShellProps を `isAdmin` + `previewRoleLabel` の2つへ縮小
- BottomNav: 会員/Bot タブ廃止・「設定」タブを最後尾に追加（一般4 / 管理者6）。matches に /admin/members・/admin/line-channels
- previewBadgeLabel / PREVIEW_BADGE_LABEL を削除し roleViewLabel の短い文言をタブ上バッジに使用
- (app)/settings/page.tsx 新設、settings/line-link を (app) 配下へ rename（URL不変）
- 14ページの根要素に p-4

## patch 適用後に main が追加で直した点（patch に無かった）
`git grep` でコメント内の死んだ参照が3件残っていた（AC-19 は `apps packages` にスコープして判定）:
- `lib/role-preview.ts` のヘッダコメント・RolePreviewSelection の doc（AccountMenu / 設定シート → 設定ページ・クライアントコンポーネント）
- `app/globals.css` の .modal-overlay-h 適用先リストから account-menu を除去
※ `components/ui/app-bar.tsx` の「MobileShell's outer top bar」コメントも古いが Non-goals（ついで整備禁止）により手を付けない

## 実測（worktree）
- `pnpm --filter @kagetra/web check-types` green
- `pnpm --filter @kagetra/web lint` green
- `vitest run --no-file-parallelism src/components/layout src/lib/role-preview.test.ts` → 7 failed / 42 passed。落ちるのは bottom-nav.test.tsx の7件のみ＝実装手順書の想定どおり（タスク2 で書き換え）
- 14ページの p-4 hunk を全件目視 + `grep -c '^  return ($'` で検証 → **全ファイルで 2スペースindent の `return (` はちょうど1本**、その直下が JSX 根要素。sed 由来の誤着地なし

## 実装時に判明したスコープ追加
`docs/spec/ui-shell.md` が docs レジストリ上のシェル正典で、AppBarMain / AccountMenu / 旧タブ構成の記述が丸ごと陳腐化する。実装手順書のタスク4 は docs/design/design.md しか挙げていなかったので **タスク4 のスコープに追加**（implementation-plan.md にも追記済み）。
e2e は `settings-entry.spec.ts` 1本だけが上部バー依存であることを grep で確認済み（admin-mail-inbox-trigger.spec.ts の "Header" は画面内ボタンで無関係）。

## worktree セットアップの注意
ensure-worktree.sh 直後は node_modules も .env.local も無い。`corepack pnpm install` + メインから `apps/web/.env.local` をコピーしないと check-types すら走らない。
