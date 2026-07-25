---
name: feature-def-entry-overdue-alert
description: entry-overdue-alert 要件定義
type: project
---

# entry-overdue-alert 要件定義（2026-07-25）

`event-lifecycle-notify` の delta。同機能 requirements §7 で範囲外にしていた「締切超過後の継続催促（毎朝送信）」「管理者専用グループへの出し分け」を反転する。

## 決めたこと（設計判断と理由）

- **宛先＝管理者個人 LINE（system_notify Bot / line_channels.status='system'）**。既存リマインドは `event_line_broadcasts.status='linked'` が必須で、グループ未紐付けの大会には 1 通も飛ばない。申込漏れが一番起きやすいのがまさにその大会なので、グループ経路に載せると機能が成立しない。AC-5 で「未紐付けでも飛ぶ」を明示。
- **once-ever 機構を使わない**。`event_lifecycle_notifications` の `UNIQUE(eventId,type)` は「生涯1回」保証で、毎日鳴る要件と構造的に真逆。enum に型を足して再送を作り込むより、通知ログを持たない別経路にする。
- **対象条件4つ**: 非cancelled ／ event_date >= 今日 ／ entry_status='not_applied' ／ COALESCE(internal_deadline, entry_deadline) < 今日（JST）。締切当日はまだ鳴らず、超過した翌日から。会内締切は手入力（AI抽出対象外）で未入力が起きるため entry_deadline で代替する。開催日経過を停止条件に入れないと過去大会が永久に鳴る。
- **1日1通のサマリ**（0件なら送らない）。上位5件＋「他N件」は既存 buildNewDraftsMessage の形式を踏襲。各行に大会名/会内締切と超過日数/申込締切と残日数/参加人数/`{PUBLIC_BASE_URL}/events/{id}` の絶対URL。
- **配信は JST 07:00 の新規 systemd タイマー**。既存 lifecycle-reminders（00:00）に相乗りすると管理者の端末が毎日深夜に鳴る。
- **「申し込まない」は entry_status の3値目 `not_applying`**（別フラグにしない）。既存 send-lifecycle-reminders が `entry_status='not_applied'` で絞っているため、3値目にすれば見送った大会が既存の申込締切リマインドからも**自動で外れる**。この依存があるので、当該条件を「applied 以外」に緩めてはならない。
- **「申し込まない」＝申込者がいないので申し込まない**（会内締切後にしか下せない終端判断）。押下で `/events` 一覧から消える（`/events-archive` は従来どおり）。復帰は詳細URL直叩きのみ（専用管理一覧は作らない）。設定・解除で LINE 通知は一切なし。`not_applying → applied` の**直接遷移は UI に用意しない**（必ず not_applied を経由する2ステップ）。よって `setEntryApplied` の UPDATE ガード（`WHERE entry_status='not_applied'`）は**変更しない** — 緩める案は dead code になるため撤回。
- **push は apps/web に自己完結モジュール新設**（mail-worker の pushSystemNotification は再利用しない）。`@kagetra/mail-worker` の exports に `./notify/line` が無く、追加すると @line/bot-sdk が web の依存グラフに入る。web の既存3モジュールは全て raw fetch で自己完結（line-broadcast-guidelines.ts が明示的にその方針）。
- **失敗ポリシーの適用順序を固定**: 抽出→0件なら正常終了→チャネル解決（未設定は警告+スキップ・exit 0）→PUBLIC_BASE_URL 解決（未設定は例外・exit 1）→文面→push。逆順だと未構成の環境で毎朝 exit 1 が出る。
- **AC-10 は構造アサーション**で書く（push 2回 かつ event_lifecycle_notifications の行数 0）。`today` 注入だけのテストは、後から抑止用の永続層が足されても通ってしまい無意味。
- **UI は /design-screen を回さない**（ユーザー合意）。ピルは `not_applying`=tone info「申込なし」＋支払いピル非表示、「申し込まない」押下時のみ window.confirm。

## Non-goal（重要）
出欠回答者0名からの自動判定はしない。移行過渡期で参加予定者が必ずしも出欠登録しないため、当面は管理者の手動判断。将来の拡張点。

## 成果物
- 要件定義: docs/features/entry-overdue-alert/requirements.md（AC 22件 = auto-test 21 / manual 1。うち回帰AC 3件 = 既存6種リマインド / once-ever / 出欠ロック）
- 実装手順書: docs/features/entry-overdue-alert/implementation-plan.md（6タスク・4 Wave）
- 親Issue #305 / 子 #306(schema・main担当) #307(アラートlib) #308(進行管理3状態化) #309(一覧除外) #310(バッチ+systemd) #311(docs)
- Wave1=#306単独先行 / Wave2=#307,#308,#309並行 / Wave3=#310 / Wave4=#311
- **未コミット**: docs は untracked のまま。/implement の worktree 作成直後に存在確認→cp+commit が必要。
