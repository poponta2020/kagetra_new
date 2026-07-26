---
name: ship-nav-settings-hub
description: ナビゲーション再編（上部バー廃止・設定ハブ新設）
type: project
---

**PR #351** https://github.com/poponta2020/kagetra_new/pull/351 — feat(nav): 上部バー廃止・ボトムナビ再編・設定ハブ /settings 新設（親 Issue #346 / 子 #347-#350）

## 出荷内容
44px の上部バー（ワードマーク「かげとら」＋`{name}さん`）を廃止し、設定導線をボトムナビ「設定」タブ →独立ページ `/settings` へ集約。

- `MobileShell` の子は `<main>` と `<nav>` の 2 つだけに。`MobileShellProps` は `isAdmin` + `previewRoleLabel` の 2 つへ縮小。`app-bar-main.tsx` / `account-menu.tsx` は削除
- ボトムナビ: 会員 / Bot タブ廃止・「設定」タブを最後尾に追加（一般会員 4 / 管理者 6。375px で 1 タブ 53.6px→62.5px）。`/admin/members`・`/admin/line-channels` 配下でも設定タブが active
- 表示ロールプレビューのバッジを上部バーから設定タブへ移設。文言は `roleViewLabel`（タブ幅 63px に「副管理者ビュー」が収まらない実測による）。`previewBadgeLabel` は削除
- `(app)/settings/page.tsx` 新設。表示ロール切替は `returnTo=/settings` 固定で切替後もこのページに留まる
- `/settings/line-link` を `(app)` 配下へ移設（**URL 不変**）。孤児ページ脱出口だった「ダッシュボードへ戻る」を削除
- 14 ページの根要素に `p-4`（`<main>` は padding 無しのまま = PR #345 の回帰ガード維持）

## レビュー・検証
- **Codex auto-review 1R pass**（effort=high・151,585 tokens）。blockers 0 / should_fix 0 / nits 0。ラウンド記録は省略されたためここに集約
- ローカル: `vitest "src/app/(app)"` 45 files / 673 passed、レイアウト＋設定系 100 passed、check-types green、lint green
- gate-dod: A1/A2 PASS・A3 は CI 実行中で SKIP・B1 は pending のままマージ可

## Wave 構成
Wave1=タスク1（main 単独・patch productionize）→ Wave2=タスク2/3/4 を task-implementer 3 体並行。排他宣言のミスは無し。バリア後に main が 4 件の欠陥を修正（詳細は [[impl-nav-settings-hub-wave2]]）。

## 残 DoD（出荷後に本番実機で消化）
**AC-21（manual）のみ**。375px 実機で ①ボトムナビ 6 タブのラベルが折り返さない ②プレビューバッジがタブ幅に収まり横スクロールが出ない ③設定ページが崩れない、の 3 点を確認する。design-spec §8 の忠実度チェックリスト 10 項目はコード照合で全クリアだが、項目4 の 375px 実測はデザインフェーズのプロトタイプ計測（1 タブ 63px・バッジ 48px・scrollWidth===375）が根拠で、実装後の実機観察はまだ。

要件定義 = [[project-nav-settings-hub-def]] / タスク1 = [[impl-nav-settings-hub-task1]] / Wave2 = [[impl-nav-settings-hub-wave2]]
