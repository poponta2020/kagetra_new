---
name: tournament-title-grade-split
description: 大会名を「場所+級」短縮通称にし開催日ごとにイベント分割する mail-tournament-import 拡張の機能定義（Issue
metadata: 
  node_type: memory
  type: project
  originSessionId: 3fa3384a-c639-4008-8361-3b3b3be732e5
---

`mail-tournament-import`（ship 済み）の AI 抽出仕様・承認フロー拡張。要件定義+実装手順書+Issue を 2026-06-03 に作成。**タスク1(#103 DB+migration)完了・残6/7**。

**目的**: (1) `events.title` を「場所固有名 + 開催級(A→E連結)」の短縮通称に（例: 東大阪ABC / 酒田B）、フルネームは `formal_name` へ。(2) 級ごとに開催日が違う案内を開催日ごと別イベントに自動分割（大阪B 1/11 / 大阪C 1/12）。

**確定方針**: AI が抽出時に開催日ごと自動分割→承認画面で複数イベント案を一括/一部登録。title=短縮/formal=正式（新カラムなし）。新規取り込み分のみ適用（既存リネームせず）。メール取り込み経路のみ（手動 EventForm 対象外）。参加費・締切は級共通コピー/定員は級別。

**非自明な設計判断**:
- **1メール=1ドラフト維持、1ドラフト:Nイベント**。`tournament_drafts.message_id` UNIQUE と既存 UPSERT/再抽出/triage 連動を壊さないため。分割は payload 内の `events[]` 配列で表現
- **`events.tournament_draft_id` + `tournament_draft_unit_key` を新設**（nullable・非破壊）。単一 FK `tournament_drafts.event_id` は訂正版の既存大会紐付け専用に温存
- **title 合成は責務分離**: stem(場所固有名)は AI 抽出、級サフィックスは pipeline で A→E 順連結（決定論化）。`composeTitle(stem, grades)`
- **AI 出力スキーマ破壊的変更**: `extracted`(単一) → `short_name_stem` + `events[]`(EventUnit)。PROMPT_VERSION 2.0.0
- **再抽出ガード**: materialize 済みイベントがあるドラフトは再抽出禁止（payload 作り直しで整合崩壊を防ぐ）
- **LINE 配信重複排除**: 分割イベントが同一グループに紐付くと同じメールが複数回飛ぶため「同一グループへ1回のみ」を必須化（[[impl_event_line_broadcast_task1]] への追加制約）
- **後方互換**: 旧形式 payload は「1単位の配列」に正規化表示、自動再抽出なし
- **部分承認**: per-unit reject カラムを足さず「作成済みイベント有無」で未処理単位を導出、`completeDraft` で残りを作らず閉じる

**Issue**: 親 #102、子 #103(DB+migration)/#104(抽出スキーマ配列化)/#105(プロンプト+title合成)/#106(classifier+fixtures)/#107(承認 Server Actions)/#108(承認UI)/#109(E2E+移行確認)。順序 1→2→3→4→5→6→7（2は1と並行可）。
**docs**: `docs/features/tournament-title-grade-split/{requirements,implementation-plan}.md`

**進捗** (2026-06-03):
- **タスク1 #103 完了** — ブランチ `feature/tournament-title-split`、commit `638fffc`（未マージ）。worktree `C:/tmp/impl-tournament-title-split`。events に `tournament_draft_id`(integer)/`tournament_draft_unit_key`(text) 追加 + migration 0019。
- **実装知見**: FK は events↔tournament_drafts の相互参照が TS 型循環を起こすため、schema に `.references()` を付けず migration の raw ALTER で張った（既存 `tournament_drafts.superseded_by_draft_id` と同方針。snapshot 外だが drizzle はスキーマ外 FK を drop しないので保持される）。relations は **同一テーブルペアに2関係**ができるため `relationName` で区別必須（'eventSourceDraft'=tournament_draft_id 実体側 / 'draftCorrectionEvent'=既存 event_id 訂正紐付け）。
- **検証環境の罠**: dev DB(5433) は 0018 以前の古い状態（14テーブル/events 30列）でローカル不整合。検証は **tmpfs の test DB(5434) を `docker compose rm -sf`→`up --wait` でクリーン化**し、`DATABASE_URL=...5434 db:migrate` で 0000-0019 全適用＋FK が ON DELETE SET NULL で張られたことを pg_constraint で確認。全パッケージ型チェック+vitest 340 passed(web) green。dev DB 最新化は 0014-0018 分含む大きな差分で破壊リスクのため `db:push` はユーザー判断に委ねた。
