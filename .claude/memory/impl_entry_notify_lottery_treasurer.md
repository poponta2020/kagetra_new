---
name: impl-entry-notify-lottery-treasurer
description: 申込完了通知を 2 通化（参加者向け抽選日追記 + 会計向け振込案内）。PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 6755c672-24d8-4f7c-9912-8052272324ee
---

`event-lifecycle-notify` の **申込完了通知** を、宛先の関心ごとに合わせて 2 通化した拡張。**PR #118 merge `b64f291` (2026-06-06 JST)**、親 #112 + 子 #113-117 全クローズ。Codex auto-review **R1 で pass/0 指摘**（effort=high, tokens 76,005/500,000）、CI green (4m13s)。本番反映は migration 0021 適用 + auto-deploy 待ち、残 DoD=実機 LINE 目視のみ。

**目的**: (1) 参加者向けは `events.lottery_date` 設定時のみ末尾に「抽選日は M/D です」を追記。(2) 会計向け 2 通目 `entry_applied_treasurer` を同じ参加者グループへ送る（振込期限/方法/詳細）。両者は同じ申込完了トリガー（`setEntryApplied(true)` の初回遷移）で同送。

**非自明な設計判断（実装済・コードに反映）**:
- **新ロール/チャネルを作らず参加者グループへ同送**（要件 §6.1 確定）。会計専用ロール/Bot 増やすと運用が重い。同一グループに「💴 会計の方へ」見出しで送り、視覚的に分離するだけで足りる
- **2 通分割（1 通統合にしない）**: 関心ごとが違うため。once-ever も種別ごと独立 (`(event_id, type)` UNIQUE) で個別監査可能
- **会計向けは支払いタイプで出し分けず常に送る**（要件 §6.3 確定）。現地払い・未設定でも最小文面（「参加費の振込手続きをお願いします…」）で送って抜けを作らない
- **金額（`fee_jpy`）は載せない**（要件 §6.4 確定）。会計が振り込むのは集めた総額で、1 人あたり額の併記は計算式（チーム料金・割引）次第で誤解を生む
- **抽選日は手動入力カラム新設、AI 抽出は別 PR**（要件 §5.3 確定）。AI 抽出は title-split マージ後の小 follow-up（mail-worker schema.ts への `lottery_date` 追加 + プロンプト調整）に分離
- **承認画面では抽選日を入力させない**: `extractEventUnitsFormData` は `lotteryDate` を読まず（zod の `optionalDateStr` で undefined→null）、`event-form.tsx` は `embedded` モードでフィールド自体を描画しない。承認直後は NULL、編集画面で後入力
- **2 claim は同一 tx で原子化**: `setEntryApplied(true)` の状態 flip と `claimLifecycleNotification(tx, eventId, 'entry_applied')` + `claimLifecycleNotification(tx, eventId, 'entry_applied_treasurer')` を同一 tx 内で実行。再トグル/並行呼び出しでも UNIQUE で 2 回目以降は claim 失敗
- **2 push はコミット後に独立 try/catch**: 片方の push 失敗（401/4xx 等）で recovery が走ってももう片方の送信成否は独立（要件 §3.2.5）。best-effort（既存方針と一貫、自動再送なし）
- **cancelled は 2 種別とも claim しない**（既存 entry_applied と対称）。状態変更そのものは記録（once-ever スロットは消費しない＝後で復帰させても通知しない方針も一貫）
- **未紐付けは 2 種別とも slot 消費（status=skipped）**（バックフィル防止、既存方針と一貫）。後から linked になっても再送しない
- **会計向け文面の組み立て**: `paymentDeadlineIso` / `paymentMethod` / `paymentInfo` を `trim()` で空白判定し、値ありの行だけ `\n` 連結。全空は固定の最小文面に落ちる
- **exhaustiveness guard 活用**: `LifecycleNotificationType` switch の `default` で `_exhaustive: never` を踏むので、enum に値を足したら branch 漏れがコンパイルエラーになる（このパターンで新ケース漏れを物理的に防ぐ）

**migration 0021 (`0021_amazing_mentor.sql`)**: `ALTER TYPE ... ADD VALUE 'entry_applied_treasurer'` + `ALTER TABLE events ADD COLUMN lottery_date date`（非破壊）。本番は `db:migrate`（journal ベース・非 interactive、`db:push` の interactive prompt 回避は既存 feedback）。

**Codex auto-review**: 1 ラウンド (R1, effort=high) で **pass/0 指摘**。good_points 2 件（2 claim を tx 内で種別ごとに分けつつ push をコミット後独立 try/catch にした構造を評価、機能境界ごとのテスト網羅を評価）。

**docs**: `docs/features/entry-notify-lottery-treasurer/{requirements,implementation-plan}.md`

関連: [[impl_event_lifecycle_notify]]（基盤）, [[project_tournament_title_grade_split]]（並行作業の調整先・解消済）, [[project_codex_review_effort]], [[feedback_drizzle_kit_push_prompt]], [[feedback_windows_worktree_path]]
