---
status: completed
---
# invite-link-registration（招待リンクによる会員セルフ登録）要件定義書

## 1. 概要

### 目的
管理者が発行した**招待URL**を新規会員に渡すだけで、本人が「会員登録 → LINE 紐付け → ログイン」までを自己完結できるようにする。これまで必須だった「管理者が事前に会員レコードを作成する（[admin createMember](apps/web/src/app/(app)/admin/members/actions.ts)）」工程を、本人セルフ登録で代替できる導線を追加する。

### 背景・動機
- 現状の入会導線は **管理者が先に会員行を作成 → 本人が LINE ログイン → [/self-identify](apps/web/src/app/self-identify/page.tsx) で自分の名前を選択** の2段構え。新入会者が出るたびに管理者が手入力する必要がある。
- 「URLを渡せば本人が登録〜ログインまで済む」形にしたい。配布先は管理者が限定するため、**不正登録対策（レート制限・本人性検証・CAPTCHA等）は不要**。ガードは**有効期限のみ**とする（ユーザー明示）。
- アプリの認証は LINE のみ・招待制という前提は維持する。招待URL経由でも **LINE ログインを通す**ことで、再ログイン・LINE通知が成立する。

## 2. ユーザーストーリー

### 対象ユーザー
- **管理者・副管理者**: 招待URLを発行し、新入会者に配布する。
- **新規会員（未登録の人）**: 受け取ったURLから自分で会員登録してログインする。

### 利用シナリオ
1. 管理者が会員管理画面で「招待リンクを発行」し、有効期限（1日/7日/30日）を選んでURLを得る。
2. 管理者がそのURLを新入会者（1人または複数人のグループ）に配布する。
3. 新入会者がURLを開く → 「LINEで登録」→ LINE ログイン → 氏名（必須）と級（任意）を入力 → 登録完了し、そのままログイン状態でダッシュボードへ。
4. 期限が切れたURLを開くと「期限切れ」表示となり登録できない。

### ゴール
- 管理者: 新入会者ごとの手入力をなくし、URL配布だけで入会を完了させる。
- 新規会員: 1つのURLから迷わず登録・ログインまで到達する。

## 3. 機能要件

### 3.1 画面仕様

#### (A) 招待リンク発行 UI（管理者・副管理者）
- 設置場所: [/admin/members](apps/web/src/app/(app)/admin/members/page.tsx)（既存の会員追加と同じ画面）に「招待リンク」セクションを追加。
- 操作:
  - 「招待リンクを発行」ボタン → 有効期限プリセット（**1日 / 7日 / 30日**、既定 7日）を選択 → 発行。
  - 発行後モーダルに **完全なURL**、有効期限（残り時間カウントダウン＋失効日時）、**コピー**ボタンを表示（[InviteCodeModal](apps/web/src/components/events/InviteCodeModal.tsx) のUIパターンを踏襲）。
  - 「現在有効な招待リンク」一覧（発行日時・失効日時・無効化ボタン）を表示。
- 権限: `admin` / `vice_admin` のみ（createMember と同じ authz）。一般会員には発行 UI を出さない。

#### (B) 登録ページ `/register/[token]`（未ログイン〜登録完了）
- **未ログインで開いた場合**: ウェルカム画面（会名・案内文）＋「LINEで登録」ボタン。押下で LINE OAuth を開始し、完了後この同じURLへ戻る（`signIn('line', { redirectTo: '/register/<token>' })`）。
- **LINEログイン済み・未紐付けで戻ってきた場合**: 登録フォームを表示。
  - 入力項目: **氏名（必須, 1〜50文字）**、**級（任意, A〜E のセレクト、未選択可）**。
  - 「登録する」ボタン → 会員レコード作成＋LINE紐付け → ダッシュボード（`/`）へ。
- **トークンが無効/期限切れ/無効化済みの場合**: 「この招待リンクは無効か期限切れです。管理者にご連絡ください。」を表示し、登録フォーム・LINEボタンは出さない。
- **既にLINE紐付け済み（既存会員）が開いた場合**: 登録不要のためダッシュボード（`/`）へリダイレクト。

#### エラー表示（登録ページ）
- 氏名未入力 / 50文字超: フォール内バリデーションメッセージ。
- 同名の会員が既に存在（UNIQUE 衝突, 退会済み含む）: 「同名の会員が既に存在します。管理者にご連絡ください。」（createMember の文言を踏襲）。
- 送信時点で期限切れ/無効化: 「招待リンクの有効期限が切れています。」
- 同一LINEアカウントが既に登録済み（二重送信等の race）: ダッシュボードへ誘導。

### 3.2 ビジネスルール

- **登録で作成される会員**は常に `role = 'member'`（管理者/副管理者はセルフ登録不可）。`isInvited = true`、`invitedAt = now`、`lineUserId = <セッションのLINE ID>`、`lineLinkedAt = now`、`lineLinkedMethod = 'invite_link'`（enum 新値）。
- 1つの招待URLは**有効期限内なら複数人が利用可能**。利用上限・人数カウントは設けない。
- **同一LINEアカウント＝1会員**: `users.line_user_id` の UNIQUE 制約で、同じLINEアカウントからの二重作成を防止。
- **トークン有効性**: `revoked_at IS NULL` かつ `now < expires_at` のときのみ有効。ページ表示時と**送信時の両方**で再判定する（ページを開いたまま期限を跨ぐケース対策）。
- 有効期限はガードの中心。**無効化（revoke）**は配布ミス時の安全弁として用意するが、必須要件ではない補助機能。
- 不正登録対策（レート制限・本人性検証・CAPTCHA・メール確認）は**実装しない**（配布先限定＋期限で受容、ユーザー明示）。
- 既存の入会導線（admin createMember ＋ self-identify）は**そのまま残す**（移行済み会員・既存招待会員向けに併存）。本機能は追加導線。

### 境界・例外
- 期限切れ・無効化済みトークン、存在しないトークン → 一律「無効」表示（理由は出し分けない）。
- 退会済み（`deactivatedAt`）のLINEアカウントで招待URLを開く → 既存の signIn コールバックが `?error=deactivated` を返すため、退会者は登録できない（再入会は管理者経由）。
- 級は任意。未選択時は `grade = null`（後から管理者が会員編集で補完）。

## 4. 技術設計

### 4.1 ルーティング / 認証フロー
- 新規ページ: `apps/web/src/app/register/[token]/page.tsx`（`(app)` レイアウト外＝モバイルシェルを被せない、signin/self-identify と同じ独立レイアウト）。
- [middleware.ts](apps/web/src/middleware.ts) を拡張し、`/register/` プレフィックスを新カテゴリとして扱う:
  - 未ログイン＋ `/register/*` → 通す（ウェルカム＋LINEボタンを表示）。
  - ログイン済み・未紐付け（`!session.user.id`）＋ `/register/*` → 通す（self-identify への強制リダイレクトの**例外**にする）。
  - ログイン済み・紐付け済み＋ `/register/*` → `/` へリダイレクト（登録不要）。
- LINE OAuth の往復はサーバーアクション `signIn('line', { redirectTo: '/register/<token>' })` で `redirectTo` にトークン付きURLを渡して維持する。
- 登録確定後は self-identify と同様に `unstable_update` で JWT を更新しつつ、失敗しても [nodeJwtCallback](apps/web/src/lib/node-jwt-callback.ts) が次回 render で `lineUserId → users.id` を解決する（自己回復）。

### 4.2 DB 設計

**新規テーブル `registration_invites`**（`packages/shared/src/schema/` に追加）:

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | text | PK, default uuid | |
| token | text | NOT NULL, UNIQUE | URLに載る高エントロピー乱数（`crypto.randomBytes(32).toString('base64url')`） |
| expires_at | timestamptz | NOT NULL | 失効日時 |
| created_by | text | NOT NULL, FK→users.id | 発行した管理者 |
| created_at | timestamptz | NOT NULL, default now | |
| revoked_at | timestamptz | NULL | 無効化日時（NULL=有効） |

**enum 変更**: [enums.ts](packages/shared/src/schema/enums.ts) の `lineLinkMethodEnum` に `'invite_link'` を追加（`ALTER TYPE ... ADD VALUE` のマイグレーション）。

**`users` テーブルは変更なし**（既存の `isInvited` / `invitedAt` / `lineUserId` / `lineLinkedMethod` を再利用）。どの招待リンク経由かのFKは持たない（監査は `lineLinkedMethod='invite_link'` で十分、スコープ外）。

マイグレーションは Drizzle journal ベースで新規連番を1つ追加（テーブル作成＋enum値追加）。本番は `db:migrate`（非interactive）で適用。

### 4.3 フロントエンド設計
- `register/[token]/page.tsx`（Server Component）: トークン検証 → 状態に応じて以下を出し分け。
  - 無効 → エラー表示コンポーネント。
  - 未ログイン → ウェルカム＋「LINEで登録」フォーム（server action で signIn）。
  - 未紐付け → 登録フォーム（氏名・級）クライアントコンポーネント。
- `RegistrationInviteModal`（クライアント）: 発行後のURL/期限/コピー表示。InviteCodeModal を参考にした新規コンポーネント。
- 会員管理画面に「招待リンク」セクション（発行ボタン＋期限選択＋有効リンク一覧）を追加。

### 4.4 バックエンド設計（Server Actions / lib）
- `lib/registration-invite.ts`: トークン生成・有効期限算出・検証（`generateRegistrationToken` / `invitedExpiresAt(preset)` / `verifyRegistrationToken`）。[invite-code.ts](apps/web/src/lib/invite-code.ts) の純関数パターンを踏襲しユニットテスト可能に。
- 発行アクション `createRegistrationInvite(preset)`: admin/vice_admin チェック → `registration_invites` に INSERT → URL を返す。
- 無効化アクション `revokeRegistrationInvite(id)`: admin/vice_admin チェック → `revoked_at = now` UPDATE。
- 登録確定アクション `registerViaInvite(token, formData)`:
  1. セッションの `lineUserId` 取得（無ければ `/register/<token>` で再ログイン誘導）。既に `session.user.id` 有り → `/` へ。
  2. トークン再検証（無効/期限切れ → エラー）。
  3. `users` に INSERT（name, grade, role='member', isInvited=true, invitedAt, lineUserId, lineLinkedAt, lineLinkedMethod='invite_link'）。`users.name` / `users.line_user_id` の UNIQUE 違反をそれぞれ文言ハンドリング。
  4. `unstable_update` → `revalidatePath('/')` → `redirect('/')`。

### 処理フロー（正常系）
```
管理者: /admin/members で「発行」(期限選択)
  → createRegistrationInvite → registration_invites INSERT → URL をモーダル表示 → 配布

新規会員: /register/<token> を開く（未ログイン）
  → middleware 通過 → ウェルカム表示 →「LINEで登録」
  → signIn('line', {redirectTo:'/register/<token>'}) → LINE OAuth
  → /register/<token> へ復帰（未紐付け, middleware 例外で通過）
  → 氏名+級 フォーム → registerViaInvite
  → users INSERT(role=member, lineLinkedMethod=invite_link) → JWT更新 → / へ
```

## 5. 影響範囲

### 変更が必要な既存ファイル
- [apps/web/src/middleware.ts](apps/web/src/middleware.ts) — `/register/*` の通過ルール追加（未ログイン通過＋未紐付け時の self-identify 例外＋紐付け済みは `/` へ）。
- [packages/shared/src/schema/enums.ts](packages/shared/src/schema/enums.ts) — `lineLinkMethodEnum` に `invite_link` 追加。
- `packages/shared/src/schema/` — `registration_invites` テーブル追加（＋ relations 必要なら）。
- [apps/web/src/app/(app)/admin/members/page.tsx](apps/web/src/app/(app)/admin/members/page.tsx) — 招待リンク発行セクション追加。
- [apps/web/src/app/(app)/admin/members/actions.ts](apps/web/src/app/(app)/admin/members/actions.ts) または新規 actions — 発行/無効化アクション。
- `apps/web/src/auth.config.ts` の `lineLinkLinkedMethod` 型（`'self_identify' | 'admin_link' | 'account_switch'`）に `'invite_link'` を追加（[auth.config.ts](apps/web/src/auth.config.ts) / [next-auth.d.ts](apps/web/src/next-auth.d.ts) / [node-jwt-callback.ts](apps/web/src/lib/node-jwt-callback.ts) の型を横断更新）。

### 新規ファイル
- `apps/web/src/app/register/[token]/page.tsx`、登録フォームクライアントコンポーネント、`register/[token]/actions.ts`。
- `apps/web/src/lib/registration-invite.ts`（＋ `.test.ts`）。
- `apps/web/src/components/admin/RegistrationInviteModal.tsx`。
- Drizzle マイグレーション（新規連番）。

### 既存機能への影響
- **認証/ルーティング**: middleware にパスカテゴリが増えるのみ。既存の signin / self-identify / (app) 配下のゲートは不変。
- **self-identify**: 招待リンク登録者は作成時点で `lineUserId` が埋まるため self-identify 候補（`lineUserId IS NULL`）には現れず、二重 claim は起きない。既存導線はそのまま併存。
- **会員一意性**: `users.name` UNIQUE は不変。同名衝突は従来どおりエラー。
- **LINE通知**: 既存どおり `lineLinkedMethod` 値が1つ増えるだけ。配信ロジックへの影響なし。

## 6. 設計判断の根拠

- **LINEログインを必須にする**: アプリ全体が LINE 認証のみ。LINE を通さないと再ログイン手段も通知手段も成立しないため、招待リンクでも LINE ログインを経由させる（ユーザー選択）。
- **1本のURLを期限内で複数人**（per-person 単発トークンにしない）: 「URLを渡す人を限定するので不正登録は考えなくてよい／期限だけ設ければよい」というユーザー方針に最も素直。新入会者グループへまとめて配布でき、運用が最小。
- **入力は氏名＋級のみ**: 氏名は `users.name`（UNIQUE）の必須キー、級はかるた会で最も使う属性。段位・所属・性別は後から管理者が補完できるため初回入力から外し、入力負担と誤入力を抑える。
- **トークンは高エントロピー乱数（6桁コードにしない）**: 6桁コードは LINE グループで口頭発言する用途（[invite-code.ts](apps/web/src/lib/invite-code.ts)）。本機能はURLに載るため、不正対策不要でも推測可能URLは避け、`crypto.randomBytes` で生成する（コスト0）。
- **`lineLinkMethod='invite_link'` を追加**: 入会経路を監査可能にする。既存3値と衝突しない追加のみ。
- **revoke は補助**: ユーザーは「期限だけでよい」としているため有効期限を主ガードとし、配布ミス時の安全弁として無効化を軽量に用意（必須ではない）。
- **既存導線を残す**: self-identify は移行済み/既存招待会員に必要。置き換えず追加導線とすることで後方互換とリグレッション回避。
