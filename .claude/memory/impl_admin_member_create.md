---
name: impl_admin_member_create
description: 管理画面からの新規会員登録（手動追加）+ 誤登録リカバリ（名前編集/削除）。PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ed5165b-5b38-47e8-88b8-40611e385967
---

管理画面からの新規会員登録機能。PR #147 merge `27d6727` (2026-06-16)、親 #140 + 子 #141-145 全クローズ。

- **createMember** (`admin/members/actions.ts`): 名前(trim 1-50字)+級(任意 A-E)のみで INSERT。`role='member'`/`isInvited=true`/`invitedAt=now`/`lineUserId=null` をサーバー側で強制 → 即 self-identify 候補化。23505 はフォームエラー化
- **updateMemberName** (誤登録リカバリ①): 単文 `UPDATE ... WHERE id=? AND line_user_id IS NULL AND role='member'`。紐付け済み/privileged 行/不在は 0 行でエラー
- **deleteMember** (誤登録リカバリ②): tx 内で対象行を `FOR UPDATE` ロック → users.id を FK 参照する 12 カラム/11 テーブルの存在チェック → `DELETE ... WHERE id=? AND line_user_id IS NULL AND role='member'`。CASCADE による出欠履歴の静かな消失を防ぐ fail-safe
- `isUniqueViolation` (23505 + cause 掘り) を `@/lib/db-errors` に共通化し self-identify と共用。DB スキーマ変更なし・migration なし

**Codex auto-review 4R で収束（全て effort=high、累計 547k tokens）**: R1 deleteMember を role=member 限定（vice_admin が admin 行を消せる RBAC 越境）→ R2 参照チェックと DELETE 間の READ COMMITTED race を FOR UPDATE で直列化（[[feedback_admin_delete_for_update_race]]）→ R3 updateMemberName も同じ RBAC 理由で role=member 限定（EditMemberForm の prop を lineLinked→nameEditable 化）→ R4 pass。

残 DoD=本番反映後にスマホ実機で登録→LINE ログイン→self-identify の通し確認。設計の前提は [[project_self_identify_verification_pending]]（本人性検証なし＝身内リスク受容）。
