---
name: ship-rename-app-to-hokumei
description: アプリ名を「かげとら」から「北溟」へ変更
type: project
---

shipped: PR #639 https://github.com/poponta2020/kagetra_new/pull/639 「feat: アプリ名を「かげとら」から「北溟」へ変更する」（quickfix・Issue なし）。マージ成功（merge commit 808c634・2026-09-13）。CI は pending のままマージ（v0.9.0 方針。赤なら追修正）。

**内容**: 表示名のみの置換（27 ファイル 42 行）。PWA manifest・<title>・appleWebApp title・ログイン/招待登録/メール共有ページ、LINE 配信文面の自己言及（「景虎上の申込人数」「景虎上の想定金額」「景虎の進行管理から」→「北溟」）、mail-worker の AI プロンプト自己紹介、docs/spec・docs/design の日本語名。識別子（@kagetra/*・DB名・Bot ID・tmp 接頭辞）と docs/features は不変。

**レビュー**: auto-review-loop 3R(i+d+f)・verdict=pass・effort h→m→h・累計 295,466 tokens。R1 blocker 1 件（プロンプト文言変更に伴う PROMPT_VERSION 未更新 → 3.1.1 へ patch bump・d86707a）。再レビューせずに修正した指摘なし・WONTFIX なし。

**残DoD / 残課題**:
- 本番実機確認: ログイン画面・タブ名・PWA 追加時の名称が「北溟」、LINE 配信文面に「北溟上の…」
- ★アプリアイコン（apps/web/public/icons/*.png・apple-touch-icon.png）は「か」一文字のまま → 別途差し替え（spawn_task チップ提示済み）
- PWA 追加済み端末は再追加まで旧名。docs/materials の会員ガイド PDF は「かげとら（仮）」のまま（untracked）。LINE Bot 表示名は LINE Developers 側

関連: [[quickfix-rename-app-to-hokumei]] [[auto-review-round-pr639]] [[fix-pr639]]
