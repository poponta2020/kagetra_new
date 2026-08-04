---
name: feature-def-member-role-management
description: member-role-management 要件定義
type: project
---

# member-role-management 要件定義

管理者が会員のロール（admin / vice_admin / member）をアプリ画面から付与・剥奪する機能。親Issue #450 / 子 #451-454。正典= docs/features/member-role-management/。

## 主要な設計判断

- **admin 限定**（vice_admin は不可）。既存 `assertAdminSession()` は vice_admin を通すので**流用しない** — 流用すると副管理者が自分を管理者に昇格でき RBAC 3層が崩れる。同画面の `unlinkLine`（admin 限定）と同じ扱い。
- **認可は実効ロール `session.user.role`**（realRole は使わない）。role-preview-switch で会員ビュー中の管理者はロール変更できない＝プレビューの意味が保たれる。
- ★**未紐付け行の昇格を禁止**した理由: `/self-identify` の候補は「LINE 未紐付け ∧ 招待済み」だけで絞り role を見ていない（apps/web/src/app/self-identify/page.tsx）。未紐付けの admin 行を作ると招待リンクを開いた第三者がその行を名乗って管理者になれる。入口側で塞ぎ認証フローは触らない。
- **自分自身のロール変更を禁止**。誤操作で管理権限を失うと DB 直接操作でしか復旧できない。見え方の確認は role-preview-switch があるので本物のロールを下げる必要がない。結果として「最後の管理者の降格」は構造的にほぼ起こりえないが、多重防御として「有効な admin が 0 人になる変更の拒否」も別ガードで持つ（有効＝`deactivated_at IS NULL`。退会済み管理者はログイン不可なので数に入れない）。
- **退会済みは降格のみ許可**（昇格禁止）。役職者が退会したときの後始末に使う。
- **監査ログは持たない**（Non-goal）。テーブル追加＝マイグレーションを回避でき、実質1人管理者で追跡価値が低い。
- マイグレーション不要（user_role enum・users.role 列とも既存）。
- **AC-17（再ログイン不要で反映）は既存テストで担保済み** — apps/web/src/lib/node-jwt-callback.test.ts の「DB で降格された管理者は token.role が DB 値へ同期される」。毎リクエスト DB 照合があるため新規テスト不要。

## 調査で判明した既存のズレ

- `apps/web/src/lib/role-label.ts` の `roleLabel()` は **どこからも使われていない**（テストのみ）のに、docs/spec/auth-admin.md は「一覧・編集のラベルを担う」と書いている。表示語彙は `role-preview.ts` の `roleViewLabel()`（管理者/副管理者/一般会員）に統一し、spec の記述をタスク4で実態に合わせる。role-label.ts 自体は触らない（統合はスコープ外）。

## AC

24件・全て auto-test（verify/manual ゼロ）。認可4系統・成功3系統・拒否6系統・冪等2件・revalidatePath・UI4件・回帰3件。

## タスクと Wave

Wave1: #451 Server Action + DBテスト / #453 一覧の日本語ラベル（ファイル直交）
Wave2: #452 ロールセクション UI（#451 に依存）
Wave3: #454 docs/spec/auth-admin.md 更新
