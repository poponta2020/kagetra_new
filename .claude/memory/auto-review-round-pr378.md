---
name: auto-review-round-pr378
description: auto-review PR #378
type: project
---

## auto-review-loop PR #378（申込管理ボードの閲覧を一般会員へ開放）

- pr: 378 / branch: fix/entry-board-visible-to-members
- 総ラウンド: 2 / 10・effort: medium → medium（エスカレーションなし）
- Codex 累計トークン: 213,211 / 500,000

### R1 (medium, verdict=needs_changes)
- blockers 0 / should_fix 1 / nits 1・round_tokens 101,262
- [WARNING] page.test.tsx: 認可境界が `session.user.id` の有無だけになったのに、未紐付けセッション（LINE ログイン済みだが JWT に id なし）の遮断テストが無い → ガードが `!session` に弱まっても検知できない
- [INFO] bottom-nav.tsx: `BottomNavProps.isAdmin` の JSDoc が申込管理を管理者専用としたまま
- 対応: 両方修正（commit ef7714b）。auth モックを直接使って id なしセッションを組み /403 を固定。setAuthSession は id 必須なのでモック直叩きにした

### R2 (medium, verdict=pass)
- blockers 0 / should_fix 0 / nits 0・round_tokens 111,949
- 要旨: 開放範囲は内部会員 ID 持ちセッションのみ、遷移先 /events/[id] の管理機能・LINE 情報・関連メールは既存 role 判定で保護済み、ナビも申込管理のみ全員でメールは非表示

### 学び
- 「role ガードを外す」変更では**残った境界（id の有無）を直接固定するテスト**が指摘対象になる。ガードを緩める PR では境界テストを最初から入れる
