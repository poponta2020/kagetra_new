---
name: feature-def-admin-attendance-edit
description: admin-attendance-edit 要件定義
type: project
---

大会編集画面 /events/[id]/edit に「参加者」セクションを追加し、admin/vice_admin が任意ロール（ゲスト・管理者含む）のユーザーを参加者として追加・削除できるようにする。要件承認済み（2026-08-26）・実装未着手。

主要な設計判断（ユーザー選択）:
- 削除 = event_attendances の行削除で「未回答」に戻す（attend=false の代理登録は作らない。偽の回答データを生まない・誤追加取り消しと同一操作）
- 追加候補 = isInvited=true の全ロール ∩ 対象級内・級未設定は不可（詳細ページの eligibleUsers と同一定義。対象級外を許すと既存の stale 行表示除外フィルタと矛盾し「追加したのに見えない参加者」が生まれるため）
- 本人への LINE 通知なし・監査記録なし・グループ一括操作なし（Non-goals）
- 追加は attend=true の upsert で既存 comment 保持（submitAttendance と同じ条件付き更新規約）。締切後・開催日後も操作可
- design_required: false（管理者専用ユーティリティ画面・既存フォーム規約の範囲）

技術計画: スキーマ変更なし。候補条件を lib/events/eligible-users.ts へ共通化し3箇所（詳細ページ分母・action 検証・編集画面候補）で共有。ローダーは lib/events/attendance-edit.ts。UI は EventForm の外の独立セクション（即時反映・revalidatePath 委せ）。

AC 10件（auto-test 9 / manual 1=本番実機確認）。親 #545、子 #546(Server Actions)/#547(UI)/#548(docs)。タスク3件・Wave は全直列（apps/web 内で変更領域が接するため）。

関連: [[project_entry_groups_def]] [[feature-def-guest-role]]
