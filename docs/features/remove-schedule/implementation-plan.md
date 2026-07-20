---
status: completed
---
# 予定機能の廃止 実装計画

### タスク 1: UI・導線・ルートの撤去

- [x] 下部ナビゲーションとダッシュボードから予定を削除し、ユニットテストで予定タブがないことを確認する。
- [x] `apps/web/src/app/(app)/schedule/` の全ページを削除する。
- [x] 旧 `/schedule` URL が 404 になることを E2E またはルーティング検証で確認する。
- **対応 AC:** AC-1, AC-2

### タスク 2: アプリコードと legacy DB の整理

- [x] 予定フォーム schema と会員削除時の `scheduleItems.ownerId` 参照チェックを削除し、会員削除テストを更新する。
- [x] DB テーブル・enum は legacy と明示し、今回の migration では削除しない。生成される migration を確認し、意図しない DROP が含まれないことを確認する。
- [x] 第2段階の runbook を残す: DB backup の復元確認 → 旧アプリ停止／メンテナンス → `DROP TABLE schedule_items` → `DROP TYPE schedule_kind` → DB 確認。DROP 後は旧バージョンへロールバックしない。
- **対応 AC:** AC-4, AC-5

### タスク 3: 現行ドキュメントの同期

- [x] `docs/SPECIFICATION.md`、`docs/spec/schedule.md`、`docs/spec/events-attendance.md`、`docs/spec/ui-shell.md`、`docs/spec/auth-admin.md`、DB 設計、`apps/web/CLAUDE.md`、運用チェックリストを更新する。
- [x] デザインシステムと UI kit の現在の下部ナビ例から予定を削除する。履歴文書は変更しない。
- **対応 AC:** AC-6

### タスク 4: 回帰確認

- [x] Web／shared の関連テスト、lint、typecheck を実行する。
- [x] `event_attendances` を含む大会機能に予定依存がないことを確認する。
- **対応 AC:** AC-3, AC-7

## Wave

Wave 1: タスク 1〜3 を一つのコード変更として実施する。Wave 2: タスク 4 を実施する。

## 検証メモ

- 変更対象の Web テスト（`bottom-nav.test.tsx` 14件、会員編集 action 39件）と shared テスト 19件、lint、typecheck は通過した。
- Web 全体スイートは Node の worker が `ERR_IPC_CHANNEL_CLOSED` で終了した。既定ヒープでは OOM も再現し、4GB へ拡張しても同じ worker 終了となった。変更対象のテストは個別に成功している。
