---
name: feature-def-entry-groups
description: entry-groups（申込グループ）要件定義
type: project
---

# entry-groups（申込グループ）要件定義完了（2026-07-26）

開催日別 events を「同じ案内メール×同じ申込締切」の申込グループで束ね、LINE紐付け・メール配信・名簿・締切リマインド・進行操作をグループ単位へ集約する機能。方向性合意と本番実データ調査は [[project-entry-groups-direction]]（同日）。要件承認済み・design_required: false（既存様式踏襲。/events/[id] は event-detail-redesign の locked design-spec への小さな delta）。

## 主要な設計判断

**要件側**:
- グループ = 締切クラスタ（同 draft × 同 entry_deadline、IS NOT DISTINCT FROM。NULL同士は同一）。backfill と承認フォーム提案で必ず同一規則
- 締切カラム・進行状態(entry_status 等)は events に残す（日別維持）。操作だけ一括: チェックボックス付き伝播ダイアログ（進行トグル+締切系フィールド編集の両方）→通知1通集約
- once-ever claim は (event_id, type) UNIQUE 維持=後追い申込は新規claim分のみ通知
- ~~グループ専用画面なし~~ **★2026-08-20 撤回**（→ project_entry_group_page_def.md / 親Issue #496）。`/admin/entries/[groupId]` を新設し、ボード全行の遷移先をそこへ。AC-15/AC-16/AC-19 も撤回。撤回前の記述: ボード1グループ1カード→代表イベント(今日以降最近)詳細へ。詳細に日リンク（全ロール）
- リマインドは (グループ, 種別, 締切日) 単位1通。会員向け /events 一覧は不変
- 名簿も本機能に含める（ユーザー選択・1つの大きなPR）。表示名は導出（保存しない）

**技術側（deep-advisor 相談済み）**:
- event_line_broadcasts は UNIQUE(entry_group_id) 単純付け替え+行再利用セマンティクス維持。migration に fail-loudly ガード（group内2行で RAISE EXCEPTION）。silent dedupe 禁止
- **migration は Wave に合わせ 0045(T1)/0046(T3)/0047(T8) の3本分割**（1本だと中間コミットがコンパイル不能）。PR は1本
- 空グループ削除は条件付き（events/broadcasts/rosters 全0件のみ）。rosters の新FKは RESTRICT（cascade だと空グループ削除が名簿を道連れ）
- lottery raw SQL (appearance-counts/series-metrics) は EXISTS 書き換え。roster への edition_id 非正規化は禁止（approveDraftUnits の後付け edition 紐付けで stale 化する）
- bulk action 新設+既存単一 action は bulk([id]) ラッパーに縮退（文面互換をテストで固定）。eventIds 昇順ソートでデッドロック回避
- リマインダー claim は INSERT...SELECT ON CONFLICT DO NOTHING RETURNING の1文で原子化。linked INNER JOIN 維持（未linkedはclaimしない）
- T1 は INSERT 全経路+テストシード共通ヘルパー化まで含む（NOT NULL 化の影響）。T3 に release-expired-broadcasts(MAX(event_date)+30日) と broadcastApprovedUnits(distinct group 1回) を明記

**本番事実確認済み（read-only）**: クラスタ単位で broadcasts 高々1行・assigned channel 高々1つ・NULL締切は draft 無し単独のみ → ガード前提クリーン

## AC要約
24件（auto-test 23 / manual 1=本番実機の1通配信確認）。特徴: 部分選択→後追い通知の once-ever 整合(AC-9)、締切相違日の別通分離(AC-12)、lottery-trends 回帰(AC-22)、会員一覧不変(AC-21)

## Issue
親 #359 https://github.com/poponta2020/kagetra_new/issues/359 / 子 #360(T1 schema+0045)〜#367(T8 名簿+0047)

## タスク・Wave
8タスク6Wave: W1=T1(基盤) → W2=T2(lib+編集) → W3=T3(LINE+0046) → W4=T4(一括+通知) → W5=T5/T6/T7並行(リマインド・ボード・承認フォーム=変更領域が互いに素) → W6=T8(名簿+0047)。events/[id]/actions.ts が T3/T4/T8 で競合するため直列

## 実装開始条件（重要）
- **event-detail-redesign 出荷後**に /implement entry-groups（同一画面の二重改修回避）
- event-grade-group-broadcast #313 は本機能の後（mail-inbox 側 rebase。#313 が想定していた migration 0044 は使用済み→振り直し要）
