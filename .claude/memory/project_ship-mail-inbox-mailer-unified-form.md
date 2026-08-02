---
name: ship-mail-inbox-mailer-unified-form
description: mail-inbox-mailer 統合処理フォーム 出荷
type: project
---

PR #447 「mail-inbox-mailer: メール詳細の処理導線を統合フォーム化する」を出荷。
URL: https://github.com/poponta2020/kagetra_new/pull/447 / merge commit 88dda62 / 2026-08-02

## 出荷内容
メール詳細（/admin/mail-inbox/mail/[id]）の処理エリアを「種別 → 対象の大会 → 実行」の1フォームへ統合。全6タスク・7コミット + レビュー修正3コミット。

- 手動種別 mail_kind（未選択/大会案内/申込名簿/確定名簿）を新設。一覧・詳細の区分ピルも classification から差し替え
- 対象の大会は**申込グループ単位で1回だけ**選ぶ。代表イベントを linked_event_id に入れる（carrier は据え置き＝EventRelatedMails 無改修で AC-27 を満たす）
- AI 抽出は種別=大会案内 のときだけ露出
- LINE 配信の可否＋本文添付の可否を選択可能に。include_body を監査行へ永続化して再送で同じ列を再現
- LINE 未紐付けグループでは配信を選べなくして理由を表示（従来は黙ってスキップ）
- 名簿は複数添付を1トランザクションで一括採用（部分採用を残さない）。級ゼロ選択＝グループ統一
- 「未処理に戻す」で種別・紐付け・そのメール由来の名簿採用をまとめて取消
- migration 0055（mail_kind enum / mail_messages.mail_kind / event_broadcast_messages.include_body）

## クローズした Issue
親 #440 / 子 #441-446（すべて CLOSED）

## レビュー（auto-review-loop）
- **3R（initial 1 + delta 2）・result=token-budget で中断**（累計 528,238 / 上限 500,000）
- effort 推移: high（sol・構造的高リスクパス）→ medium（terra）→ medium（terra）
- 修正した指摘 4件: 団体戦グループのサーバー検証漏れ / 遅延LINE配信が取り消し後も走る / その再検証が処理世代を識別しない / 世代トークンの Date 変換でマイクロ秒が丸められる
- ユーザー判断の WONTFIX 3件: undo の削除範囲（要件どおり）・AI排他（**誤検知**: cron は llmExtractor を渡さない）・carrier 設計（手順書で決定済み）
- ★**再レビューしていない修正が 1 件ある**: cab8550（triaged_at::text の文字列比較）。R4 が予算で開始できず、ユーザーがレビュー打ち切りと出荷を指示。テスト162件green・typecheck/lint green だが Codex 未検証。**CI が赤くなったらここが第一容疑**
- DoD: C1 を --override で承認して通過（他は PASS/SKIP）。CI は pending のままマージ

## 残 DoD
- **AC-33（manual）**: 本番で4パターン（大会案内 / 申込名簿 / 確定名簿 / 未選択＋配信あり・なし）を1通ずつ実行して意図どおり動くか確認
- **375px 実機での横スクロール有無・添付名の折り返し**（コード照合では判定不能・未確認）
- 本番 migration 0055 の適用（db:migrate。デプロイで自動）

## 後片付け（未完）
worktree C:/tmp/impl-mail-inbox-mailer の削除に失敗（未追跡ファイル残存）。ローカルブランチ feature/mail-inbox-mailer も残っている。手動掃除:
  bash "C:/Users/popon/.claude/plugins/cache/claude-devflow/devflow/0.19.0/scripts/remove-worktree.sh" C:/tmp/impl-mail-inbox-mailer
  git branch -D feature/mail-inbox-mailer
★node_modules のシンボリックリンク 2,180 件は ship-finalize が既に外しているので、この worktree を使い続けるなら pnpm install で張り直しが要る。
