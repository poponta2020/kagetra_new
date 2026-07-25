---
name: impl-entry-overdue-alert
description: entry-overdue-alert 実装完了(2026-07-25)
type: project
---

entry-overdue-alert 全6タスクを feature/entry-overdue-alert（worktree: C:/tmp/impl-entry-overdue-alert）で実装完了。コミット 7656512(T1) / d39a7ca(T2) / aa764ef(T3) / 5b5290b(T4) / 75759cf(T5) / d16df82(T6)。

## 実装の要点
- migration 0043_entry_status_not_applying: event_entry_status に not_applying を追加（ALTER TYPE ADD VALUE のみ。ロールバック不可）
- apps/web/src/lib/entry-overdue-alert.ts: 会内締切超過の未申込大会を抽出→管理者個人LINE(system_notify)へ1日1通。event_line_broadcasts へ JOIN しない=グループ未紐付けの大会も対象（これが既存リマインドとの決定的な違い）。通知ログ表を構造的に持たない
- apps/web/scripts/send-entry-overdue-alert.ts + systemd 07:00 JST タイマー（既存 lifecycle-reminders の 00:00 に相乗りしない）
- setEntryNotApplying 新規。setEntryApplied の遷移ガードは無変更（not_applying→applied の直接遷移をUIに置かない設計で担保）

## 実装中に判明した注意点（次回のため）
1. **enum を広げると UI 側の狭い union が即座に型エラーになる**: LifecycleStatusBadge の EntryStatus(2値) へ events.entryStatus を渡していたため、タスク1(スキーマ)の時点で events/[id]/page.tsx が赤くなる。union 拡張1行をタスク1に含めてツリーを緑に保った。スキーマ enum 拡張タスクは「UI の型追従1行」まで含めるのが正しい粒度
2. **drizzle の相関サブクエリで sql テンプレートに ${外側テーブル.列} を埋めると、サブクエリ内の同名列と衝突してテーブル修飾子が落ちる**（実測。event_attendances.id と events.id で自己相関になった）。alias を明示し外側参照を raw text にして回避。同型のコードが apps/web/src/lib/players/queries.ts の participationCount にある（未点検）
3. **バッチの main() は today を注入できない**ため、テストの seed は実日付からの相対で作る（固定日付だと開催日が過去になった時点で対象から外れて落ちる）
4. Wave 2（タスク2/3/4）は変更領域の重複なしで並行実装できた。worker_verify は「タスク2のみ自分のテストファイルを実行可・他2つは書くだけ」で運用し、テストDBの drizzle-kit push 競合を回避した
