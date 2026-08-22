---
name: impl-role-preview-switch-guest
description: role-preview-switch ゲストビュー解禁 実装
type: project
---

role-preview-switch の改修（表示ロールのプレビュー切替に「ゲスト」を追加）をタスク1〜3すべて実装。worktree = C:/tmp/impl-role-preview-switch、ブランチ feature/role-preview-switch（親 #514 / 子 #515-517）。

## 実装の芯
- `selectableRoles(realRole)` が `realRole === 'admin'` のときだけ末尾に `'guest'` を足す。ROLES_HIGH_TO_LOW には入れない（ランク比較に混ぜると guest(0) が全ロールの下に収まり副管理者・一般会員にもゲストが生える）。UI の選択肢生成・切替 Server Action・jwt コールバックの3経路が同じ関数を通るので、admin 限定がそのまま AC-4 / AC-25 の拒否になる。
- `resolveEffectiveRole` の `view === 'guest' && real !== 'admin'` は**冗長ではない**。selectableRoles を通らない `/api/auth/session` 直送りに対する最後の砦。将来の簡素化パスで消されやすい形なのでコメントに明記した。
- `buildRolePreviewSelection` は `current === 'guest'` の除外だけ撤回（ゲストビューからの唯一の復帰導線を塞いでいた）。`real === 'guest'`（本物のゲスト）の null は維持。
- 設定ページはセクション JSX を `RolePreviewSection` ローカルコンポーネントへ抽出し、`buildRolePreviewSelection` の算出をゲスト分岐より前へ移してゲスト分岐と会員/管理者分岐の両方から描画。

## 実装上の発見
- ゲストビュー中の設定「登録情報」は `session.user.id` で DB を引くので**プレビュー中の管理者自身の行**が出る（R7 的に正しい。テストも createAdmin で書いた）。
- 許可リストから外れた admin がゲストビューにいる場合、`!allowed && isPreviewing` の逃がしで `selectable: ['admin']` が残り復帰できる（AC-10b の最悪ケース。テストで固定）。
- middleware は実効ロールしか読まないため、AC-24 のテストは**新しい分岐を検証しない**。将来 realRole/token.role を読むよう書き換えられたら赤くなる回帰網として置いた（報告済み）。
- `(app)/layout.test.tsx` が isGuest と previewRoleLabel を同時に導出する唯一の seam。手順書には無かったが AC-13 / AC-23 の実質的な検証点なので追加した。
- 実装は Wave にせず main が直列で3タスク実施（タスク3はテストのみ・タスク2は1ファイル。委譲オーバーヘッドの方が高い）。

## テスト結果（すべて green）
role-preview / auth-config-callbacks / role-preview-actions = 83、settings/page = 21、middleware+layout+bottom-nav+mobile-shell = 67、周辺（events/[id]・admin/entries/[groupId]・members edit actions.role・node-jwt-callback）= 110。`tsc --noEmit` と変更ファイルの eslint も通過。

## docs 更新
docs/spec/auth-admin.md（切替先の admin 限定・3層防御）、docs/spec/ui-shell.md（ゲスト分岐に表示ロールセクションが加わる）を同一コミットで更新。
