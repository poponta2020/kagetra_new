---
name: fix-pr447
description: fix PR #447
type: project
---

PR #447（mail-inbox-mailer 統合処理フォーム）の Codex レビュー指摘に対する修正。ブランチ feature/mail-inbox-mailer・worktree C:/tmp/impl-mail-inbox-mailer。修正コミット 19522dc。

## 対応した指摘（CRITICAL 2件）
- **名簿種別でも団体戦のみのグループをサーバーが受理する**（actions.ts / processMail）: グループ検証の select に events.kind を追加し、名簿種別では「個人戦 ∧ 非cancelled ∧ cutoff以降」を**同一の event 行が同時に満たす**ことを要求。★採用添付ゼロだと adoptRosterFileTx の個人戦検証が走らないため、Server Action 直叩き・画面表示後のイベント移動で団体戦のみのグループへ名簿種別が確定し得た
- **取り消し後でも遅延LINE配信が実行される**（actions.ts / processMail の after）: push 直前にメールを読み直し、triage_status='processed' かつ linked_event_id が配信先と一致する場合だけ配信する。LINE は送信後に取り消せないため。outbox 方式（Codex 推奨）ではなく軽量版をユーザーが選択

回帰テスト4件追加。

## 対応しなかった指摘（WONTFIX 3件・すべてユーザー判断）
- **undoTriage が今回の処理と無関係な名簿採用まで削除する** → 見送り。要件 §3.2.6 の文言（「そのメール由来の名簿採用をまとめて取り消す」）どおりの実装で、操作者の直感とも一致。処理世代ID導入は schema 追加＋要件範囲外
- **自動AI処理中にドラフト未作成の時間帯を排他できていない** → **誤検知**。根拠の runAiPhase（status='ai_processing' を先に立てて後でドラフト作成）は fetch cron から呼ばれない。apps/mail-worker/src/index.ts:130 が llmExtractor を `flags.mode === 'extract' && flags.mockLlm` のときしか渡さず cron AI は廃止済み。現存 AI 経路は manual_extract のみで、ドラフト行は triggerExtractDraft がジョブ enqueue と同一 tx で先に作る
- **申込グループの帰属を可変な代表イベントFKだけで保持している** → 見送り。実装手順書で決定済みの設計判断（carrier は linked_event_id のまま／EventRelatedMails を無改修で AC-27 を満たすため）。linked_entry_group_id 追加は schema 変更＋広範な改修で AC-27 にも触れる。処理済みメールを持つイベントの申込グループ移動という稀な操作でのみ崩れる

## テスト
mail-inbox actions 161件 green。web typecheck・対象 eslint green。

## 罠
after() コールバックの先頭に await（状態の読み直し）が入ったことで、broadcastMailToEvent の spy 呼び出しが同期的でなくなり既存テスト1件が落ちた。afterMock が返す Promise を掴んで await する形に修正（`let afterPromise: void | Promise<void> = undefined` — 初期化しないと TS2454）。
