---
name: project_invite_link_registration_def
description: 招待リンクで会員セルフ登録→LINEログインまで完結させる新機能の要件定義・実装計画・Issue一式
metadata: 
  node_type: memory
  type: project
  originSessionId: 29481954-0475-4bd6-ad90-a1deb91dce59
---

invite-link-registration（招待リンクによる会員セルフ登録）の機能定義。管理者が発行した招待URLを渡すだけで、本人が「会員登録→LINE紐付け→ログイン」まで自己完結できる導線を追加する。**実装完了・ship 済み → [[impl_invite_link_registration]]（PR#182 merge `62e9da9`, 2026-06-26）。** 以下は当初の定義。

**主要な設計判断:**
- **LINEログインは必須で残す**: アプリ全体が LINE 認証のみ。招待URL → 「LINEで登録」→ LINE OAuth（`signIn('line',{redirectTo:'/register/<token>'})` でトークン維持）→ 戻って氏名+級入力 → 会員作成。LINEなし簡易登録は再ログイン/通知が成立せず却下（ユーザー選択）。
- **1本のURLを期限内で複数人**が利用（per-person 単発トークンにしない）。LINEアカウント1つ=1会員（`users.line_user_id` UNIQUE で二重作成防止）。**不正登録対策は不要・ガードは有効期限のみ**（配布先限定をユーザーが受容）。
- 入力は**氏名(必須)+級(任意)**。段位/所属/性別は後で管理者が会員編集で補完。
- DB: 新規 `registration_invites`(token UNIQUE/expires_at/created_by FK/revoked_at)。`line_link_method` enum に **`invite_link`** 追加（入会経路の監査）。**users テーブルは変更なし**（isInvited/invitedAt/lineUserId/lineLinkedMethod を再利用）。
- middleware に `/register/*` 特別カテゴリ追加（未ログイン通過・未紐付け時の self-identify 強制の例外・紐付け済みは / へ）。
- トークンは `crypto.randomBytes(32).toString('base64url')` の高エントロピー（6桁コードは LINE Bot 用 [[impl_event_line_broadcast_task1]] と別物）。期限プリセット 1日/7日/30日（既定7日）。revoke は配布ミス用の補助。
- 既存の admin createMember＋[/self-identify] は**置き換えず併存**（移行済み/既存招待会員向け）。本機能は追加導線。

**成果物:** docs/features/invite-link-registration/requirements.md, implementation-plan.md（ともに status: completed）。
**Issue:** 親 #173、子 #174-181（8タスク, テストファースト順）= 1:DBスキーマ+enum+型/migration0030, 2:lib純関数, 3:発行/無効化actions, 4:registerViaInvite, 5:middleware, 6:登録ページUI, 7:発行UI+modal, 8:E2E。実装順 1→2→5→3→4→7→6→8。
