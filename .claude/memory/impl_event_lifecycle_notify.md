---
name: impl_event_lifecycle_notify
description: event-lifecycle-notify 実装完了 (4タスク・1PR)。ブランチ・worktree・非自明な実装判断
metadata: 
  node_type: memory
  type: project
  originSessionId: 93c169a0-534d-4126-a2e7-eab90cec6555
---

[[event-lifecycle-notify-defined]] の実装。LINE Bot を大会ライフサイクル（申込/支払い完了通知 + 締切/現地払いリマインド）通知役に拡張。**SHIPPED (2026-06-01): PR #85 merge `42e1cef`、子 #80-83 + 親 #79 クローズ**。

- ブランチ `feature/event-lifecycle-notify` / worktree `C:/tmp/impl-event-lifecycle-notify`（origin/main 派生）。docs/features は main 未追跡だったので feature ブランチに同梱（[[impl_mail_body_as_image]] と同パターン）。
- 4 commits（1タスク=1コミット、子Issue Fixes で 1PR にまとめる）:
  - Task1 #80 `0f273fa`: 5 enum + events 5 カラム + `event_lifecycle_notifications` + migration 0017。packages/shared に **node-env vitest プロジェクトを新設**（従来テスト無し）
  - Task2 #81 `38b7f00`: `apps/web/src/lib/event-lifecycle-notify.ts`（文面8種・自前 push・once-ever claim/finalize/send）
  - Task3 #82 `a3ea88b`: actions（setEntryApplied/setPaymentType/setPaymentPaid）+ EventLifecycleSection/LifecycleStatusBadge + page 配線
  - Task4 #83 `c24b184`: `scripts/send-lifecycle-reminders.ts` + systemd 2ユニット + deploy doc
- 検証: 全monorepo check-types green、turbo test green（apps/web **297** unit、shared 4、E2E 3）、lint clean。test DB は docker postgres-test:5434、`LINE_NOTIFY_DRY_RUN=1` で実 LINE 回避。

## 非自明な実装判断（レビュー時の論点）
- **push は line-broadcast.ts を触らず自前実装**（[[event-lifecycle-notify-defined]] の合意通り）。401→channel disable+revoke / 他4xx→revoke+pool返却 の回復ロジックは line-broadcast から複製（共通化は両ブランチ ship 後）。
- **完了通知の原子性**: 状態 flip（ガード付き UPDATE WHERE status=旧値）と once-ever claim（INSERT ON CONFLICT DO NOTHING）を**同一 tx**で実行し、コミット後に push。push は `await + try/catch`（true fire-and-forget でなく）→ ログ status を正確化＋テスト可能。state は既コミットなので push 失敗で巻き戻さない。
- **未紐付けでも slot を消費**（status='skipped' で記録）→ 後から linked になっても再送しない（バックフィル防止）。
- **event_id 単独 index は作らない**: 複合 UNIQUE(event_id,type) の先頭列でカバー。
- **scripts を type-check / test 対象に編入**: `apps/web/tsconfig.json` と `vitest.config.mts` の include に `scripts` を追加。副作用で従来 orphan だった `seed-initial-admin.test.ts` が復活（5 tests）。これが無いと scripts テストの `@/` エイリアスが vite で解決できない。
- **batch の --dry-run は read-only**（claim も push もしない）→ ops 検証が once-ever slot を消費しない。LINE_NOTIFY_DRY_RUN=1 の実行は slot を消費するので捨て大会でのみ。
- playwright.config に `LINE_NOTIFY_DRY_RUN=1` を追加（E2E が実 LINE を叩かない）。
- 同一テストファイル内で複数 describe が `closeTestDb()` を呼ぶと module-singleton pool が先に閉じて落ちる → ファイルスコープ afterAll 1回に集約。

## レビュー (PR #85, auto-review-loop 4R/high)
- r1: 完了通知の cancelled 除外漏れ(blocker) + payment 型変更時の状態リセット(sf) → 修正
- r2: systemd 相対パス(blocker) は **false-positive**。`pnpm --filter @kagetra/web exec` は cwd=apps/web なので `tsx scripts/...` は解決される（本番稼働中 cleanup.service と同型、--dry-run 実証済）→ 説明コメント追加で対応
- r3↔r4 の矛盾: r3=「型変更で payment_paid ログも消して再通知可能に」(sf) → 実装 → r4=「ログ削除は once-ever 違反」(blocker)。**要件 §6.4(完了通知は (event,type) で永久に一度)を根拠に r4 採用**＝ログは保持し paymentStatus のみリセット。型往復後に再支払済でも表示は paid に戻るが LINE 再通知はしない。**この once-ever-on-type-change 挙動は意図的（将来「再通知したい」要望が来ても安易にログ削除しないこと）**

## Ship / 残作業
- **SHIPPED**: PR #85 merge `42e1cef`。CI が一度赤 → 原因は既存 `event-line-broadcast.spec.ts` の `getByText(/\d{6}/)` が app-bar のユーザー名 `test-user-<uuid>さん`（UUID に 6 桁連続）と 2 要素マッチする **UUID 依存の確率的 flake**（本機能とは無関係）。`/^\d{6}$/` に固定して green 化、同 PR に同梱。子 #80-83 + 親 #79 クローズ。
- **残**: 本番デプロイ `docs/deploy/event-lifecycle-notify.md`（db:migrate → リビルド(static cp) → timer `systemctl enable --now`）。実機 LINE 配信の目視は本番反映後（carryover DoD）。
- 注: ship 実行時、main repo の作業ツリーが `ci/auto-deploy`（ユーザーの並行 WIP: skills/CLAUDE.md 改修、未コミット）に checkout されていた。worklog/memory 同期は隔離 worktree 経由で main に実施し、ユーザーの WT は触らずに復元した。
