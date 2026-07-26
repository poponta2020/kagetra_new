---
name: ship-event-grade-group-broadcast
description: 新規大会の概要を級別LINEグループへ自動配信
type: project
---

# event-grade-group-broadcast 出荷（2026-07-26）

**shipped: PR #321** — https://github.com/poponta2020/kagetra_new/pull/321
merge commit 78a26cb。親 Issue #313 クローズ、子 #314-319 は closing keyword で自動クローズ。
migration **0044**（`0044_busy_tombstone.sql`）。

## 出荷したもの

新規大会の概要を級別 LINE グループ（A〜E）へ Messaging API Push で自動配信する。既存の大会別グループ配信（`event-line-broadcast`）とは読み手が違う（あちらは申込者、こちらは会員全体）ため置き換えず併存。

- 新テーブル `line_grade_group_bindings`（級⇔グループの**常設**紐付け。grade UNIQUE / line_channel_id UNIQUE）と `event_grade_broadcasts`（`(大会,級)` 送信記録）
- `line_channel_purpose` に `grade_broadcast` を追加し、既存30プールから5個を招待コード発行時に転換（転換時に status もプールから外す）
- webhook はチャネルの purpose で振り分け（1チャネル=1purpose で排他を構造保証）。級グループ用は専用ハンドラ
- `/admin/line-grade-groups`（**admin のみ**。導線は `/admin/line-channels` 内のリンク＝ボトムナビは6タブ埋まりのため）
- トリガーは承認・手動作成・再送ボタンの3経路。編集経路には配線しない

## DoD: C1 を `--skip-dod` でスキップして出荷（ユーザー明示指示）

- A1 テスト PASS / A2 lint PASS / A3 typecheck PASS / **B1 CI PASS（全チェック green）** / D1 PASS
- **C1 FAIL**: 最終レビュー verdict が pass ではない（R7 をユーザー判断で打ち切り）。ただし **R6 は blockers=0** で、R6 の should_fix 2件も修正済み（38aa441）。実質的な未対応指摘なしと判断してユーザーが出荷を指示
- **D2 FAIL は誤検出**（ゲート実行時の PR 差分取得が古く docs 変更を拾えなかった。同ロジックを手元で再現すると docs_hit=1）

## レビュー: 7ラウンド回し全21指摘に対応（累計 ~1.5M tokens・effort=high×全ラウンド）

★**同一テーマ（二重配信／サイレントな配信欠落）が5ラウンド連続で形を変えて出た。** 外部 API 送信と DB 確定の間の障害は1回のレビューでは詰めきれないという実例。順に:
1. R1: catch が受理済み claim を消す
2. R2: retry key をその場の claim 行集合から導出（部分再送で別キーになる）
3. R3: timeout/5xx を失敗扱いにして claim を削除
4. R4: 部分再送でバッチ構成が変わり、残りが 409 で「送っていないのに送信済み」
5. R5: 並行プロセスがバッチを分け取り、部分本文を同じキーで送る

**結論として採った設計**: retry key は **claim 行に永続化して一度決めたら変えない**／再試行時は同一キーの未送信行を全て呼び戻して**元バッチを復元**し、**全件 claim できなければ1件も送らない**／push 結末は accepted/failed/**unknown** の3値で、unknown では claim と key を残す／確定・取消は claimed_at 一致の **ownership CAS**／retry key の **24h TTL** 超過は自動再送せず管理者へ「配信結果不明」通知。

## 残タスク（出荷後）

- **AC-26 / AC-27 は実機確認が必要**（未実施）
- 運用手順: `/admin/line-grade-groups` で A〜E の招待コード発行 → 各級グループへ Bot 招待 → 6桁コード発言で紐付け確定 → テスト大会1件で文面と要綱 URL を確認
- 本番 migration 0044 の適用が必要（`pnpm db:migrate`。**`db:push` は使わない**）

正典: docs/features/event-grade-group-broadcast/ / docs/spec/notifications.md
