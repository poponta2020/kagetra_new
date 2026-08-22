---
name: ship-role-preview-guest
description: 表示ロールのプレビュー切替に「ゲスト」を追加（管理者限定）
type: project
---

shipped: PR #518 — https://github.com/poponta2020/kagetra_new/pull/518（merge 済み・feature/role-preview-switch 削除済み）

表示ロールのプレビュー切替に「ゲスト」を追加（**本物のロールが admin のときだけ**）。guest-role 定義時の禁止（R7 / AC-36）は撤回し、同要件定義書も更新済み。

## クローズした Issue
親 #514 / 子 #515（認可層）・#516（設定ページの復帰導線）・#517（境界と回帰）

## 実装の芯
- `selectableRoles(realRole)` が `realRole === 'admin'` のときだけ末尾に `'guest'` を足す。**ROLES_HIGH_TO_LOW には入れない**（ランク比較に混ぜると guest(0) が全ロールの下に収まり副管理者・一般会員にもゲストが生える）。UI の選択肢生成・切替 Server Action・jwt コールバックの3経路が同じ関数を通る
- `resolveEffectiveRole` の `view === 'guest' && real !== 'admin'` は**冗長ではない**（selectableRoles を通らない `/api/auth/session` 直送りへの最後の砦）。簡素化で消さないようコメントに明記済み
- `buildRolePreviewSelection` は `current === 'guest'` の除外だけ撤回。`real === 'guest'`（本物のゲスト）の null は維持
- 設定ページはセクション JSX を `RolePreviewSection` へ抽出し、`buildRolePreviewSelection` の算出をゲスト分岐より前へ移して両分岐から描画
- migration なし・環境変数追加なし・公開契約の変更なし（変わるのは内部の `JWT.viewAsRole` 型のみ）

## レビュー（auto-review-loop）
1 ラウンド（initial のみ・gpt-5.6-sol / effort=high / 371,254 トークン）。blockers 0・should_fix 1・nits 0。**修正コミットはゼロ**（唯一の should_fix をユーザー判断で見送り = cutoff / user-wontfix）。final は省略（R1 が最終形を見ている）。CI（Lint/Typecheck/Test）green を確認してマージ。

### WONTFIX 1 件（既知の残課題）
`apps/web/src/auth.config.ts:127` — **JWT 更新の認可が DB 同期前の stale な token.role で行われる**。`nodeJwtCallback` が base callback（認可）を先に実行し、`token.role` の DB 同期はその後（node-jwt-callback.ts:43 → :106）。降格直後の窓で `viewAsRole='guest'` を送ると stale な admin を根拠に保存され、**同一セッション中に admin へ戻すと操作なしでゲストビューが発火する**。順序の指摘は事実として正確だが、権限昇格は起きない（実効ロールは常に丸められる）。見送り理由 = この PR が持ち込んだものではなく**プレビュー機能全体の既存挙動**（`viewAsRole='vice_admin'` でも同じ）で、修正は共通認証パス nodeJwtCallback の変更＝スコープ外。1人開発・許可ユーザーが自分だけという運用実態で発生条件が揃わない。**再発したら node-jwt-callback に「DB 同期後の再検証」を入れる**

## 残 DoD（本番実機・出荷後）
verify 手段の AC-14（設定タブ→表示ロールセクションへ到達）・AC-15（PWA 再起動をまたぐ持続）・AC-17（プレビュー中の書き込み）。前提として本番 `.env.production` の `ROLE_PREVIEW_USER_IDS` が設定済みであること（requirements §8）
