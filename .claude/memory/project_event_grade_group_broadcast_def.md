---
name: feature-def-event-grade-group-broadcast
description: event-grade-group-broadcast 要件定義
type: project
---

# event-grade-group-broadcast 要件定義（2026-07-26）

新規大会の概要を級別 LINE グループ（A/B/C/D/E に 1:1、各10名程度）へ Messaging API Push で自動配信する。親Issue #313 / 子Issue #314-319。

## Playwright/OAM 方式を検討して不採用にした経緯（最重要）

当初依頼は「match-tracker の札組配信と同じ仕組み（Playwright で LINE 画面を bot 操作）を kagetra_new にも」。調査の結果**不採用**。

- match-tracker の実体は `line-chat-worker/`（kagetra_new と**同じ Oracle Cloud VM 上の独立 Docker 常駐ワーカー**）。LINE Official Account Manager を Playwright 操作して**「予約送信」を登録するだけ**、実送信は LINE 側。`Enter` は絶対に押さない設計
- あちらが自動操作を選んだ理由: Push はグループ人数分課金。70名 × 月20回 = 1,400通 ≫ 無料枠200通。OAM チャットは無料通数の対象外・無制限
- **1グループに参加できる公式アカウントは1体まで**（match-tracker が Bot 10体ローテ作戦を実装後に発見した制約）
- **不採用の理由**: ユーザーが「級ごとにグループを分ける」方針へ転換 → 1グループ10名程度なら Push で収まる。既存 Bot プール・webhook・push ヘルパーがそのまま使え、kagetra_new 単独で完結。月1回の手動 SSO 再ログインという運用負債も回避

## 主要な設計判断

- **Bot は級ごとに5個**。無料通数枠は**チャネル単位で月200通**。1個を全級共有すると5グループ合計で月20回（10名グループ）で枯渇する。既存30プールから5個を確保し `purpose=grade_broadcast` へ転換（招待コード発行時に同一tx で転換、運用スクリプト不要）
- **即時送信・取消なし**。当初は「30分後に予約→その間取消可」の誤爆ガードを検討したが、Push は取消不可で猶予には DB キュー+タイマーが必要。コストに見合わずユーザーが受容。配信時間帯ガード（8-21時）も同じ理由で落とした
- **常設紐付けは新テーブル `line_grade_group_bindings`**。`event_line_broadcasts` は `event_id` が NOT NULL+UNIQUE+FK RESTRICT で常設を表現できない。`grade` UNIQUE で「1級2グループ不可」を DB 層保証
- **`(event, grade)` 送信記録は新テーブル `event_grade_broadcasts`**（`UNIQUE(event_id, grade)`）。**claim → push → 確定/取消**方式（`INSERT ON CONFLICT DO NOTHING RETURNING` で claim、成功で `sent_at`、失敗なら claim を DELETE）。これで「二重送信なし」と「失敗級は未送信のまま残り後で再送できる」を同時に満たす
- **push 失敗で紐付けを自動解除しない**。既存の大会別配信は 401/4xx で解放するが、あれは一時的紐付けだから成立する。常設で同じことをすると毎回繋ぎ直しになる
- **要綱添付は `events.grade_broadcast_attachment_id`**。既存 `event_broadcast_guideline_attachments` は `event_line_broadcasts` にぶら下がり新規登録時点で親行が無い。FK は `events→mail_attachments→mail_messages→events` の型循環回避で **raw ALTER**（`tournament_draft_id` と同じ既存パターン）
- **webhook は purpose で振り分け**。`loadChannelByDestination` の `purpose` フィルタを2値に広げ、1チャネル=1purpose で排他を構造保証
- 管理者通知は `entry-overdue-alert.ts` の `loadSystemChannel`/`pushSystemText` を再利用（export 済み。既存モジュールはリファクタしない）

## 文面（ユーザー指定）

```
8/15(土) 大阪ABの案内が来ました！
https://…/api/line-broadcast/attachments/{token}

締切 は7/25です。
```
大会名=`events.title`（AI承認なら `composeTitle` で「大阪AB」形式が自動生成済み・系列マスタを辿る必要なし）／日付=既存 `formatEventDate()`／要綱URL=既存 `getOrCreateShareToken()`（無認証・60日TTL）／締切=`internal_deadline`。要綱・締切が無ければ行ごと省略。複数件は区切り線で連結。会内行事も同文面（`events` に大会/行事の判別カラムが無い）。

## AC: 28件（auto-test 25 / verify 1 / manual 1 + 回帰1）

絞り込み・未紐付けスキップ+管理者通知・claim 冪等・級ごと1通集約・文面の欠損分岐・push失敗で紐付け維持・招待コードフロー・admin 限定・既存 event-line-broadcast の回帰。

## Non-goals（後で効く受容事項）

送信後の編集追随なし／**級グループ未加入の会員には届かない（会員100名超に対しグループ計50名程度＝半数近く未到達）**／深夜登録なら深夜に通知／**通数超過は静かに送信不能（自動検知なし・手動対応）**／級未設定の会員は対象外／会内行事と大会の文面出し分けなし。

## タスクと Wave

6タスク。Wave1=#314(スキーマ/migration 0044) → Wave2=#315(配信コア)/#316(webhook)/#317(管理画面)/#319(承認フォーム要綱選択) → Wave3=#318(トリガー配線+再送)。#318 と #319 は `admin/mail-inbox/actions.ts` を共有するため必ず別 Wave。

`design_required: false`（新規管理画面は `/admin/line-channels` の踏襲、承認フォームは1項目追加のみ）。

正典: docs/features/event-grade-group-broadcast/{requirements.md,implementation-plan.md}
