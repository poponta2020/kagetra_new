---
name: auto-review-round-pr518
description: auto-review PR #518
type: project
---

pr: 518（feat(role-preview): 表示ロールのプレビュー切替にゲストを追加）

## R1
- phase: initial（全差分 906行 / 12ファイル）
- model: gpt-5.6-sol / effort: high（理由=構造的高リスクパス（認証）を含む。sol 較正でも高リスクパス起因の high は維持）
- verdict: needs_changes / blockers 0・should_fix 1・nits 0
- round_tokens: 371,254 / cumulative: 371,254（上限 500,000）
- escalated: false
- レビュー対象外（既定除外）: docs/features/guest-role/requirements.md, docs/features/role-preview-switch/{requirements,implementation-plan}.md, docs/spec/{auth-admin,ui-shell}.md

## トリアージ結果
唯一の should_fix は**ユーザー判断で見送り（WONTFIX 1 件）**。修正コミットは無し。

- auth.config.ts:127 — 「JWT 更新認可がDBロール再同期前の値を使う」
  - 指摘内容: nodeJwtCallback が base callback（認可）を先に実行し、token.role の DB 同期はその後（node-jwt-callback.ts:43 → :106）。降格直後の窓で viewAsRole='guest' を送ると stale な admin を根拠に保存され、同一セッション中に admin へ戻すと操作なしでゲストビューが発火する
  - 順序の指摘自体は**事実として正確**（コードで確認済み）。ただし権限昇格は起きない（実効ロールは常に丸められる）
  - 見送り理由: **この PR が持ち込んだものではなく、プレビュー機能全体の既存挙動**（降格された admin の viewAsRole='vice_admin' でも同じ）。修正は共通認証パス nodeJwtCallback の変更になりスコープ外。1人開発・許可ユーザーが自分だけという運用実態で「降格→ゲスト要求→再昇格」が同一セッション中に揃う可能性が極めて低い

## 終了
- PHASE=initial の条件1（B=0/S=0）で成功終了。final は省略（R1 が最終形を見ている）
- 修正コミットが無いため fixed_head = reviewed_head = 50625a8。見送りで件数がゼロになったため cutoff JSON（r2.json / reason=user-wontfix）を作成
- 総ラウンド: 1 / 10
