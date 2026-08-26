---
name: ship-admin-attendance-edit
description: 大会編集画面で管理者が参加者を追加・削除
type: project
---

PR #549 [feat(web): 大会編集画面で管理者が参加者を追加・削除できるようにする](https://github.com/poponta2020/kagetra_new/pull/549) — **merged**（2026-08-26 / merge commit 4369d0e）。

## 何を出荷したか
`/events/[id]/edit` に「参加者」セクションを新設し、管理者・副管理者が任意ロール（一般会員・ゲスト・管理者・副管理者）の対象ユーザーを参加者として追加・削除できるようにした。スキーマ変更なし。

- `apps/web/src/lib/events/eligible-users.ts`（新規）— `eligibleUsersWhere`。「出欠の対象ユーザー」の where（`isInvited=true` ∩ 対象級）の**唯一の定義**。詳細ページの分母・追加時の検証・編集画面の候補の3箇所が同じ1本を通る
- `apps/web/src/lib/events/attendance-edit.ts`（新規）— `loadAttendanceEditData`。参加者＝`attend=true` 全行（`outOfScope` フラグ付き）／候補＝対象ユーザー − 参加済み。列は id/name/grade/role のみ
- `adminAddAttendee` / `adminRemoveAttendee`（`events/[id]/actions.ts`）
- `apps/web/src/components/events/attendance-edit-section.tsx`（新規・client）— EventForm の外の独立セクション。保存ボタンとは独立して即時確定
- `docs/spec/events-attendance.md` 4箇所 in-place 更新 ＋ `docs/features/INDEX.md`

## ★設計上の非対称（レビューでも指摘されない前提として明記）
- **追加は候補条件を SQL の WHERE に載せて users を引き直す fail-closed 検証**（TS 側に等価な述語を作らない。級未設定の除外は `IN` vs NULL の SQL 意味論に依存するため書き直すと必ずずれる）
- **削除は候補条件を検証しない**。対象級外・`isInvited=false` の stale な `attend=true` 行を消せるようにするのがこの画面の役目で、検証を掛けると永久に消せなくなる
- **upsert の `set` に `comment` を含めない**＝「不参加」回答済み行を追加しても本人コメントが残る
- 削除＝行削除で「未回答」に戻す（`attend=false` の代理登録は作らない）

## クローズした Issue
親 #545 / 子 #546（Server Actions）・#547（UI）・#548（docs）

## レビュー
auto-review-loop **1ラウンドで pass**（initial のみ・final 省略）。gpt-5.6-sol / effort=medium（差分1049行で high 判定 → sol 較正のサイズ起因 high は medium へ降格）。blockers 0 / should_fix 0 / nits 0 / good_points 5。累計 226,032 トークン。**「修正したが再レビューしていない指摘」はゼロ**（/fix 呼び出しなし・打ち切りなし・WONTFIX なし）。

## 検証
worktree で 96件 green（admin-attendance-actions 19 / attendance-edit 8 / attendance-edit-section 7 / page-padding 15 / page.test.tsx 47 回帰）。対象ファイルの eslint・`tsc --noEmit` clean。**CI pending のままマージ**（v0.9.0 方針。赤になったら /quickfix で追修正）。

## ★残 DoD: AC-10（本番実機確認）— 未消化
消化手順（本番 https://new.hokudaicarta.com で管理者ログイン後）:
1. 任意の未来大会の `/events/{id}/edit` を開き、「参加者」セクションが EventForm の下に出ることを確認
2. 候補リストから会員を1人「追加」→ その場で参加者一覧に載る（保存ボタンは押さない）
3. `/events/{id}` の参加者欄・`/events` の苗字列・`/dashboard` の出場タイムラインに反映されることを確認
4. 編集画面へ戻り「削除」→ 参加者から消え、詳細ページからも消える（＝未回答に戻る）
不具合があれば /quickfix または /bug-report。

## 引っかかった運用点
- メイン作業ディレクトリに `docs/features/admin-attendance-edit/{requirements,implementation-plan}.md` が**未追跡のまま残っていた**ため、マージ後の `git merge --ff-only` が「untracked working tree files would be overwritten」で中断した。ローカル版は実装前のスナップショット（チェックボックス未消化）だったので削除して ff 更新した。`docs/features/INDEX.md` の未コミット行（主要領域: 未定）も branch 側の完全版に置き換わるので事前に破棄した。**/define-feature の成果物が untracked のまま残る既知の罠（[[feature_define_feature_docs_uncommitted]]）が ship 側でも顔を出す**

関連: [[project_admin_attendance_edit_def]] [[impl-admin-attendance-edit-task1]] [[impl-admin-attendance-edit-task2-3]] [[auto-review-round-pr549]]
