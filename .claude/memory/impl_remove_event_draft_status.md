---
name: impl_remove_event_draft_status
description: イベント下書き(draft)廃止 SHIPPED — event_status 3値化。PR#207 merge 888307f。worktree実装+0035→0036リベース
metadata: 
  node_type: memory
  type: project
  originSessionId: d6624530-6d4b-473f-829a-5ffc83f47d17
---

イベント `event_status` を 4値(draft/published/cancelled/done)→**3値(published/cancelled/done)** に縮約し「下書き」概念を廃止。全イベントは published で作成(status コントロールは作成時非表示)、ピルは cancelled=中止/done=終了のみ表示(published/未知/null は非表示)。draft 廃止は機能退行ゼロ(可視性は日付ゲートのみ、機能的に使う status は cancelled だけ)。

**SHIPPED(2026-06-30)**: PR#207 merge `888307f`。`/do-plan`→prepare-pr→auto-review-loop→ship を自律完走。worktree `C:/tmp/impl-remove-event-draft-status`(ship時削除)、土台commit `0560e0d`+Codex R1対応 `8796556`。実装は3 subagent逐次(単一worktree共有=並行編集不可のため)+リベース整合subagent。**本番deploy成功・migration 0036適用済**(f9e9f8e の auto-deploy が888307f分を吸収しbuild+migrate+restart: applied=1/skipped=36・healthcheck 307)。なお888307f の merge CI は flaky(`new-member-form` のフォームreset・共有test DB並列競合 users_name_unique、本PR無関係)で test失敗→deploy skip したが、直後の docs commit f9e9f8e のdeployが e14bb9a→f9e9f8e 差分(=0036含む)を吸収して適用、888307f もrerunでgreen化。

**非自明な経緯**:
- 計画(.claude/plans/2026-06-29-remove-event-draft-status.md)は「次の migration=0035」前提だったが、**実装中に PR #206(invite-register) がマージされ 0035_user_profile_pii を先取り**。ユーザー合意で暫定 0036 採番→#206 マージ後に **origin/main へリベース＋migration 再生成**で整合。
- 衝突は `packages/shared/drizzle/meta/_journal.json` の1ファイルのみ(他ソースは #206 と非重複)。解決=main側で確定→`reset --soft origin/main`で単一コミット化→stale 0036(0034ベースで user PII列を欠く)破棄→`db:generate`で再生成し SQL は手書き text-swap に置換。
- **snapshot 連鎖の検証が肝**: `0036_snapshot.json` の prevId=`aebe44c3…`(=0035 の id)で連鎖、users PII列を含む、journal idx36。0034 id のままなら連鎖破壊=やり直しの基準。
- enum 値削除は PostgreSQL/drizzle で auto-migration が壊れる既知バグ→**手書き text-swap**(DROP DEFAULT→UPDATE draft→published→text化→DROP TYPE→CREATE 3値→USING戻し→SET DEFAULT published)。UPDATE を型変更より前に置く(残存 draft で USING キャスト失敗を防ぐ)。event_status の利用者は events.status のみ=DROP TYPE 安全。
- 検証: 隔離スクラッチ DB でフルチェーン db:migrate(0001→0036)完走＋draft→published 実証、typecheck 4/4・lint・影響テスト170 green(TEST_DATABASE_URL=kagetra_test_draftstatus 隔離・--no-file-parallelism)。

**Codex auto-review 2R で pass**(effort=high): R1 で実欠陥1=**詳細画面 `events/[id]/page.tsx` のステータス行が無条件追加→published で StatusPill が null を返すとラベルだけ値が空の回帰**(計画はリスト/archiveページしか挙げてなかった=詳細を見落とし。`event.status !== 'published'` で条件化して修正)。教訓=**戻り値を null 化したら inline 利用だけでなく label/value 行を組む全箇所を監査**。R1 blocker(enum→text に USING 必須)は実 PG16 では USING 無しでも通る(agent実証)が `USING "status"::text` を防御的に追加(移植性)。R1 nit(status-pill.test の未使用 import `screen`)は**誤検出**=実使用中で却下。R2 で blockers/should_fix/nits ゼロ pass。

**残 DoD**: 実機目視のみ(作成=status コントロール無し・ピル無し→編集で中止/終了→中止解除で通常復帰)。本番deploy+migration 0036適用は確認済。関連: [[project_tournament_entry_rosters_def]] [[project_auto_deploy]] [[feedback_shared_test_db_worktree_push_race]] [[feedback_vitest_no_file_parallelism]] [[feedback_drizzle_kit_push_prompt]]
