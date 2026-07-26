---
name: impl-nav-settings-hub-wave2
description: nav-settings-hub Wave 2（タスク2-4）
type: project
---

nav-settings-hub Wave 2（タスク2 #348 / タスク3 #349 / タスク4 #350）を task-implementer 3 ワーカーで並行実装。worktree `C:/tmp/impl-nav-settings-hub`。コミット `73c8325` / `fa04958` / `43e0d6b`。

## Wave 構成と結果
3 タスクを1メッセージで同時起動（profile の max_workers: 3・worker_verify: none）。変更領域は完全に直交し、**排他宣言のミスは無し**（同一ファイルへの衝突ゼロ）。所要は各 4〜6 分。

- タスク2（Sonnet）: mobile-shell.test.tsx 新規 / bottom-nav.test.tsx 書き換え / page-padding.test.ts 新規
- タスク3（Sonnet）: (app)/settings/page.test.tsx 新規
- タスク4（Sonnet）: e2e/settings-entry.spec.ts 書き換え / docs/spec/ui-shell.md / docs/design/design.md

## バリア後に main が直列検証して見つけた欠陥（ワーカーは検証コマンドを持たないため必然）
初回 vitest は **16 failed**。原因は3つで、いずれもワーカー単体では踏めないもの:

1. **★CRLF で page-padding.test.ts が14件全 red** — `source.split('\n')` だと Windows checkout（autocrlf）で各行末に \r が残り、アンカー正規表現 `/^ {2}return \($/` の $ が外れる。**CI(Linux/LF) では green になるので、ローカルで踏まなければ「Windowsだけ落ちるテスト」を出荷していた**。`split(/\r?\n/)` で修正
2. **jsdom 環境で `fileURLToPath(new URL(x, import.meta.url))` が落ちる** — 「The URL must be of scheme file」。global の URL が jsdom 実装に差し替わっているため。文字列の import.meta.url を直接 fileURLToPath に渡して path.join する形なら通る（page-padding.test.ts はこちらの形で通っていた）
3. `getByRole('button', {name: /管理者/})` が「副管理者」にも当たって多重マッチ → `/^管理者/`

さらに `check-types` で 3 件の TS2532（`lines[anchorIndexes[0]+1]` / `shell.children[0].tagName` の possibly undefined）。**ワーカーは eslint しか回せないので tsc の穴は必ず main 側に残る**という構図。

もう1件、実装ソース側のコメントに「ダッシュボードへ戻る」の語が残っているため `not.toContain('ダッシュボードへ戻る')` が偽陽性。href の不在（`/href=[\"']\/dashboard[\"']/`）で判定する形へ変更。

## main が追加したテスト
bottom-nav.test.tsx に `/admin/members/42/edit` を含む詳細パスの active 判定を追加（旧「会員タブ」時代の回帰ガードを設定タブへ引き継ぐ。ワーカーは削除したまま復元していなかった）。

## 最終検証（すべて main が直列実行）
- `vitest run --no-file-parallelism src/components/layout src/lib/role-preview.test.ts page-padding settings/page role-preview-actions` → **100 passed**
- `vitest run --no-file-parallelism \"src/app/(app)\"` → **45 files / 673 passed**（14ページの p-4 追加が既存 page テストを壊していないことの確認込み）
- `check-types` green / `lint` green
- E2E は未実行（CI に委譲）

## 教訓（次の Wave 編成へ）
worker_verify: none の環境では、**ワーカー成果物の「型」と「行末・環境依存」の 2 種類の欠陥がバリアまで必ず残る**。バリア直後に check-types → 対象 vitest の順で回すのを定型手順にする。とくに **ソースを読むタイプのテストは CRLF を必ず疑う**（このリポジトリは core.autocrlf=true）。
