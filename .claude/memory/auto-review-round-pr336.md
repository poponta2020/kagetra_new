---
name: auto-review-round-pr336
description: auto-review PR #336
type: project
---

PR #336 role-preview-switch のレビューラウンド記録。

- R1: effort=high / verdict=needs_changes / blockers=2 should_fix=1 nits=0 / round_tokens=161,110
- R2: effort=high / verdict=pass / blockers=0 should_fix=0 nits=1 / round_tokens=190,345
- cumulative_tokens=351,455 / 500,000・escalated=false（初回から high 判定: 認証パス + 差分>400行）
- nit（実装手順書の記述矛盾）は R2 の pass 後に修正のみ・確認ラウンドなし

## R1 blockers（どちらも本物・修正済み）
1. **Auth.js の `POST /api/auth/session` が許可リストを迂回できた**。このエンドポイント（useSession().update() と同経路）は認証済みクライアントの任意ペイロードを jwt コールバックの trigger='update' 分岐へそのまま渡す。切替 Server Action 側だけに許可リスト判定を置いていたため、リスト外ユーザーが `{user:{viewAsRole:'member'}}` を直接投げてプレビューへ入れた。丸め込みがあるので昇格はできないが fail-closed（AC-1/2/10）が破れる。→ jwt コールバックでも token.id（**token.sub ではない**。LINE の profile.sub は別名前空間）と env で認可し、本物のロール以下を検証。null（解除）だけは常に受け付ける
2. **realRole が DB 降格に追従していなかった**。node-jwt-callback の毎リクエスト DB 照合が role を同期していなかったため、降格された管理者の realRole が古いまま残り降格後も上位の実効ロールを取れた。→ 既に走っているクエリに role 列を足して同期（lineUserId 等と同じ自己修復の枠）。**「既存の穴だからスコープ外」とはしなかった**: 本 PR が realRole を UI の見た目から**認可の根拠**へ昇格させたため、staleness の意味が変わっている

## R1 should_fix
usePathname() はクエリ文字列を落とすため、ランキング等 searchParams 駆動画面で切替するとフィルタが消えた。→ useSearchParams は (app) レイアウト直下ゆえ配下**全ページに Suspense 境界を要求してしまう**ので使わず、シートはクリック起点でしか開かず SSR されない性質を使って onClick で window.location.pathname+search を state に取る

## 検証
全スイート 116 files / 1484 passed / 1 skipped・pnpm lint / check-types green（すべてローカルで実測）。
⚠️ 途中 1 回目の全スイートで 5 件失敗したが、原因は全て truncateAll の deadlock (40P01) で、**TaskStop したはずの前の vitest の残存 node プロセスが同じテスト DB を掴んでいた**ため。テスト DB の接続数を 0 に確認してから再実行すると green。並行して vitest を回さないこと（profile の worker_verify: none と同根）。
