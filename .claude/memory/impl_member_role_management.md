---
name: impl-member-role-management
description: member-role-management 実装
type: project
---

# member-role-management 実装（全4タスク）

worktree: C:/tmp/impl-member-role-management（feature/member-role-management）。委譲なし＝全タスク main 直実装（規模が小さく、認可ロジックの新設でコンテキスト分離の価値が低いと判断）。

## 実装内容

- **タスク1 #451** `updateMemberRole`（apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts に追記）。認可は `session.user.role === 'admin'` を関数内で直接判定（assertAdminSession は vice_admin を通すので不使用）。拒否は自分自身／未紐付けの昇格／退会済みの昇格／有効 admin が 0 人になる変更。単一 tx で「有効 admin 集合 FOR UPDATE → 対象行 FOR UPDATE」の順にロック。テスト actions.role.test.ts（20件 green）
- **タスク2 #452** member-role-section.tsx（client）+ edit/page.tsx へ admin 限定で組込み。テスト 11件 + page.test.tsx 3件 green
- **タスク3 #453** 会員一覧のロール列を roleViewLabel に。テスト1件 green
- **タスク4 #454** docs/spec/auth-admin.md を5箇所更新

## 実装中の発見・注意点

- ★**「最後の管理者の降格」は自己変更禁止によって構造的に到達不能**: 実行者自身が有効 admin である以上、他人を降格しても 0 人にならない。残した 0 人ガードは多重防御（将来自己降格が解禁されても効く）。AC-13 のテストは自己降格経路で拒否を確認している
- worktree に node_modules が無く `pnpm install`（約1分）が必要だった。.env.local のコピーも必須
- vitest のファイルフィルタは**正規表現でなく部分文字列**。`"a|b"` は No test files found になる（2回に分けて実行）
- 一覧テストで `container.textContent` に対する `/\badmin\b/` 検査は、seed の会員名（admin-list-1）に引っかかって偽陽性になった → ロール列セルだけを見る形に修正

## 検証

- 新規テスト計 35件 green（actions.role 20 / member-role-section 11 / edit page 3 / members page 1）
- `pnpm check-types` 4パッケージ green・変更ファイルの eslint clean
- フルスイートは未実行（CI に委譲）
