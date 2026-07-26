---
name: feature-def-role-preview-switch
description: role-preview-switch 要件定義
type: project
---

role-preview-switch（管理者が表示ロールをUIから切り替え、一般会員/副管理者としての見え方を実機確認する機能）の要件定義・技術計画・Issue 作成まで完了（2026-07-26）。実装は未着手。

## 発端
LINE ログイン一本のため、一般会員としての実機確認に別 LINE アカウント＋招待済み会員行が必要で事実上不可能だった。

## 設計の芯（最重要）
権限判定が `session.user.role` の 1 箇所（apps/web/src/auth.config.ts の session コールバック）に集約されており、既存 41 ファイル・162 箇所がすべてここを見ている。よって session コールバックで
  session.user.role = resolveEffectiveRole(token.role, token.viewAsRole)  // realRole 以下へ丸め
  session.user.realRole = token.role
とするだけで、UI の出し分けと Server Action/route handler の認可が同時に・抜けなく切り替わる。既存箇所は無変更。状態は JWT クレーム 1 個（viewAsRole）のみでスキーマ変更・migration なし。

## 決定事項
- 利用者: 環境変数 ROLE_PREVIEW_USER_IDS（カンマ区切り users.id）の許可リスト。未設定＝機能全体が無効（fail-closed）。「admin なら誰でも」は将来 admin 増加時に意図せず広がるため却下
- 粒度: 管理者⇄副管理者⇄一般会員の3状態。本物のロールより上へは切替不可（昇格不能）
- 厳密さ: UI だけでなく権限も本物同等（/admin/* 直打ちは会員と同じく /403）
- 持続性: JWT に保持しリロード・PWA 再起動をまたぐ。ログアウトで解除
- 書き込み: プレビュー中も通常どおり実行（申込フローの検証が目的の一つ。データは本人の行に閉じる）
- UI: 設定シート（AccountMenu）に3択＋ヘッダーのトリガーボタン内にバッジ。design_required=false（既存 Pill とシート行パターンの流用のみ）

## 実装時の落とし穴（advisor 指摘＋コード確認済み）
1. **auth.config.ts の jwt update 経路は lineUserId/lineLinkedAt/lineLinkedMethod の3フィールドしか転記しない**。viewAsRole を明示追加しないと unstable_update しても黙って捨てられる＝「切り替わらない」で詰まる
2. **復帰導線・切替アクションの認可を実効 role で判定すると、プレビュー中に自分を締め出して管理者に戻れなくなる**。必ず realRole で判定する（AC-9 がこれを固定）
3. token.role は本物のロールとして保持し、プレビュー値で上書きしない。nodeJwtCallback の毎リクエスト経路は role を再同期しない既存の非対称性があるため、それに依存しない設計にした
4. AccountMenu は 'use client'。process.env をサーバー側で解決して props で渡す
5. **auth() はリクエストの cookie を読み unstable_update はレスポンスの cookie を書く**ため、同一レスポンス内の revalidatePath 再描画が stale になりうる（症状=押しても変わらず遷移して初めて反映）。効かなければ update 直後に現在パスへ redirect
6. **test-utils/auth-mock.ts に realRole を足さないとタスク3のテストが書けない**。buildMockSession で `realRole: user.realRole ?? user.role` を既定値にすると既存の全 setAuthSession 呼び出しが非プレビューの正しいベースラインになる。読み出し側も `realRole ?? role` のフォールバック形に統一する
7. **env から de-list されると締め出される**（表示ロールのセクションが消える）。解除（realRole と同値の指定）だけは許可リスト判定を通さない＝AC-10b。実効ロールは下がる方向にしか動かないので権限は広がらない

## AC / タスク
AC 20件（auto-test 16 / verify 4 / manual 0）。回帰 AC-18「プレビュー未使用時は従来どおり」を含む。
親 Issue #327 https://github.com/poponta2020/kagetra_new/issues/327
子 #328(純関数+型) / #329(auth配線) / #330(Server Action認可) / #331(UI配線) / #332(env+docs)
Wave 1=#328 → Wave 2=#329,#330,#332（並行可） → Wave 3=#331

## 並行作業
feature/entry-management（未マージ）が bottom-nav.tsx を変更済み。本機能は触らないが mobile-shell.test.tsx が競合しうる。main から切って entry-management マージ後にリベースする。

## 出荷後の残 DoD（本番手作業）
/opt/kagetra/.env.production に ROLE_PREVIEW_USER_IDS=<popon の users.id> を追記 → web 再起動（再ビルド不要）→ 実機で AC-14/15/17 を確認。

成果物は定義時点で commit 済み・push 済み（7716082 / e32a39a / b08bc87）。
