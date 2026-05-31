---
name: event-lifecycle-notify-defined
description: event-lifecycle-notify 機能定義完了 (2026-06-01)。Bot を大会ライフサイクル（申込・締切・支払い）通知役に拡張。要件定義+計画+Issue
metadata: 
  node_type: memory
  type: project
  originSessionId: 283181dc-fe0c-41bf-90f5-3063e919d26e
---

# event-lifecycle-notify 機能定義完了 (2026-06-01)

[[impl-event-line-broadcast-deploy]] の延長。LINE Bot を「承認メール転送役」から「大会ライフサイクルの管理・通知役」へ拡張する機能を /define-feature で定義。**要件定義・実装計画・Issue まで完了、実装は未着手**。

**Why:** 申込済か/支払済か/締切はいつか を管理者が手動連絡しており見落としが出る。events には締切・料金の日付/金額カラムはあるが「状態」フィールドが無かった。

**How to apply:** 実装は `/implement event-lifecycle-notify`。詳細は `docs/features/event-lifecycle-notify/requirements.md` と `implementation-plan.md`（リポジトリ内が正）。

## 確定した非自明な設計判断
- **通知先**: 既存の紐付け済み参加者グループ（`event_line_broadcasts.status='linked'`）に集約。未紐付け大会は状態記録のみ・バックフィルなし。
- **支払いは payment_type で分岐**: 事前払い（会が締切までに振込→会レベル「支払済」フラグ＋締切催促）と現地払い（当日各自→「支払済」概念なし、当日持参リマインドのみ）。ユーザー指摘で判明した重要分岐。
- **本締切 = `entry_deadline`**（大会申込締切）。`internal_deadline`（会内＝出欠ロック）は今回対象外。
- **申込/支払状態は会レベル単一フラグ**（会員ごとにしない）。`eventAttendances` とは別レイヤ。
- **リマインドは 3 日前 0:00 ＋ 当日 0:00 の計2回**。締切超過後の毎朝催促はしない。リードタイムは env `EVENT_LIFECYCLE_REMINDER_LEAD_DAYS`（既定3）。
- **once-ever 保証**: 新規 `event_lifecycle_notifications (event_id, type)` UNIQUE。完了通知は初回遷移のみ（再トグルで再送しない）、cron 再実行でも二重送信なし。8 種別。
- **日次バッチ**: 00:00 JST の新規 systemd timer（既存 04:00 cleanup とは別ユニット）。日次バッチ基盤を再利用。
- **push は自前実装（line-broadcast.ts を触らない）**: 並行作業 mail-body-as-image が同ファイル改修中のため衝突回避。単一 text 送信は軽量実装で足り、push 共通化は両ブランチ ship 後にリファクタ（2026-06-01 ユーザー合意）。タスク2 を自己完結化することで順序 1→2→3→4 を維持。
- **文面は固定テンプレ**（編集 UI なし、v2 拡張点）。

## Issue
親 #79 / 子 #80 スキーマ・#81 通知ライブラリ・#82 進行管理UI+完了通知・#83 日次リマインドバッチ。実装順: 80 → 81 →（82・83 順不同）。
