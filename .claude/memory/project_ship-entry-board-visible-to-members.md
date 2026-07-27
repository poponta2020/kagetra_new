---
name: ship-entry-board-visible-to-members
description: 申込管理ボードの閲覧を一般会員へ開放
type: project
---

## 出荷: 申込管理ボードの閲覧を一般会員へ開放（PR #378）

- PR #378 https://github.com/poponta2020/kagetra_new/pull/378 — MERGED（merge commit 1a640e3）
- ブランチ fix/entry-board-visible-to-members（quickfix。Issue なし・ユーザー直依頼）
- 依頼: 「申込管理画面は一般ユーザーにも見えるように。ただし見えるだけ。イベント押下の遷移先は普通の一般ユーザー詳細画面」

### 実装（実コード変更は2箇所だけ）
- `apps/web/src/app/(app)/admin/entries/page.tsx`: role 判定を削除し `!session?.user?.id` の /403 fail-safe のみ残す
- `apps/web/src/components/layout/bottom-nav.tsx`: entries タブの `adminOnly: true` を削除（一般会員5タブ・管理者6タブ。管理者専用タブはメールのみに）
- **read-only 化の作り込みは不要だった**: ボードは元から表示専用で Server Action も mutation も無く、行タップの遷移先は3箇所とも `<Link href={/events/${id}}>`。`/events/[id]` にも role redirect は無く、管理者パネルは isAdmin で出し分け済み
- 表示項目の role 出し分けはしない方針（締切・支払フェーズ・参加希望者数は全員に見える）。URL の /admin/ プレフィックスは据え置き（移設は bottom-nav matches・page-padding.test.ts・docs へ波及するため範囲外）
- docs: spec/ui-shell.md（タブ表・非表示タブ）／spec/events-attendance.md（関連画面・ボードの認可）を更新。features/entry-management/requirements.md は履歴側なので §3・AC-1/AC-2・Non-goals に撤回注記のみ

### レビュー
- Codex 2R（medium→medium）verdict=pass・累計 213,211 トークン。R1 で should_fix 1（未紐付けセッションの遮断テストが無い）+ nit 1（JSDoc）→ 修正 ef7714b → R2 pass
- 詳細は [auto-review-round-pr378](auto-review-round-pr378.md)

### 出荷時に踏んだ環境トラップ
- gate-dod の A1 が **メイン workdir で全滅**。原因は PR ではなく**メイン workdir のテスト DB が entry-groups マージ前のスキーマのまま**で、`drizzle-kit push --force` が列リネーム確認の対話プロンプトを出して非TTYで失敗していた（`Interactive prompts require a TTY terminal`）
- 対処: `kagetra_test_kagetra_new_079523` を DROP → global-setup が再作成 → 1936 passed。**列リネームを含む migration がマージされた後は、各 workdir のテスト DB を一度捨てる**

### DoD
- 全項目 PASS（CI green でマージ）。実機確認は未実施 — 本番で一般会員としてボトムナビに申込管理が出る/ボードが開ける/イベント押下で通常の詳細へ行くことを確認する
