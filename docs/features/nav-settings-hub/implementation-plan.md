---
status: completed
---
# ナビゲーション再編（上部バー廃止・設定ハブ新設） 実装手順書

**視覚の正 = [design-prototype.patch](design-prototype.patch)**（ブランチ `design/nav-settings-hub`・
基点 `c67f467` = 現 main。27 ファイル・すべて `apps/web` 配下。`git apply --check` 通過を
2026-07-26 に確認）。実装コードはこの patch で確定しているため、実装タスクは
「patch の productionize」＋「テストの再構築」＋「ドキュメント整合」に分かれる。
DESIGN-PROTO スタブは patch に含まれていない。

## patch 適用直後の状態（design worktree で実測済み・2026-07-26）

| コマンド | 結果 |
|---|---|
| `pnpm --filter @kagetra/web check-types` | **green**（スクリプト名は `typecheck` ではなく `check-types`） |
| `pnpm --filter @kagetra/web lint` | **green** |
| `vitest run --no-file-parallelism src/components/layout src/lib/role-preview.test.ts` | **7 failed / 42 passed** |

落ちる 7 件はすべて `bottom-nav.test.tsx`（旧 7/3 タブ構成を前提）。**タスク2 完了までこの 7 件が
red なのは想定どおり**で、それ以外が red になったら patch の移植ミスを疑うこと。

patch は `check-types` を green にするために以下のテスト側後始末を同梱している:
- `mobile-shell.test.tsx` を**削除**（消えた prop を渡していて 9 件の TS2322。tsc はテストも見る）
  → タスク2 で作り直す
- `previewBadgeLabel` / `PREVIEW_BADGE_LABEL` を `lib/role-preview.ts` から削除し、
  `role-preview.test.ts` の import と describe も同時に削除
- `account-menu.tsx` / `account-menu.test.tsx` / `app-bar-main.tsx` を削除

## 実装タスク

### タスク1: patch の適用とシェル・設定ハブの productionize
- [x] 完了
- **目的:** 上部バー廃止・ボトムナビ再編・`/settings` 新設・`/settings/line-link` 移設・
  14 ページの `p-4` を実コードに入れ、型チェックと lint を通す。
- **対応AC:** AC-1〜AC-19（AC-16b 含む）の実装側。検証は タスク2・3 が担う
- **主な変更領域:**
  - `apps/web/src/components/layout/`（`mobile-shell.tsx` / `bottom-nav.tsx` / `index.ts` 改修、
    `app-bar-main.tsx` / `account-menu.tsx` / `account-menu.test.tsx` / `mobile-shell.test.tsx` 削除）
  - `apps/web/src/app/(app)/layout.tsx`（`MobileShellProps` を `isAdmin` + `previewRoleLabel` へ縮小）
  - `apps/web/src/app/(app)/settings/page.tsx`（新規）
  - `apps/web/src/app/settings/line-link/` → `apps/web/src/app/(app)/settings/line-link/`（URL 不変）
  - requirements §3.5 の 14 ページの `page.tsx`（根要素に `p-4` を足すだけ）
  - `apps/web/src/lib/role-preview.ts` / `role-preview.test.ts`（`previewBadgeLabel` 除去）
- **依存タスク:** なし（Wave 1・単独。以降が触る全ファイルをここで確定させる）
- **必要なテスト:** 新規テストは書かない（タスク2・3 が担当）。patch 同梱のテスト削除・除去のみ。
- **完了条件:**
  - `pnpm --filter @kagetra/web check-types` が green
  - `pnpm --filter @kagetra/web lint` が green
  - `vitest run --no-file-parallelism src/components/layout src/lib/role-preview.test.ts` の
    **失敗が `bottom-nav.test.tsx` の 7 件だけ**（それ以外が落ちたら移植ミス）
  - `git grep -n "AppBarMain\|AccountMenu\|previewBadgeLabel"` が 0 件
  - `git grep -n "DESIGN-PROTO" apps packages` が 0 件
  - **`p-4` を足した 14 ページの hunk を 1 件ずつ目視**する。ローカル dev DB の都合で `/dashboard`
    以外は描画確認ができておらず、`p-4` が根要素でない別の `<div>` に着地しても check-types も
    lint も検出しない（プロトタイプは行番号指定の `sed` で当てた）。patch 側では 14 件すべてが
    4 スペースインデント＝`return (` 直下であることを確認済み
- **対応Issue:** #347

### タスク2: レイアウト系ユニットテストの再構築
- [x] 完了
- **目的:** シェル・ボトムナビの新しい契約と、ページ余白の規約を機械検証で固定する。
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-16, AC-16b, AC-19
- **主な変更領域:** `apps/web/src/components/layout/mobile-shell.test.tsx`（**新規作成** —
  タスク1 で削除済み）、`apps/web/src/components/layout/bottom-nav.test.tsx`（7 件の書き換え）、
  `apps/web/src/app/(app)/page-padding.test.ts`（新規）
- **依存タスク:** タスク1
- **必要なテスト:**
  - **`mobile-shell.test.tsx`（作り直し）**: 子は `<main>` と `<nav>` の 2 つだけ／ワードマーク
    「かげとら」とユーザー名が DOM に無い／`<main>` は `flex-1 min-h-0 overflow-y-auto` を保ち
    **padding utility を持たない（PR #345 の回帰ガードを必ず復活させる）**／`previewRoleLabel` が
    `BottomNav` へ透過される
  - **`bottom-nav.test.tsx`（7 件を書き換え）**: 一般会員 4 タブ / 管理者 6 タブの**並び順を含む**
    完全一致／設定タブが最後尾／`/settings`・`/admin/members`・`/admin/line-channels` で設定タブが
    active／`/admin/entries` で他タブが active にならない／`/events-archive` で `/events` タブが
    active にならない（既存ガード維持）／`previewRoleLabel` 有無でバッジの出し分け。
    ★旧テストの「`/members` で会員タブが active」は**復元しない** — `(app)` 配下に `members/` は
    存在せず（`/admin/members` のみ）、旧 TABS の死んだ match だった
  - **`page-padding.test.ts`（新規・AC-16b）**: requirements §3.5 の 14 パスを配列で持ち、各
    `page.tsx` を読んで default export の `return (` 直下の行に padding utility（`/\bp[xytrbl]?-/`）が
    あることを assert する。サーバーコンポーネントを 14 個レンダリングするのは mock コストが
    見合わないための、意図的なソースレベルの機械ガード（`<main>` の padding 禁止ガードと同種）。
    対象外の 3 ページ（`players`・`players/ranking`・`admin/mail-inbox/attachments/[id]`）を
    コメントで明記し、全幅レイアウトが意図であることを残す
- **完了条件:** `pnpm --filter @kagetra/web test -- --no-file-parallelism src/components/layout src/lib/role-preview.test.ts "src/app/(app)/page-padding.test.ts"` が green
- **対応Issue:** #348

### タスク3: 設定ページと line-link 移設のユニットテスト
- [x] 完了
- **目的:** 設定ハブの項目出し分け（権限ゲート）と、line-link がシェル内に入ったことを固定する。
- **対応AC:** AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-17, AC-18
- **主な変更領域:** `apps/web/src/app/(app)/settings/page.test.tsx`（新規）。
  既存のサーバーコンポーネント page テスト（例 `admin/entries/page.test.tsx`）の
  `auth()` mock パターンに倣う。
- **依存タスク:** タスク1
- **必要なテスト:**
  - 一般会員: 「LINE アカウント切替」とログアウトのみ。会員 / メール通知 / Bot と「管理」
    セクションが出ない（プロトタイプで curl 検証済みの挙動）
  - 管理者: 会員 / メール通知 / Bot が出て、href がそれぞれ `/admin/members` /
    `/settings/notifications` / `/admin/line-channels`
  - `◯◯さん` が表示される
  - `rolePreview` null → 「表示ロール」セクションごと非描画。非 null → 選択肢が並び、
    現在ロールに `aria-current` と Pill が付く
  - 表示ロールフォームの `returnTo` hidden input が `/settings`
- **AC-15 の分担（明示）:** 「切替後 `/settings` に留まる」は 2 段で担保する。
  ①「フォームが `/settings` を送る」= 本タスクの hidden input テスト。
  ②「Server Action が受け取った `returnTo` へ redirect する」= **既存の
  `apps/web/src/app/(app)/role-preview-actions.test.ts` の「returnTo の相対パスへ戻す」で
  カバー済み**（このテストは今回変更しない）。
  なお、プロトタイプ検証中に in-app pane 上で表示ロール切替がその場で反映されなかったが、これは
  `unstable_update` が**レスポンス**の cookie を書くのにペインがそれを保持せず `redirect()` にも
  追従できないためのペイン固有の制約（`/sw.js` での cookie 注入が効かなかったのと同種）であり、
  コード側の不具合ではない。実ブラウザでの確認はタスク4 の E2E に委ねる。
- **完了条件:** 上記テストが green
- **対応Issue:** #349

### タスク4: E2E の書き換えとデザイン設計書の整合
- [x] 完了
- **目的:** 「ヘッダーのボタン → dialog」という前提が無効になった E2E を新導線に置き換え、
  コード側コメントが参照している `docs/design/design.md` §3 を現状に合わせる。
- **対応AC:** AC-7, AC-15, AC-17, AC-20
- **主な変更領域:** `apps/web/e2e/settings-entry.spec.ts`、`docs/design/design.md`、
  `docs/spec/ui-shell.md`（実装時に追加 — docs レジストリ上「画面・シェルの機能仕様」の
  正典はこちらで、`AppBarMain` / `AccountMenu` / 旧タブ構成の記述が丸ごと古くなる）
- **依存タスク:** タスク1
- **必要なテスト:**
  - E2E: ボトムナビ「設定」タップ → `/settings` → 「メール通知」タップ → `/settings/notifications`
    で見出しが出る。`/settings/line-link` へ遷移してもボトムナビが見える（孤児化しない回帰ガード）。
    テスト名・コメントから「ヘッダー」「シート」の記述を落とす
  - E2E（表示ロール・推奨）: `ROLE_PREVIEW_USER_IDS` に載るユーザーで `/settings` の切替ボタンを
    押し、**遷移後も `/settings` にいること**を assert する（AC-15 の実ブラウザ確認）
  - `docs/design/design.md` §3: グローバル構造の図から上部ヘッダを削除、タブ一覧を
    「全員にホーム/イベント/統計/設定、管理者に申込管理/メールを追加」へ更新、
    「設定は `{name}さん` をタップしてシート」の記述を「設定タブ →`/settings`」へ差し替え
- **完了条件:** `pnpm --filter @kagetra/web test:e2e settings-entry` が green（E2E は CI にも委譲）。
  `git grep -n "{name}さん" docs/design/design.md` が 0 件。
- **対応Issue:** #350

## 実装順序（Wave = 並行実装できるタスクの組）
- **Wave 1:** タスク1（単独。全ての土台）
- **Wave 2:** タスク2, タスク3, タスク4（変更領域が直交 — タスク2 は
  `components/layout/*.test.tsx` + `app/(app)/page-padding.test.ts`、タスク3 は
  `app/(app)/settings/page.test.tsx`、タスク4 は `e2e/` + `docs/`。3 タスク並行可）

## 備考: このフェーズで先に main へ入れた変更
デザインフェーズで必要になったツーリング修正は、**worktree で失われないよう main へコミット済み**
（`8c48077` / `c67f467`）。実装タスクの対象外:
- `.claude/launch.json` — `design-live` の cwd が別リポジトリの worktree を指していた誤りを修正し、
  ジャンクション `.design-live` 経由の相対パスへ（preview runner は絶対パス cwd を拒否する）
- `.gitignore` — `.design-live` を追加
- `.claude/commands/show-app.md` — cookie 注入の fallback とジャンクション作成手順
- `.gitattributes` — `*.patch text eol=lf`（`core.autocrlf=true` で patch が CRLF 化して
  `git apply` が corrupt patch で落ちるのを防ぐ）
