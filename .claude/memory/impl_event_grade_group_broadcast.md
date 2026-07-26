---
name: impl-event-grade-group-broadcast
description: event-grade-group-broadcast 実装完了(2026-07-26)
type: project
---

# event-grade-group-broadcast 実装完了（2026-07-26）

親Issue #313 / 子 #314-319 の全6タスク実装済み・PR前。ブランチ `feature/event-grade-group-broadcast`、worktree `C:/tmp/impl-event-grade-group-broadcast`。migration **0044**。

## Wave 構成と委譲

- Wave1 = タスク1（スキーマ）を main 直。Wave2 = タスク2/3/4 を task-implementer 3並行 → 枠が空いた時点でタスク6 を追加投入（profile に `## parallel` 節が無く既定 max_workers=3 のため、計画の「Wave2=4タスク」は3+1にずらした）。Wave3 = タスク5 を main 直（複数レイヤー跨ぎ＋タスク2/6の文脈が必要）
- **web のテストは共有テスト DB を truncateAll() で TRUNCATE するため、並行ワーカーにテストを実行させてはいけない。**「書くだけ、実行は main が Wave 後に直列」と明示して回避した。排他宣言ミス・統合時の不整合はゼロ
- 共有ホットスポット（`test-utils/db.ts` の truncateAll）は委譲前に main が先に更新して衝突を断った

## 計画からの逸脱（3件・いずれも実装時に発見）

1. **`line_channel_id` に UNIQUE 追加**（計画に無し）。大会用は `line_channels.assigned_event_id` の UNIQUE で 1Bot=1用途が保証されるが、級グループには対応列が無く1つの Bot が2級を兼務できてしまう
2. **claim を「リースつき upsert」に変更**。計画の `ON CONFLICT DO NOTHING` だと after() の push 途中でプロセスが落ちたとき `sent_at IS NULL` の claim 行が残り、その (大会,級) が**永久に送信不能**（再送ボタンも静かにスキップ）。`DO UPDATE ... WHERE sent_at IS NULL AND claimed_at < now() - interval '5 minutes'` にした。計画のテストは全て happy path の DELETE を通るのでこの壊れ方は本番でしか出ない
3. **タスク6 の候補ソースを変更**。計画は `loadGuidelineCandidates()` 再利用としていたが、あれは `collectRelatedMailIds(db, eventId)` 経由の **event スコープ**で、承認時点ではまだ event が存在せず使えない。候補は「ドラフトの元メールの添付」（詳細画面が既に読み込み済み）へ。AC-23 は満たすので要件変更ではない

## テストで踏んだ罠（再発しやすい）

- **Node と Docker Postgres に実測 1.4 秒のクロックずれ**がある。リース判定は SQL の `now()` で行うのに、テストが `Date.now() - 2000` で「古い claim」を作ると判定が反転して落ちた。**時刻の基準は必ず DB 側の `now() - interval` で作る**（`impl_mail_worker_clock_drift_draft_subjects` と同じ根）
- 既存 describe と spy を共有していて `mockClear()` を忘れると、`not.toHaveBeenCalled()` が前の describe の呼び出しを拾う。しかも記録済み引数に drizzle の db インスタンスが入るため、失敗時のシリアライズが `Invalid string length` で **26秒**かかる（原因が非常に分かりにくい）
- **web の全スイート一括実行は単一ワーカー累積 OOM で落ちる**（既存の per-file leak・Issue #286）。ファイル単位で個別実行すれば通る

## 権限の罠（AC-22）

`admin/line-channels/actions.ts` と `events/[id]/actions.ts` の `requireAdminSession` は**どちらも vice_admin を通す**。本機能は admin のみなので流用禁止。新規は `requireStrictAdminSession` 等の別名で定義し、テストは必ず **vice_admin が拒否されること**を assert する（member と未ログインだけ見ても壊れたまま通る）。repo 内で唯一の admin-only 前例は `admin/members/[id]/edit/actions.ts`

## 出荷後にユーザーが行う運用手順（AC-26/AC-27）

1. `/admin/line-grade-groups`（導線は `/admin/line-channels` 内のリンク）で A〜E の招待コードを発行 → 既存プールから5個が `grade_broadcast` へ転換される
2. 各級の LINE グループへ友だち追加 URL から Bot を招待 → 6桁コードを発言して紐付け確定
3. テスト大会を1件登録し、文面と要綱 URL が開けることを確認

## 未確認事項

`'use server'` ファイルは非 async の値エクスポートを禁じており（`GRADES` を `grades.ts` へ分離して回避済み）、これは tsc でも vitest でも検出できず**ビルド時にだけ落ちる**。最終確認は CI の build に委ねている。
