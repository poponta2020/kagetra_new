---
status: locked
slug: nav-settings-hub
target: apps/web/src/components/layout/（MobileShell / BottomNav）+ /settings（新規）+ /settings/line-link
design_source: live
chosen_direction: バーごと削除 + 設定タブ（最後尾）+ 独立した設定ハブページ
round: 1

mock_dir: null
design_project: null

prototype_branch: design/nav-settings-hub
prototype_base: c67f4678af79fbb950ff3550449514d9ff6a4d27
---
# ナビゲーション再編（上部バー廃止・設定ハブ） デザイン仕様（design-spec）

> 視覚の正 = `design-prototype.patch`（ブランチ `design/nav-settings-hub`）。
> ロジック・遷移・権限は [requirements.md](requirements.md) が正。ここには視覚の意図と
> 忠実度チェックリストだけを書く。

## 1. 対象と狙い
- **対象:** アプリシェル（上部バー廃止・ボトムナビ再編）、新規 `/settings`、`(app)` へ移設した `/settings/line-link`
- **現状の不満:** 常時 44px を占有する上部バーの情報価値が低い／設定導線が「ユーザー名タップ」に埋もれている／管理者ナビが 7 タブで窮屈（375px で 53.6px/タブ）
- **狙い:** 上端 44px をコンテンツに返し、設定を「タブ → 画面」という発見しやすい導線にする
- **主ユーザー / 主な使い方:** 全会員（日常はホーム/イベント/統計）＋管理者（申込管理・メール）。設定は低頻度

## 2. 採用した方向性
- **方向性:** バーごと削除＋ボトムナビ最後尾に「設定」タブ＋設定は独立ページ（要件承認済み）
- **不採用案と理由:**
  - バーを残して画面タイトルを出す → 全画面のタイトル定義が必要でスコープが膨張。各ページは既に `<h1>` を持つため重複
  - タブで従来のシートを開く → 「遷移」ではなくタブのアクティブ表示ができない
- **視覚の正:** `design-prototype.patch`（基点 `c67f467` = 現 main）
- **最終確認時の状態:** `/settings`（管理者）、`/settings`（一般会員 = 4タブ）、`/dashboard`（上端余白）、`/settings/line-link`

## 3. 視覚の正に現れない設計判断
- **設定ページを Card で包まない。** 項目数が少なく（一般会員 2 / 管理者 5）、Card で囲うと余白ばかりの画面になる。廃止した設定シートのリスト行（区切り線＋右端 `›`）をそのまま画面に引き伸ばす形にした。
- **各行に 1 行の説明を付けた。** 「会員」「Bot」はタブラベル由来の 1〜2 文字語で、ナビから外して一覧に並べると何の画面か判別しづらくなるため。
- **管理セクションの並びは 会員 → メール通知 → Bot。** 参照頻度の高い順。ナビでの並び（会員 → メール → Bot）とも一致させ、移設前後で探す位置が変わらないようにした。
- **プレビューバッジはタブラベルの上に積む。** タブ内は横幅 63px しかなく横並びは不可。`roleViewLabel`（管理者/副管理者/一般会員）の短い方を使い、`previewBadgeLabel` の「◯◯ビュー」表記は使わない（「副管理者ビュー」は 63px に収まらない）。
- **表示ロールの現在値は Pill で示す。** プレビュー中は「表示中」、本来のロールに戻っているときは「本来のロール」と出し分け、いま異常状態かどうかを 1 行で読めるようにした。
- **`/settings/line-link` から「ダッシュボードへ戻る」を削除。** シェル内に入りボトムナビが戻り導線を担うため、画面内の戻るリンクは二重になる。

## 4. 使用コンポーネント
- **既存プリミティブ:** `SectionLabel`（アカウント / 管理 / 表示ロール）、`Pill`（表示ロールの現在値）
- **新規:** `SettingsLinkList`（設定ページ内のローカル関数コンポーネント。区切り線付きリンクリスト）。BottomNav のバッジは `Pill` を使わず素の span（`text-[9px]`。Pill の `sm` = 10px でも 63px タブでは窮屈）

## 5. 状態（state）
- **通常（管理者）:** ボトムナビ 6 タブ。設定ページに アカウント / 管理 / 表示ロール / ログアウト
- **通常（一般会員）:** ボトムナビ 4 タブ。設定ページは LINE アカウント切替 とログアウトのみ（管理セクションごと非表示）
- **表示ロールプレビュー中:** 設定タブの上にロール名バッジ。設定ページ末尾に「いま◯◯として表示しています」の補足
- **`rolePreview` が null:** 表示ロールセクションごと非描画
- **各状態の確認先:** `/settings`（admin セッション / member セッション）。バッジは確定前に cookie による強制表示で実測済み（そのスタブは patch に残していない）

## 6. 必要データ
- **表示フィールド:** `session.user.name`（`◯◯さん`）、`session.user.role` / `realRole`、`buildRolePreviewSelection()` の結果。すべて既存
- **仮データのまま確定した項目:** なし。バッジ確認用の DESIGN-PROTO スタブは検証後に除去済みで、patch には**残っていない**（`git grep DESIGN-PROTO` on source = 0 件）
- **集計・導出:** なし（新規クエリ・スキーマ変更なし）

## 7. インタラクション / レスポンシブ
- **操作:** タブ → `/settings` 遷移。設定ページの各行はページ遷移。表示ロールは Server Action（`returnTo=/settings` 固定）
- **モバイル:** 375px 実測 — 管理者 6 タブで 1 タブ 63px、プレビューバッジ 48px（収まる）。`document.scrollWidth === 375`（横スクロールなし）。ナビ実高 53px（52px + border-top 1px）

## 8. 忠実度チェックリスト ★実装の完了ゲート
- [ ] シェルの子は `<main>` と `<nav>` の 2 つだけ。上端に 44px のバーが無い（ワードマーク「かげとら」もユーザー名もどこにも出ない）
- [ ] ボトムナビの並びは 一般会員 = ホーム / イベント / 統計 / 設定、管理者 = ホーム / イベント / 統計 / 申込管理 / メール / 設定。**設定は必ず最後尾**
- [ ] 設定タブは `/settings` 配下に加え `/admin/members`・`/admin/line-channels` でも active（`border-brand text-brand`）
- [ ] プレビュー中のみ設定タブのラベル上にロール名バッジ（`bg-brand-bg text-brand-fg` の丸ピル・9px）。375px の管理者 6 タブでバッジがタブ幅を超えず、横スクロールが出ない
- [ ] 設定ページは Card で包まず、区切り線（`divide-y divide-border` + `border-y`）のリスト行。各行は 左＝ラベル＋説明の 2 段 / 右＝`›`
- [ ] 設定ページのセクションは アカウント → 管理 → 表示ロール → ログアウト の順。管理セクションは非管理者に**セクションごと**出ない
- [ ] 表示ロールの現在行に Pill が出る（プレビュー中＝「表示中」／本来のロール＝「本来のロール」）
- [ ] ログアウトは他の行と違い枠付きボタン（`border border-border rounded-md`）で、リンクリストと視覚的に分離されている
- [ ] `<main>` に padding が無く、各ページが根要素に `p-4` を持つ（見出しが画面上端・左端に張り付かない）
- [ ] `/settings/line-link` がシェル内の通常ページとして描画され、中央寄せカード（`min-h-screen` の縦横中央）でも「ダッシュボードへ戻る」リンクでもない

## 9. ガードレール準拠メモ
- 色・フォントは既存トークンのみ（`bg-brand-bg` / `text-brand-fg` / `text-ink-*` / `border-border` / `bg-surface(-alt)`）。新規トークンなし
- 絵文字なし。日本語 UI。朱（accent）はこの画面では未使用
- ダークモードはプロダクト方針として非対応（`docs/design/design.md` §2「ダークモード、いずれも使わない」）のため検証対象外

## 10. 残課題・実装への申し送り
- **DESIGN-PROTO スタブ:** なし（確定前に除去済み）。patch はそのまま productionize の土台にできる
- **patch 適用後の実測状態（2026-07-26 に design worktree で実行）:**
  - `pnpm --filter @kagetra/web check-types` → **green**（スクリプト名は `typecheck` ではなく `check-types`）
  - `pnpm --filter @kagetra/web lint` → **green**（`No ESLint warnings or errors`）
  - `vitest run --no-file-parallelism src/components/layout src/lib/role-preview.test.ts`
    → **7 failed / 42 passed**。落ちるのは `bottom-nav.test.tsx` の 7 件のみで、すべて
    旧 7/3 タブ構成を前提にしたもの（下記）。`role-preview.test.ts` は全 green
- **patch が同梱しているテスト側の後始末（`check-types` を green にするために必要だった分）:**
  - `mobile-shell.test.tsx` を**削除**（`user` / `signOutAction` 等の消えた prop を渡しており
    9 件の TS2322 になる。tsc はテストも対象なので残すと型チェックが通らない）→ 実装タスクで作り直す
  - `previewBadgeLabel` と `PREVIEW_BADGE_LABEL` を `lib/role-preview.ts` から削除し、
    `role-preview.test.ts` の import と describe ブロックも同時に削除（未使用になるため）
  - `account-menu.tsx` / `account-menu.test.tsx` / `app-bar-main.tsx` を削除
- **実装タスクが直す既知の red（bottom-nav.test.tsx の 7 件）:**
  「isAdmin=true で全タブ表示」「管理者 7 個ちょうど」「一般 3 個ちょうど」
  「/admin/entries で他 6 タブが active にならない」「/members で会員タブが active」
  「/admin/members/42/edit で会員タブが active」「既存 6 タブのラベルと href の対応（回帰）」
  - ★このうち `/members` は**実在しないルート**（`(app)` 配下に `members/` は無く `/admin/members`
    のみ）。旧 TABS の死んだ match だったので新実装では復元しない
- **ローカル dev DB がマイグレーション未同期:** 台帳が 3/45 しか記録されておらず（dump 復元由来）
  `mail_messages.triage_status` が無いため `/events`・`/admin/*` はローカルで 500。**今回の変更とは
  無関係**。これらのページの見た目確認は出荷後の実機で行う
- **patch の apply:** 現 main `c67f467` に対し `git apply --check` 通過を確認済み（2026-07-26・27 ファイル・
  すべて `apps/web` 配下）。main がさらに進んで衝突する場合は patch を読んで手動移植する

## 11. 要件への宿題（→ /define-feature nav-settings-hub）
- （なし。requirements.md の「デザインへの宿題」4件はすべて本 spec 内で解決済み）
