---
name: impl-invite-link-registration-task5
description: invite-link-registration 名簿紐付け タスク5(E2E)
type: project
---

invite-link-registration 改修の Wave 3 = タスク5（#658 E2E）を main が直接実装。コミット 5330d11。worktree=C:/tmp/impl-invite-link-registration。

**変更**: apps/web/e2e/invite-link-registration.spec.ts — seedInvite の発行者に lineUserId を入れて名簿の候補から外し、既存の各級ケースを無変更で通す。同名ケースを AC-11（名簿の候補と同名→誘導文言→『名簿から選ぶ』ボタンで名簿へ）に更新し、紐付け済みと同名の従来文言ケースを別に追加。AC-12 の新規ケース（名簿から選ぶ→所属 ON→学部等→dashboard、既存行に invite_link、行数不変、住所・電話が画面に出ない）。apps/web/e2e/self-identify-flow.spec.ts — 所属 ON（大学院）＋名簿で空の電話を入力して紐付くケースを追加。

**検証**: eslint のみ。E2E はローカル未実行（ユーザー方針でブラウザ自動操作をしない・CI が最終網）。e2e/ は tsconfig の include 外なので check-types の対象外。
