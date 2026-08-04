---
name: ship-member-role-management
description: 管理者による会員ロールの付与・剥奪
type: project
---

PR #455 https://github.com/poponta2020/kagetra_new/pull/455 — feat(admin): 管理者による会員ロールの付与・剥奪。**merged**（2026-08-05）。Issue #450（親）・#451-454（子）すべてクローズ。

## 出荷内容

- 会員編集 `/admin/members/[id]/edit` に「ロール」セクション（**admin にのみ描画**・3択＋`window.confirm`）
- 会員一覧のロール列を `roleViewLabel` の日本語ラベルに
- `updateMemberRole`（マイグレーション無し。`user_role` enum・列とも既存）

拒否条件: admin 以外 / 表示ロールのプレビュー中（**実効ロール `session.user.role` で判定**・realRole は使わない）/ 自分自身 / LINE 未紐付けの昇格 / 退会済みの昇格 / 有効な管理者が 0 人になる変更。判定と UPDATE は単一 tx で「有効 admin 集合 FOR UPDATE → 対象行 FOR UPDATE」の順にロック。

## ★出荷に伴う既存挙動の変更（運用に影響）

`unlinkLine`（LINE 紐付け解除）の**対象が `member` ロール限定**になった。管理者・副管理者の紐付けをやり直させたいときは、**先に一般会員へ降格してから解除**する。理由は Codex R1 が見つけた権限昇格経路 — 昇格後に解除すると未紐付けの管理者行ができ、`/self-identify`（未紐付け ∧ 招待済みを role を見ずに候補化）経由で招待リンクを開いた第三者に名乗られる。存在しない userId を無害に返す既存契約は維持。

## レビュー

4R（initial 1 + delta 2 + final 1）で pass。累計 434,737 / 500,000 トークン。**打ち切りなし・WONTFIX なし・未再レビューの修正なし**（final が最終形の全差分を確認済み）。詳細は [auto-review PR #455](auto-review-round-pr455.md)。

## 残 DoD

- **本番実機での動作確認**（未実施）。特に「昇格 → 一覧・編集画面の表示」「権限持ちに解除ボタンが出ないこと」
- CI は pending のままマージ（v0.9.0 方針）。赤なら /quickfix で追修正

## 未対応（別件・docs/spec/auth-admin.md の既知のギャップに記載済み）

退会処理 `toggleMemberDeactivation` には「最後の有効な管理者を退会させられる」穴が残っている。ロール変更側は 0 人ガードを持つが退会切替は持たない。全管理者が退会するとログイン可能な管理者が居なくなり DB 直接操作でしか復旧できない。
