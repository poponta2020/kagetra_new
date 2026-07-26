---
status: completed
---

# role-preview-switch 実装手順書

要件: [requirements.md](requirements.md)（AC は §4）

**スキーマ変更・migration は発生しない。** 状態は JWT クレーム 1 個（`viewAsRole`）のみ。

## 技術設計の要約

```
users テーブル (不変)
      │
      ▼ nodeJwtCallback（既存・無変更）
token.role            = 本物のロール（realRole）★プレビュー値で上書きしない
token.viewAsRole      = プレビュー先ロール or 未設定  ← 新規クレーム
      │
      ▼ auth.config.ts session コールバック（唯一の切替点）
session.user.realRole = token.role
session.user.role     = resolveEffectiveRole(token.role, token.viewAsRole)   ← 実効ロール
      │
      ▼ 既存 41 ファイル・162 箇所（すべて無変更）
UI の出し分け／Server Action・route handler の権限チェック
```

- **昇格不能の保証**: `resolveEffectiveRole` は `viewAsRole` を `realRole` 以下へ丸める純関数。ここが唯一の実効ロール生成点なので、許可リストを経由しない不正な JWT 改竄でも権限は上がらない（そもそも JWT は AUTH_SECRET 署名付き）。
- **復帰の安全装置**: 切替 Server Action と UI 表示の判定は `realRole` と許可リストのみを見る。`role`（実効）を認可に使わない。
- **`unstable_update` の落とし穴**: `auth.config.ts` の `jwt` コールバックは `trigger === 'update'` で 3 フィールドしか転記しない。`viewAsRole` を許可リストへ**明示追加しないと黙って捨てられる**（実装後に「切り替わらない」で詰まる典型）。
- **環境変数**: `ROLE_PREVIEW_USER_IDS`（カンマ区切りの `users.id`）。**モジュールトップではなく関数内で `process.env` を読む**（ビルド時インライン化を避け、本番は再起動のみで反映させる）。純関数側は env 値を引数で受け取り `process.env` に触れない（テスト容易性＋クライアントバンドル汚染防止）。
- **クライアント境界**: `AccountMenu` は `'use client'`。env も `process` も import させず、サーバー（`(app)/layout.tsx`）で算出した値を props で渡す。

## 実装タスク

### タスク1: 純関数モジュールと型定義（基盤） — 対応Issue: #328
- [x] 完了
- **目的:** 実効ロールの導出・許可判定・選択肢生成・バッジ文言をすべて DB/env に触れない純関数として確定し、AC の分岐をユニットテストで固定する。あわせて `Session`/`JWT` の型を拡張する。
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-11, AC-12, AC-13
- **主な変更領域:**
  - 新規 `apps/web/src/lib/role-preview.ts`
  - 新規 `apps/web/src/lib/role-preview.test.ts`
  - `apps/web/src/next-auth.d.ts`（`Session['user'].realRole` / `JWT.viewAsRole` を追加）
  - `apps/web/src/test-utils/auth-mock.ts`（**必須**。下記参照）
- **依存タスク:** なし
- **⚠️ `auth-mock.ts` の拡張（これが無いとタスク3のテストが書けない）:**
  - `MockSessionUser` に `realRole?: UserRole` を追加
  - `buildMockSession` で `realRole: user.realRole ?? user.role` と**既定値を入れる** — これにより既存の全 `setAuthSession({id, role})` 呼び出しが「非プレビュー状態の正しいベースライン」になり（AC-18 の回帰）、タスク3 は `{id, role:'member', realRole:'admin'}` でプレビュー中を再現できる
  - **読み出し側は全箇所で `session.user.realRole ?? session.user.role` のフォールバック形に統一する**（`realRole` が undefined の JWT が残っていても壊れない）
- **公開する関数（署名は目安。`process.env` は一切読まない）:**
  - `parseUserRole(value: unknown): UserRole | null` — enum 外は null
  - `resolveEffectiveRole(realRole: UserRole, viewAsRole: UserRole | null | undefined): UserRole` — `viewAsRole` を `realRole` 以下へ丸める
  - `isRolePreviewAllowed(userId: string | null | undefined, rawEnv: string | undefined): boolean` — カンマ区切りを trim/空要素除去して照合。`rawEnv` 未設定・空・`userId` 空なら false（fail-closed）
  - `selectableRoles(realRole: UserRole): UserRole[]` — `realRole` 以下を上位から並べる（admin → 3件 / vice_admin → 2件 / member → 1件）
  - `roleViewLabel(role: UserRole): string` — `管理者` / `副管理者` / `一般会員`
  - `previewBadgeLabel(realRole: UserRole, effectiveRole: UserRole): string | null` — 同値なら null、異なれば `副管理者ビュー` / `会員ビュー`
- **必要なテスト（テストファースト）:**
  - `resolveEffectiveRole`: 未設定→realRole／同値→realRole／下位→下位／**上位を指定しても realRole 止まり**（AC-12）／enum 外の値が混入しても realRole（AC-11）
  - `isRolePreviewAllowed`: env 未定義・空文字・空白のみ → 全て false（AC-1）／リスト非該当 → false（AC-2）／該当 → true／`a, b ,c` の空白入り・末尾カンマを正しく分解／`userId` が null/空 → false
  - `selectableRoles`: admin=3件・vice_admin=2件（admin を含まない＝AC-4）・member=1件
  - `previewBadgeLabel`: 非プレビュー時 null（AC-13）／member プレビュー→`会員ビュー`／vice_admin プレビュー→`副管理者ビュー`
- **完了条件:** 新規テストが green・`pnpm --filter @kagetra/web typecheck` 通過・`role-preview.ts` が `process`／`next-auth`／DB を import していない

---

### タスク2: auth 層への配線（実効ロールの生成点） — 対応Issue: #329
- [ ] 完了
- **目的:** `auth.config.ts` の `session` コールバックで実効ロールを生成し、`jwt` コールバックの update 経路で `viewAsRole` を受け取れるようにする。
- **対応AC:** AC-5, AC-6, AC-7, AC-8, AC-12, AC-16, AC-18
- **主な変更領域:**
  - `apps/web/src/auth.config.ts`（`jwt` の update 許可リストに `viewAsRole` を追加／`session` で `realRole` と実効 `role` を設定）
  - 新規 `apps/web/src/auth-config-callbacks.test.ts`（`authConfig.callbacks.jwt` / `.session` を直接呼ぶ）
- **依存タスク:** タスク1
- **実装の要点:**
  - `session.user.realRole = token.role`、`session.user.role = resolveEffectiveRole(token.role, token.viewAsRole)`。**`token.role` は絶対に書き換えない。**
  - update パッチ型 `Patch` に `viewAsRole?: UserRole | null` を追加し、`parseUserRole` を通した値か `null` のときだけ `token.viewAsRole` へ転記する（`null` はプレビュー解除を意味するので必ず受け付ける）。
  - `nodeJwtCallback` は**変更しない**（毎リクエスト経路が `role` を再同期しない既存の非対称性に依存しない設計）。
  - `auth.config.ts` は Edge でも動くため、`role-preview.ts` は Edge-safe なまま保つ。
- **必要なテスト（テストファースト）:**
  - `session` コールバック: `viewAsRole` 未設定 → `role === realRole`（AC-18 の回帰）／`viewAsRole='member'` かつ `role='admin'` → `session.user.role==='member'` かつ `realRole==='admin'`（AC-5）／`viewAsRole='admin'` かつ `role='vice_admin'` → `role==='vice_admin'`（AC-12）
  - `jwt` コールバック update 経路: `{ user: { viewAsRole: 'member' } }` → `token.viewAsRole==='member'`／`{ viewAsRole: null }` → `token.viewAsRole===null`／enum 外文字列 → token 不変（AC-11）／既存 3 フィールドの転記が壊れていない（回帰）
  - 新規サインイン経路（`user` + `account.provider==='line'`）で `token.viewAsRole` が付かない＝再ログインでプレビューが解除される（AC-16）
  - **合成テスト（AC-7 / AC-8 の実証。ユニットテストだけでは未検証になる）:** 既存の管理者専用 Server Action を 1 つ選び、`setAuthSession({ id, role: 'member', realRole: 'admin' })` の状態で呼んで**拒否される**ことをアサートする。「既存ガードが member を弾くから大丈夫」を推論で済ませず 1 本の実測に落とす
- **完了条件:** 新規テスト green・既存 `node-jwt-callback.test.ts` が無変更で green・typecheck 通過

---

### タスク3: 切替 Server Action（認可） — 対応Issue: #330
- [ ] 完了
- **目的:** 表示ロールを切り替える Server Action を実装し、許可リストと本物のロールによる二重認可を効かせる。
- **対応AC:** AC-9, AC-10, AC-11, AC-15
- **主な変更領域:**
  - 新規 `apps/web/src/app/(app)/role-preview-actions.ts`（`'use server'`）
  - 新規 `apps/web/src/app/(app)/role-preview-actions.test.ts`
- **依存タスク:** タスク1
- **実装の要点:**
  - `export async function setRolePreviewAction(formData: FormData): Promise<void>`
  - 手順: `await auth()` → セッション無し/`user.id` 無しなら `redirect('/403')` → `isRolePreviewAllowed(session.user.id, process.env.ROLE_PREVIEW_USER_IDS)` が false なら `redirect('/403')` → `parseUserRole(formData.get('role'))` が null なら `redirect('/403')` → **`session.user.realRole ?? session.user.role`**（実効 `role` 単独ではない）以下でなければ `redirect('/403')`
  - 選択が `realRole` と同値なら `viewAsRole: null`（解除）、そうでなければ選択ロールを `unstable_update({ user: { viewAsRole } })` で書く
  - **解除だけは許可リスト判定を通さない**（`parseUserRole` の結果が `realRole` と同値なら、許可リストに載っていなくても `viewAsRole: null` を書いて良い）。プレビュー中に env から de-list されたときの締め出しを防ぐため。**実効ロールは下がる方向にしか動かないので AC-10（許可外は実効ロールが変化しない）は保たれる** — 許可外ユーザーにとって解除は常に no-op
  - `revalidatePath('/', 'layout')` でシェル全体を再描画（既存 `self-identify/actions.ts` の `unstable_update` + `revalidatePath` パターンを踏襲）
  - `process.env.ROLE_PREVIEW_USER_IDS` は**関数内で読む**
  - **拒否時は `unstable_update` を呼ばない**（状態不変を保証）
  - ⚠️ **同一レスポンス内の stale セッション罠**: `auth()` は**リクエスト**の cookie を読み、`unstable_update` は**レスポンス**の cookie を書く。そのため `revalidatePath('/', 'layout')` による同一レスポンス内の再描画が**古いセッションのまま**になりうる（症状＝「一般会員を押しても画面が変わらず、別画面へ遷移して初めて反映される」）。revalidate だけで反映されない場合は、update の直後に現在パスへ `redirect()` して新しい cookie を載せたリクエストを踏ませる
- **必要なテスト（テストファースト）:** `vi.mock('@/auth', …)` + `mod.unstable_update = vi.fn()`、`vi.mock('next/cache')`、`vi.mock('next/navigation')` で `redirect` を捕捉。env は `vi.stubEnv` で操作する。
  - env 未設定 → 拒否・`unstable_update` 未呼び出し（AC-1）
  - 許可リスト外の admin が `member` を指定 → 拒否・状態不変（AC-10）
  - **プレビュー中に de-list された admin（`role='member'`, `realRole='admin'`, env 非該当）が `admin` を指定 → 解除できる**（締め出し防止）
  - 許可された admin が `member` を指定 → `unstable_update({user:{viewAsRole:'member'}})` が 1 回
  - **許可された admin がプレビュー中（`role==='member'`, `realRole==='admin'`）に `admin` を指定 → 拒否されず `viewAsRole: null` で解除される（AC-9 の核心）**
  - 許可された `vice_admin` が `admin` を指定 → 拒否・状態不変（AC-11）
  - `role` が enum 外 / 欠落 → 拒否・状態不変（AC-11）
- **完了条件:** 新規テスト green・typecheck 通過

---

### タスク4: UI 配線（設定シートの3択＋ヘッダーバッジ） — 対応Issue: #331
- [ ] 完了
- **目的:** 許可ユーザーにだけ「表示ロール」を見せ、プレビュー中はヘッダーにバッジを出し、そこから戻せるようにする。
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-6, AC-9, AC-13, AC-14, AC-18
- **主な変更領域:**
  - `apps/web/src/app/(app)/layout.tsx`（許可判定と props 算出）
  - `apps/web/src/components/layout/mobile-shell.tsx`（props 素通し）
  - `apps/web/src/components/layout/app-bar-main.tsx`（props 素通し）
  - `apps/web/src/components/layout/account-menu.tsx`（バッジ表示＋「表示ロール」セクション）
  - `apps/web/src/components/layout/account-menu.test.tsx`（拡張）
  - `apps/web/src/components/layout/mobile-shell.test.tsx`（props 追加に伴う回帰）
- **依存タスク:** タスク1, タスク3
- **実装の要点:**
  - `(app)/layout.tsx` で
    ```
    const realRole = session.user?.realRole ?? session.user?.role
    const previewEnabled = isRolePreviewAllowed(session.user?.id, process.env.ROLE_PREVIEW_USER_IDS)
    const rolePreview = previewEnabled
      ? { current: session.user.role, real: realRole, selectable: selectableRoles(realRole) }
      : null
    const badge = previewBadgeLabel(realRole, session.user.role)   // 許可の有無に関わらず算出
    ```
    `isAdmin` の算出は**現状のまま**（実効 `role` を見る）＝ AC-6 は自動的に満たされる。
  - `AccountMenu` に `rolePreview: RolePreviewProps | null`・`previewBadge: string | null`・`setRolePreviewAction` を追加。
  - **バッジはトリガーボタンの中**に置く（`[会員ビュー] popontaさん`）。ボタン全体が既にシートを開くので AC-14 は追加配線なしで満たせる。バッジは既存 `Pill`（`tone="brand"`, 最小サイズ）を使う。
  - 「表示ロール」セクションは `<form action={setRolePreviewAction}>` 内に `<button name="role" value="admin|vice_admin|member">` を並べる。現在の実効ロールに `aria-current="true"` を付ける。クライアント JS は不要。
  - `rolePreview === null` のときはセクションごと描画しない（AC-1/AC-2）。
  - ⚠️ **de-list による締め出し防止**: プレビュー中に `ROLE_PREVIEW_USER_IDS` から自分の id が外れると `rolePreview` が null になり、「表示ロール」セクションが消えてログアウト以外に戻る手段が無くなる（AC-9 と同じ失敗クラス）。**`previewEnabled || previewBadge !== null` のときはセクションを描画する**（許可外でも「本物のロールへ戻す」だけは常に可能にする。タスク3 側も同様に、解除（realRole と同値の指定）は許可リスト判定より前に通す）。
- **必要なテスト（テストファースト。既存 `account-menu.test.tsx` の記法に合わせる）:**
  - `rolePreview={null}` → 「表示ロール」が DOM に存在しない（AC-1, AC-2）
  - admin の `rolePreview` → 3 ボタン（管理者/副管理者/一般会員）が出る（AC-3）
  - vice_admin の `rolePreview` → 2 ボタンのみ・「管理者」が無い（AC-4）
  - `previewBadge='会員ビュー'` → バッジが描画され、**トリガーを押すとシートが開く**（AC-13, AC-14 の DOM 側）
  - `previewBadge={null}` → バッジが描画されない（AC-13）
  - **プレビュー中（`isAdmin={false}` かつ `rolePreview` あり）でも「管理者」ボタンが描画される**（AC-9 の UI 側 — 実効ロールで出し分けていないことの証明）
  - `isAdmin={false}` で メール通知 リンクが出ない既存挙動が維持される（AC-18）
- **完了条件:** 新規・既存テスト green・typecheck・lint 通過

---

### タスク5: 環境変数の配備とドキュメント — 対応Issue: #332
- [ ] 完了
- **目的:** `ROLE_PREVIEW_USER_IDS` をローカル・本番の env テンプレートに記載し、本番での有効化手順（＝出荷後の残 DoD）を手順書として残す。
- **対応AC:** AC-15, AC-17, AC-19
- **主な変更領域:**
  - `.env.example`（コメント付きで追記・値は空＝無効）
  - `.env.production.example`（同上）
  - `apps/web/.env.local.example`（同上）
  - `docs/features/role-preview-switch/requirements.md` に本番有効化手順を追記、または `docs/dev/` に短い手順ノート
- **依存タスク:** タスク1（変数名の確定）
- **実装の要点:**
  - 記載内容: 「カンマ区切りの `users.id`。**未設定なら機能全体が無効**。自分の id は `SELECT id, name FROM users WHERE name = '...'` で取得」「本番は `/opt/kagetra/.env.production` へ追記 → web を再起動（再ビルド不要）」
  - `.env.production.example` の値は必ず空 or コメントアウトで置く（テンプレートに実 UUID を入れない）
- **必要なテスト:** なし（設定ファイルとドキュメントのみ）
- **完了条件:** 3 つの env テンプレートに記載あり・本番有効化手順が書かれている・実 UUID がリポジトリに含まれていない

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1:** タスク1（基盤。共有ホットスポットの `next-auth.d.ts` を含むので単独先行）
- **Wave 2:** タスク2, タスク3, タスク5（互いに変更領域が重ならない → 並行可）
- **Wave 3:** タスク4（タスク1・3 に依存。シェル 4 ファイルを触る）

## 並行作業の注意

`feature/entry-management`（未マージ）が `components/layout/bottom-nav.tsx` と `bottom-nav.test.tsx` を変更済み。本機能はそれらを触らないが、`mobile-shell.test.tsx` は双方が触りうる。**本機能のブランチは main から切り、entry-management のマージ後にリベースする**（順序管理は main セッションが行う）。

## 出荷後の残 DoD（本番手作業）

1. `/opt/kagetra/.env.production` に `ROLE_PREVIEW_USER_IDS=<popon の users.id>` を追記
2. web サービスを再起動（`systemctl restart` — 再ビルド不要）
3. 実機（PWA）で AC-14 / AC-15 / AC-17 を確認する
