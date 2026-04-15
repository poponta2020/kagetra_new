---
name: 旧kagetra DBダンプ
description: 旧kagetraのPostgreSQLダンプファイルの場所と用途 — 新機能設計時に旧データ構造を確認するリファレンスとして使用
type: reference
originSessionId: 44b85b5a-b861-47d2-a10c-b0429328e059
---
旧kagetra(PostgreSQL 13)のカスタムダンプが `scripts/migration/dump/myappdb.dump` にある。

**用途**: データ移行用ではなく、旧システムのデータ構造・運用実態を理解するためのリファレンス。新機能の設計・スキーマ定義時に `pg_restore --list` や `pg_restore -s`（スキーマのみ）で旧テーブル構造を確認する。

**テーブル概要（46テーブル）**:
- P1関連: users, user_attribute_*, user_login_*, events, event_*, schedule_*, my_confs
- P2関連: contest_*(classes, games, prizes, teams, users等)
- P4関連: album_*, bbs_*, wiki_*, addr_books, map_bookmarks
- その他: notification_settings, push_subscriptions, schema_info

**How to apply:** 新しいDrizzleスキーマを設計する際、対応する旧テーブルのカラム定義・制約・データの持ち方を確認してから設計する。
