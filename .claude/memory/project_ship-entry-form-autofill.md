---
name: ship-entry-form-autofill
description: 大会申込書の自動記入と Yahoo メール下書き作成
type: project
---

PR #399「feat: 大会申込書の自動記入と Yahoo メール下書き作成（entry-form-autofill）」の出荷記録。
URL: https://github.com/poponta2020/kagetra_new/pull/399

## 機能
申込グループ単位で、案内メール添付の申込書 xlsx を解析 → 参加希望会員（attend=true の和集合）を記入 → Yahoo の Draft へ IMAP APPEND で下書きを作成する。**SMTP・送信 API を一切持たない**ため送信は構造的に不可能（AC-16）。3ステップウィザード（テンプレ選択→会員編集→メール確認）＋設定ハブの申込書設定（会定数6項目）＋進行管理からの導線と履歴再DL。

## レビュー経過（Codex auto-review-loop: R1〜R8）
blocker 累計 23件・should_fix 20件。テーマは4系統に収束した:
1. **IMAP APPEND の非冪等性**（R1〜R7 まで尾を引いた最大の系統）— logout 失敗/状態更新失敗を作成失敗扱い、再試行が非冪等、同時再試行の競合、appending の取り残し、リロードで冪等キー消失。最終形は **message_id（冪等キー）＋ 条件付き UPDATE の claim ＋ append_started_at のリース**の3点セット
2. **静かな誤記入** — 解析のレース、targetGrades=null による全シート重複記入、同一級の複数シート割当、未検証 CellMap（F12→F1212・後勝ち上書き）、表外への記入、ヘッダ欄の既存値上書き
3. **行き止まり** — AI 推定失敗からの復帰不能、会員0名で空の申込書、履歴保存前の例外、会員候補取得失敗を空一覧に倒す
4. **履歴の真実性** — created 先行保存をやめ pending/appending を新設

## 未対応で出荷した項目（ユーザー判断）
- **R8 blocker 1: 再試行時の内容上書き** — 再試行で現在の入力を既存行へ UPDATE するため、「1通目は成功したが応答が失われた」ケースで SEARCH が APPEND を省略し、**Yahoo は旧内容・DB と完了画面は新内容**になる。加えて claim が MIME 検証より前なので、宛先を打ち間違えると5分のリース中は再試行できない。→ 保存済みスナップショットを送る形へ直すのが正しい
- **R8 blocker 2: 段位・出場回数が未検証** — MemberEditSheet が Number() をそのまま保存。1.5 は formatDan の 1..10 判定を通過してラベル表で undefined になり**段位欄が静かに空欄**。負数は -1段 になる。クライアント・Server Action の両方に有限整数＋範囲の検証が要る
- **fixture の実名 PII（R2）** — push 済み blob に残置。リスク受容済み（project_pr399_fixture_pii_accepted.md）。再発防止は fixtures-privacy.test.ts
- **xlsx 展開爆弾（R6）** — mail-worker の既存経路と同じ穴のためプロジェクト横断課題として見送り

R8 blocker 3（結合列と分割列の同時指定で分割列が書かれない）のみ f76c38d で修正済み。

## 残 DoD（出荷後の手作業）
- 本番 web コンテナへ YAHOO_IMAP_HOST/PORT/USER/APP_PASSWORD を追加（compose 変更は PR 同梱・実値は本番 .env へ手作業）
- AC-21: 本番 Yahoo で下書きの宛先・件名・本文・添付 xlsx を実機確認（送信が起きていないことも）
