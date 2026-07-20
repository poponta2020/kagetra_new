---
status: completed
design_required: false
completed_sections: [ユーザーストーリー, 変更仕様, Acceptance Criteria, Non-goals, 検証範囲]
next_section: null
---
# 予定機能の廃止 要件定義

## 目的

本アプリを大会運営に特化させるため、練習・会議・懇親会など大会以外の予定を扱う機能を廃止する。大会イベントの参加可否・申込・支払い・進行管理（`event_attendances` を含む）は維持する。

## 変更仕様

- 下部ナビゲーション、ダッシュボード、`/schedule` 配下の一覧・詳細・作成・編集画面および Server Action を削除する。旧 URL は存在しないルートとして扱う。
- 予定用のフォーム定義と、会員削除時の `scheduleItems.ownerId` 参照チェックを削除する。
- アプリケーションから予定データへのアクセスをなくす。DB の `schedule_items` と `schedule_kind` は、旧アプリが停止したことを確認し、復元可能なバックアップを検証した後の第2段階で削除する。
- 第1段階では DB スキーマ定義を legacy として保持し、意図しない schema 差分生成・自動 DROP を防ぐ。利用者画面・API・Server Action はこれを参照しない。
- 現行仕様書は大会特化の提供範囲に更新し、履歴文書（worklog、過去 feature 文書、旧移行計画）は書き換えない。

## Acceptance Criteria

| ID | 受け入れ条件 | 検証方法 |
| --- | --- | --- |
| AC-1 | 下部ナビゲーションとダッシュボードに「予定」または `/schedule` への導線がない。 | auto-test |
| AC-2 | `/schedule`、`/schedule/new`、`/schedule/[id]`、`/schedule/[id]/edit` は画面として提供されず、予定を作成・閲覧・更新するアプリコードがない。 | verify |
| AC-3 | 大会イベントの一覧・詳細・参加可否回答・申込運用は変更前と同様に利用できる。 | auto-test |
| AC-4 | 予定フォームと会員削除時の予定参照チェックがなく、予定 DB オブジェクトは第2段階の migration まで legacy としてのみ残る。 | auto-test |
| AC-5 | 第2段階の DB 削除は、バックアップの復元確認と旧アプリ停止を前提に、`schedule_items` を先に、`schedule_kind` を後に削除する。 | manual |
| AC-6 | 現行仕様書・ルート説明・運用チェックリストは予定機能を提供中と記載しない。 | verify |
| AC-7 | 関連テスト、`pnpm lint`、`pnpm check-types` が成功する。 | auto-test |

## Non-goals

- 大会イベントの出欠回答、申込、支払い、LINE 通知、戦績・統計の仕様変更。
- 予定を `events` に移す、または代替カレンダーを作ること。
- 本番 DB の予定データを、バックアップ・旧アプリ停止の確認なしに削除すること。

## 設計判断

DB migration はアプリ再起動前に実行される運用であるため、予定テーブルを第1段階で DROP すると旧 `/schedule` リクエストが失敗し、ロールバックも安全でなくなる。よって今回のリリースでは利用者向け機能を先に廃止し、物理削除はバックアップとメンテナンス／旧アプリ停止を確認した別リリースで行う。
