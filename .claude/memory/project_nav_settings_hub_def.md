---
name: feature-def-nav-settings-hub
description: nav-settings-hub 要件定義
type: project
---

# nav-settings-hub 要件定義（2026-07-26）

上部バー（44px・ワードマーク「かげとら」＋「◯◯さん」タップの設定シート）を**バーごと廃止**し、
設定をボトムナビ「設定」タブ →独立ページ `/settings` へ移す改修。会員・Bot はナビから設定ハブへ移設。

## 確定した設計判断と理由
- **バーごと削除**: ワードマークとユーザー名を除くと中身が空。各ページは独自 `<h1>` を持ち、
  `components/ui/app-bar.tsx`（画面内ヘッダ）は**定義のみで未使用**だった。ユーザー名は
  /dashboard の「ようこそ、◯◯さん」と設定ページで確認できる。
- **設定はシートでなく独立ページ**: タブでシートを開くとアクティブ表示ができない。
- **ボトムナビ**: 一般 4 タブ（ホーム/イベント/統計/設定）・管理者 6 タブ（＋申込管理/メール）。
  設定は常に最後尾。申込管理とメールはナビ据え置き（メールは未処理バッジを持つ日常動線）。
  `/admin/members`・`/admin/line-channels` でも設定タブを active にする。
- **★プレビューバッジの孤児化**: `previewBadge` は AccountMenu トリガー内にしか無く、バー削除で
  表示先が消える＝管理者が一般会員表示のまま気づかず操作する事故。設定タブへ移設を AC 化。
  文言は `previewBadgeLabel`（「副管理者ビュー」）ではなく `roleViewLabel`（「副管理者」）。
  **375px 管理者 6 タブ＝1タブ 63px にバッジ 48px。「◯◯ビュー」は収まらないと実測で確定。**
- **切替後は /settings に留まる**（returnTo 固定値）。従来の `window.location` 読み取りは
  シートが全画面から開けた前提の設計だった。
- **`/settings/line-link` を (app) 配下へ移設**（URL 不変）。従来はシェル外の孤児ページ。
- **★ページ余白 14 ページに p-4**: バー削除で見出しが y=0 に張り付く（/dashboard の h1 実測 (0,0)）。
  `<main>` に padding を足さない境界（PR #345 の回帰ガード）は維持し、ページ側で解消する規約に揃えた。
  当初 9 ページと見積もったが実際は 14 ページ（メール下書き詳細 4 ページ等を数え落としていた）。
  対象外＝players・players/ranking（全幅 sticky フィルタ）、mail-inbox/attachments（画像ビューア）。

## Acceptance Criteria
auto-test 21 件 / manual 1 件（実機 375px）。回帰 AC は `<main>` の padding 無し維持・
`/events-archive` の誤 active 防止・既存テスト/lint/typecheck が CI green。

## Issue
親 #346 / 子 #347（patch 適用・productionize）#348（レイアウト系ユニットテスト）
#349（設定ページ+line-link テスト）#350（E2E 書き換え+design.md §3 整合）

## Wave 構成
Wave 1 = #347 単独（全ての土台）。Wave 2 = #348/#349/#350 の 3 並行（変更領域が直交）。

## デザイン
Path L（ライブプロト）で確定。design-spec.md は `status: locked`、視覚の正＝
`docs/features/nav-settings-hub/design-prototype.patch`（基点 c67f467 = 現 main・`git apply --check` 通過・27ファイル）。
DESIGN-PROTO スタブは確定前に除去済みで patch に残っていない。
**実装は patch 適用が主で、タスクの実体はテスト書き換えとドキュメント整合。**

## 実装時の注意
- **patch 適用直後の実測（design worktree で確認済み）: `check-types` green / `lint` green /
  ユニットテストは `bottom-nav.test.tsx` の 7 件だけ red**（旧 7/3 タブ前提）。それ以外が red なら
  移植ミスを疑う。
- 型チェックのスクリプト名は `typecheck` ではなく **`check-types`**（`tsc --noEmit`）。
  **テストファイルも対象**なので、消えた prop を渡す `mobile-shell.test.tsx` を残すと通らない。
  patch は同ファイルの削除と `previewBadgeLabel`/`PREVIEW_BADGE_LABEL` の除去を同梱しており、
  #348 で mobile-shell.test.tsx を作り直す。
- 旧 bottom-nav テストの「`/members` で会員タブ active」は**復元しない** — `/members` は実在
  しないルートで、旧 TABS の死んだ match だった。
- `e2e/settings-entry.spec.ts` は「ヘッダーボタン→dialog」という前提が丸ごと無効。
- `docs/design/design.md` §3 が上部バー・タブ一覧の正典としてコード側コメントから参照されている。
- ローカル dev DB は移行台帳が 3/45 しか無く（dump 復元由来）`mail_messages.triage_status` が
  無いため /events・/admin/* が 500。**今回の変更とは無関係**・Non-goal。
