---
name: project-broadcast-lead-message
description: 既存大会LINE配信に冒頭テキスト(見出し)を任意追加。PR #155 merge済 SHIPPED
metadata: 
  node_type: memory
  type: project
  originSessionId: d14e5951-98e7-4e18-9a0b-ae79c61ab0d8
---

既存大会へメールを紐付けて LINE 配信する際、LINE BOT からの冒頭テキスト（見出し、例「抽選結果が出ました！」）を任意で先頭に1通付ける機能。現状は本文画像→添付リンクのみで「何の連絡か」が伝わらない問題への対応（2026-06-17 定義）。

**確定した設計判断（非自明な点）:**
- 適用範囲は手動の `linkMailToEvent`（既存イベント紐付け）のみ。AI下書き自動配信（approveDraft等）・訂正下書き紐付け（linkDraftToEvent）は対象外＝leadText を渡さず挙動不変。新規案内は本文自体が案内なので冒頭テキストは冗長
- 入力は「プリセット＋自由入力」。プリセットはコード固定定数（`apps/web/src/lib/broadcast-lead-presets.ts`、DB管理＋CRUD画面は身内アプリには過剰）。UIはチップ→編集可能欄に流し込む1フィールド構成
- `event_broadcast_messages` に `lead_text`(text/null) と `sent_lead_count`(int default 0) を追加。`manualBroadcast` 再配信は保存済み `lead_text` を監査行から継承して再送（既存の isCorrection 継承と同じパターン）。`sent_lead_count` を分離するのは partial 再送の skip 計算・監査の明瞭さのため（既存も role 別カウントを分離）
- 任意（trim後1〜200字、空はスキップで既存挙動完全維持）。送信位置は先頭固定（lead→body→attachment）。migration は 0025

**成果物:** docs/features/broadcast-lead-message/{requirements,implementation-plan}.md（両方 status: completed）
**Issue:** 親 #148、子 #149(schema)/#150(presets)/#151(broadcast中核)/#152(linkMailToEvent)/#153(manualBroadcast)/#154(UI)。実装順 1→2→3→4→5→6
**状態:** SHIPPED。PR #155 merge `4ff8d8f` (2026-06-17)、親 #148 + 子 #149-154 全クローズ。
- commits: `a7e8b89`(T1 schema/migration 0025)・`b2e8756`(T2 presets定数)・`65c9d10`(T3 broadcast中核: lead先頭固定/保存/role別カウント/partial skip)・`6799f02`(T4 linkMailToEvent 引数+200字validate)・`95df6b1`(T5 manualBroadcast lead継承)・`bb9e662`(T6 ExistingEventLinkSheet 冒頭欄)
- 検証: web vitest 541 passed(1 skip)・shared 4 passed・型 green・lint green。Issue #149-154 は commit Fixes で main マージ時に close（確認済）
- Codex auto-review-loop: **1R で即 pass**（effort=high、blockers/should_fix/nits 全 0、tokens=69,268）。LINE一斉配信+DBスキーマの高リスク2領域を high で見て指摘ゼロ
- 非自明: BroadcastResult/早期return 全てに sentLeadCount 追加・lead は body/attachment 構築前に push して順序固定・空本文+lead は splitForLine('')=[] でプレースホルダ抑制・events/[id]/actions.test の closeTestDb は describe 間二重 end 回避でトップレベル afterAll 化
- **DoD 完了（2026-06-17）**: 本番 migration 0025 適用済（auto-deploy が PR #156 と同時マージで #156 run 側に集約され `APPLY: 0025_broadcast_lead_message` → SUCCESS、web healthcheck 307）。iPhone 実機 LINE 目視もユーザー確認済。**=> 機能完全完了、残作業なし**

関連: LINE配信系の [[impl_event_line_broadcast_task1]] / [[impl_mail_body_as_image]]、抽選日まわりの entry-notify-lottery-treasurer
