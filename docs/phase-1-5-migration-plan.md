# Phase 1-5 データ移行 実装計画

**作成日**: 2026-04-18
**前提**: Phase 1-1〜1-4 および テスト基盤整備（PR #1, #2）は完了・ship 済み

---

## 1. スコープと目的

旧 kagetra (Ruby/Sinatra) の会員・イベント等データを新 kagetra に移行する。議論の過程で、移行を成立させるために以下の付随変更が必要と判明した：

- 認証方式の全面変更（LINE Login → ユーザー名+パスワード）
- 会員プロフィールカラムの追加（性別/所属/段位/全日協）
- 冪等移行のための legacyId カラム追加

CLAUDE.md「1PR=1機能」原則に従い、**3つのPRに分割**する。

## 2. PR構成

| PR | 目的 | 依存 |
|---|---|---|
| **PR-A** | 認証方式変更（LINE Login → Credentials） | なし |
| **PR-B** | 会員プロフィール拡張 + LINE通知連携 | PR-A |
| **PR-C** | データ移行スクリプト + 本番適用 | PR-A, PR-B |

## 3. 決定事項（Q1-Q6 まとめ）

| ID | 決定 |
|---|---|
| Q1 | 移行対象: users / event_groups / events / event_attendances / schedule_items |
| Q2 | 認証: ユーザー名(旧 users.name) + パスワード、初期 `pppppppp`、初回変更強制 |
| Q3 | `users.deactivatedAt`（timestamp tz, NULL可）を新設 |
| Q4 | `cancel=true` → `attend=false`、`gradeSnapshot` 追加、user_name 破棄、最新行のみ、event_comments は対象外 |
| Q5 | 冪等アップサート（`legacyId` 追加）、旧システムは移行後凍結（運用ルール） |
| Q6 | gender/affiliation/dan/zenNichikyo 追加、permission=1 は admin 扱い、affiliation は全員 NULL で移行 |

---

## Phase 0: 事前確認とドキュメント

### 0.1 前提コンディション
- ブランチ: main から `feat/phase-1-5-auth-refactor`（PR-A）を切る
- Docker: `docker compose -f docker/docker-compose.yml up -d postgres postgres-test`
- Legacy DB: `kagetra-db` コンテナに `kagetra_legacy` DB 復元済み（前回調査の結果そのまま利用可）
- 旧ソース clone: `C:\tmp\kagetra-legacy-src`（password ロジック参照用、ただし移植はしない）

### 0.2 参照すべきドキュメント
- [CLAUDE.md](../CLAUDE.md) - プロジェクトルール全体
- [docs/worklog.md](./worklog.md) - 直近の作業履歴
- [packages/shared/src/schema/](../packages/shared/src/schema/) - 既存 Drizzle スキーマ
- [apps/web/src/auth.ts](../apps/web/src/auth.ts), [apps/web/src/auth.config.ts](../apps/web/src/auth.config.ts) - 既存 Auth.js 設定
- Auth.js v5 Credentials: https://authjs.dev/getting-started/providers/credentials
- LINE Login v2.1: https://developers.line.biz/ja/docs/line-login/

### 0.3 Anti-patterns（計画全体の禁止事項）
- 旧 PBKDF2-SHA1 ハッシュを移植しない（全員初期パス `pppppppp` で統一）
- event_comments / schedule_date_infos / contest_* / album_* / bbs_* / wiki_* は移行しない
- 旧 user_attributes の「全員」「全日協以外で扱わないキー」は破棄
- 旧 event_user_choices.user_name / attr_value_id の非級値 は破棄（gradeSnapshot のみ保持）
- 個人データ（氏名、連絡先）をログに出力しない

---

## Phase 1 (PR-A): 認証方式の変更

### 1.1 目的
LINE Login を廃止し、Auth.js Credentials provider による username+password 認証に置き換える。初回ログイン時にパスワード変更を強制する。

### 1.2 Schema 変更

**ファイル**: `packages/shared/src/schema/auth.ts`

```ts
// users テーブル追加カラム
passwordHash: text('password_hash'),  // nullable でよい（新規招待時は別途設定）
mustChangePassword: boolean('must_change_password').default(false).notNull(),
```

**残す既存カラム**: `lineUserId`（PR-B で活用）、`isInvited`（招待制維持）

**生成コマンド**: `pnpm --filter @kagetra/shared db:generate`

### 1.3 Auth.js 設定の差し替え

**ファイル**: `apps/web/src/auth.config.ts` / `apps/web/src/auth.ts`

- LINE provider を削除
- Credentials provider を追加
- `authorize` コールバック:
  ```ts
  async authorize(credentials) {
    const { username, password } = credentialsSchema.parse(credentials);
    const user = await db.query.users.findFirst({ where: eq(users.name, username) });
    if (!user || !user.passwordHash || !user.isInvited || user.deactivatedAt) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    return { id: user.id, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword };
  }
  ```
- **セッション戦略**: JWT に変更（Credentials は DB セッションと相性悪い）
  - PR #2 のテスト基盤 (`apps/web/src/test-utils/auth-mock.ts`) も JWT 対応に更新必要
- JWT コールバックで `mustChangePassword` をトークンに含める

**依存パッケージ追加**: `bcrypt` + `@types/bcrypt`（または `@node-rs/bcrypt` で Native 回避）

### 1.4 middleware

**ファイル**: `apps/web/src/middleware.ts`

- セッションあり & `mustChangePassword=true` かつ URL が `/change-password` 以外 → `/change-password` にリダイレクト
- セッションなし & URL が `/login` 以外 → `/login` にリダイレクト

### 1.5 UI 変更

- **差し替え**: `apps/web/src/app/login/page.tsx` → ユーザー名 + パスワードフォーム
- **新設**: `apps/web/src/app/change-password/page.tsx`
  - 現在のパスワード + 新パスワード + 確認
  - Server Action で bcrypt 検証 → 更新 → `mustChangePassword=false`
  - 成功時 `/` へリダイレクト
- **Server Actions**: `apps/web/src/app/login/actions.ts`, `apps/web/src/app/change-password/actions.ts`

### 1.6 Tests

- **Vitest**: 
  - `apps/web/src/app/login/actions.test.ts`: 認証成功・失敗・deactivated ユーザー拒否
  - `apps/web/src/app/change-password/actions.test.ts`: 現在のパス誤り、新パス短すぎ、成功時のフラグ更新
  - 既存 `apps/web/src/app/(app)/events/[id]/actions.test.ts` の auth-mock を Credentials 対応に更新
- **Playwright**: 
  - `apps/web/e2e/login-flow.spec.ts` 新設（ログイン→強制パス変更→ダッシュボード）
  - 既存 `e2e/grade-update.spec.ts` の管理者ログイン部分を Credentials ベースに更新

### 1.7 Verification Checklist
- [ ] `pnpm typecheck` 通過
- [ ] `pnpm lint` 通過
- [ ] `pnpm test` 全 Vitest 通過
- [ ] `pnpm test:e2e` Playwright 通過
- [ ] 手動: 開発 DB にシード投入 → ログイン → パスワード変更 → 通常ページ閲覧
- [ ] 旧 LINE Login 関連コード（`@auth/core/providers/line` import 等）が残っていないか grep 確認

### 1.8 Anti-patterns
- パスワードを平文で DB 保存しない
- middleware で毎リクエスト DB クエリしない（JWT payload から判定）
- 古い LINE provider 設定（`AUTH_LINE_ID`, `AUTH_LINE_SECRET`）は環境変数含め削除

---

## Phase 2 (PR-B): プロフィール拡張 + LINE通知連携

### 2.1 目的
会員プロフィールに性別/所属/段位/全日協/退会日時を追加。ログイン後に LINE 連携を必須化し、Phase 2 通知基盤に備える。

### 2.2 Schema 変更

**ファイル**: `packages/shared/src/schema/enums.ts`
```ts
export const genderEnum = pgEnum('gender', ['male', 'female']);
```

**ファイル**: `packages/shared/src/schema/auth.ts` users テーブル追加:
```ts
gender: genderEnum('gender'),                     // NULL可
affiliation: text('affiliation'),                  // 学校名 or "社会人"、NULL可
dan: integer('dan'),                               // 段位 0-9、NULL可
zenNichikyo: boolean('zen_nichikyo').default(false).notNull(),
deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),  // NULL可
```

### 2.3 Admin UI 拡張

**ファイル**: `apps/web/src/app/(app)/admin/members/[id]/edit/page.tsx`（既存拡張）
- 性別 select, 所属 text, 段位 number, 全日協 checkbox, 退会ボタン（`deactivatedAt` セット）
- 新規招待フォームでも同項目を入力可能に

### 2.4 LINE 連携フロー（必須）

**前提**: LINE Developers で Login channel を1つ作成（Messaging の80チャネルは Phase 2 対応）
- 環境変数: `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET`, `LINE_LOGIN_CALLBACK_URL`

**実装方式**: Auth.js は使わず raw OAuth2 で lineUserId のみ取得（セッション生成しない）

- **新ページ**: `apps/web/src/app/settings/line-link/page.tsx`
  - lineUserId が既にあれば「連携済み」表示 + 再連携ボタン
  - なければ LINE Authorize URL にリダイレクト（state = CSRF トークン）
- **コールバック**: `apps/web/src/app/api/line-link/callback/route.ts`
  - state 検証 → token エンドポイントで code→access_token → profile エンドポイントで userId 取得 → `users.lineUserId` に UPSERT
  - UNIQUE 衝突時は「他会員が連携済み」エラー表示

- **middleware**: ログイン済み & `mustChangePassword=false` & `lineUserId IS NULL` → `/settings/line-link` へリダイレクト

### 2.5 Tests

- **Vitest**: 
  - 管理者が会員の新フィールドを編集できるかのテスト
  - `deactivatedAt` セット後にログイン拒否されるかのテスト（PR-A の authorize コールバックが既に対応済み）
- **Playwright**: 
  - `e2e/line-link-flow.spec.ts` 新設（LINE OAuth はモック）
  - 初回ログイン → パス変更 → LINE連携（モック） → ダッシュボード

### 2.6 Verification Checklist
- [ ] `pnpm typecheck` / `lint` / `test` / `test:e2e` 全通過
- [ ] 手動: 会員編集画面で全フィールド設定・表示
- [ ] 手動: ステージングで LINE 実連携テスト（可能なら）
- [ ] state パラメータによる CSRF 対策確認
- [ ] UNIQUE 衝突時のエラーメッセージ確認

### 2.7 Anti-patterns
- LINE OAuth の state を省略しない
- 別会員の lineUserId を上書きしない（UNIQUE 制約 + UI 側チェック）
- LINE access_token をログに出力しない（短期で破棄）

---

## Phase 3 (PR-C): データ移行スクリプト

### 3.1 目的
旧 kagetra ダンプから新 DB へ会員・イベント・出欠・スケジュールを移行する TS スクリプトを構築。冪等実行可能。

### 3.2 Schema 変更（legacyId + gradeSnapshot）

全5テーブルに `legacyId` を追加:
```ts
// users / event_groups / events / event_attendances / schedule_items
legacyId: integer('legacy_id').unique(),  // NULL可（新システムで新規作成分）
```

event_attendances にもう1カラム:
```ts
gradeSnapshot: gradeEnum('grade_snapshot'),  // 出欠時点の級
```

### 3.3 scripts/migration/ 構成

```
scripts/migration/
├── dump/
│   └── myappdb.dump (既存)
├── README.md                   (手順書・前提・ロールバック)
├── package.json                (独立 tsx/drizzle/pg 依存)
├── tsconfig.json
└── src/
    ├── index.ts                (エントリ、--dry-run / --verify 対応)
    ├── config.ts               (env から接続情報)
    ├── legacy-db.ts            (旧 DB 接続 pool)
    ├── new-db.ts               (新 DB 接続、Drizzle client)
    ├── validate.ts             (プリフライトチェック)
    ├── verify.ts               (事後検証)
    ├── migrate-users.ts
    ├── migrate-event-groups.ts
    ├── migrate-events.ts
    ├── migrate-event-attendances.ts
    └── migrate-schedule-items.ts
```

### 3.4 各 migrate-*.ts の仕様

#### migrate-users.ts
SELECT 例（参考、詳細は実装時に調整）:
```sql
SELECT u.id, u.name, u.furigana, u.admin, u.loginable, u.permission,
       u.created_at, u.updated_at,
       MAX(CASE WHEN uak.id=2 THEN uav.value END) AS gender,
       MAX(CASE WHEN uak.id=4 THEN uav.value END) AS grade,
       MAX(CASE WHEN uak.id=5 THEN uav.value END) AS dan,
       BOOL_OR(uak.id=7) AS zen_nichikyo
FROM users u
LEFT JOIN user_attributes ua ON ua.user_id = u.id
LEFT JOIN user_attribute_values uav ON uav.id = ua.value_id
LEFT JOIN user_attribute_keys uak ON uak.id = uav.attr_key_id
GROUP BY u.id;
```

変換:
- `legacyId` = 旧 id
- `id` = UUID 新規生成
- `name` = 旧 name
- `role` = (admin OR permission=1) ? 'admin' : 'member'
- `grade` = 「A級」→ 'A' 等
- `gender` = 男→'male', 女→'female'
- `affiliation` = NULL
- `dan` = parseInt(値) （NULL可）
- `zenNichikyo` = bool
- `isInvited` = true
- `lineUserId` = NULL (会員は初回 LINE login 後に /self-identify で自己申告)
- `deactivatedAt` = loginable=false ? now() : NULL
- `lineLinkedAt` = NULL
- `lineLinkedMethod` = NULL
- `createdAt/updatedAt` = 旧維持

UPSERT: `ON CONFLICT (legacy_id) DO UPDATE SET ...`

#### migrate-event-groups.ts
直変換。`legacyId` = 旧 id、name / description / createdAt / updatedAt 維持。

#### migrate-events.ts
変換:
- `legacyId` = 旧 id
- `title` = 旧 name, `formalName` = 旧 formal_name
- `eventDate` = 旧 date, `startTime` = 旧 start_at, `endTime` = 旧 end_at
- `location` = 旧 place, `description` = 旧 description
- `official` = 旧 official
- `kind` = 旧 kind=1→'individual', 2→'team'（3 は発生時 'individual' フォールバック）
- `eventGroupId` = legacyId 経由で新 event_groups.id にマップ
- `createdBy` = event_owners の1件目 → 新 users.id（legacyId 経由）、なければ admin
- `entryDeadline` = 旧 deadline, `internalDeadline` = NULL, `eligibleGrades` = NULL
- `status` = done=true ? 'done' : register_done ? 'published' : 'draft'
- `capacity` = NULL
- `createdAt/updatedAt` 維持

#### migrate-event-attendances.ts
重複除去 (event_id, user_id の最新):
```sql
SELECT DISTINCT ON (euc.event_id, euc.user_id)
  euc.event_id, euc.user_id, ec.positive, euc.cancel,
  uak.name AS attr_key, uav.value AS attr_value,
  euc.created_at, euc.updated_at
FROM event_user_choices euc
JOIN event_choices ec ON ec.id = euc.event_choice_id
JOIN user_attribute_values uav ON uav.id = euc.attr_value_id
JOIN user_attribute_keys uak ON uak.id = uav.attr_key_id
ORDER BY euc.event_id, euc.user_id, euc.created_at DESC;
```
注: 旧 event_user_choices は event_id を直接持たず event_choices 経由で取得

変換:
- `eventId` = legacyId 経由で新 events.id
- `userId` = legacyId 経由で新 users.id
- `attend` = positive AND NOT cancel
- `comment` = NULL
- `gradeSnapshot` = attr_key='級' なら値→enum (A級→'A')、それ以外 NULL
- `createdAt/updatedAt` 維持

UPSERT: `ON CONFLICT (event_id, user_id) DO UPDATE SET ...`（UNIQUE制約）

#### migrate-schedule-items.ts
変換:
- `legacyId` = 旧 id, `date`, `name`, `startTime`, `endTime`, `location`（旧 place）
- `kind` = 旧 kind=1→'practice', 2→'social', 3→'other'
- `ownerId` = legacyId 経由で users.id
- `description` / `emphasis` / `public` は**破棄**

### 3.5 プリフライトチェック (validate.ts)

アボート条件:
- 旧 users.name に重複あり → 全件名列挙（ただし DB ログレベル）して終了
- 旧 event_user_choices に orphan あり
- 旧 users に user_attributes で 級 が複数ある会員あり
- 新 DB の users.legacyId に、旧に存在しない値がある（= 旧で削除されたデータが新に残存）→ 警告のみ

### 3.6 事後検証 (verify.ts)

- 各テーブルの件数が期待値と一致（旧→新で同数、orphan 含まず）:
  - users: 66 件
  - event_groups: 57 件
  - events: 336 件
  - event_attendances: 旧の重複除去後の件数（要実行時計測）
  - schedule_items: 253 件
- FK 整合: 新 event_attendances.eventId は必ず events.id に存在
- サンプル 10件 抽出して旧と新で name/title/date 等が一致

### 3.7 package.json scripts

ルート `package.json` に追加:
```json
"migrate:dry": "tsx scripts/migration/src/index.ts --dry-run",
"migrate:run": "tsx scripts/migration/src/index.ts",
"migrate:verify": "tsx scripts/migration/src/verify.ts"
```

### 3.8 Tests

- **Vitest Unit**:
  - 各 migrate-*.ts 関数の変換ロジックを小さな fixture で検証
  - 例: `convertRoleFromLegacy(admin=true, permission=0)` → 'admin'
- **Integration**:
  - test DB（5434）に対して **フル dry-run** 実行 → テーブル件数と FK 整合を assert
  - fixture: legacy DB に minimal seed を入れる補助スクリプト or 復元済み legacy DB をそのまま使う

### 3.9 Verification Checklist
- [ ] `pnpm migrate:dry` エラーなし（dev DB に接続、実際には書き込まない）
- [ ] `pnpm migrate:run` を一時 DB で実行 → 全件数一致
- [ ] `pnpm migrate:verify` 全チェック PASS
- [ ] 再実行: 2度目の `migrate:run` で SELECT 結果が不変（冪等性確認）
- [ ] scripts/migration/README.md に手順・ロールバック・環境変数が記載

### 3.10 Anti-patterns
- 本番 DB への直書き込みは `MIGRATE_TARGET=prod` 明示的な環境変数がなければ拒否
- トランザクション: 各テーブルを BEGIN/COMMIT で囲み、途中失敗で全ロールバック
- `legacy_id` の重複を UNIQUE で強制。重複検出時は例外で停止
- NULL 許容性: 旧 NULL 列 → 新 NOT NULL 列への変換は事前に検出・警告

---

## Phase 4: 本番適用

### 4.1 準備
- [ ] 旧システムを読み取り専用モードに（運用アナウンス + DB ユーザー権限変更 or アプリ側フラグ）
- [ ] 本番 DB のバックアップ取得 (`pg_dump`)
- [ ] ステージングで `migrate:run` 完遂確認
- [ ] 66名分の初期パス配布ドラフト作成（LINE グループなど）

### 4.2 実行
- [ ] `pnpm migrate:run` 本番実行、ログを保存
- [ ] 所要時間を計測

### 4.3 検証
- [ ] `pnpm migrate:verify` 全 PASS
- [ ] 管理者で pppppppp ログイン → パス変更 → LINE連携 → イベント閲覧
- [ ] サンプル会員5名に pppppppp 配布 → 動作確認
- [ ] 1週間モニタリング → 問題なければ全会員に配布

### 4.4 ロールバック
- 移行失敗時: バックアップから restore、旧システムを読み取り禁止解除
- 部分失敗時: legacyId を使って UPSERT 再実行

---

## リスクと緩和策

| リスク | 緩和策 |
|---|---|
| PR-A で既存のテストが大量に壊れる | PR #2 の test-utils を同PRで同時更新。段階的に緑に戻す |
| 移行スクリプトの変換バグ | プリフライト + 事後検証を必ず走らせる。dry-run 必須 |
| LINE 連携の OAuth 失敗 | 連携なしでも閲覧は可能に（middleware の強制リダイレクトは暫定フラグで切り替え可） |
| 初期パス `pppppppp` の配布漏れ | 管理画面で「未ログインユーザー」一覧を出し、再配布を支援 |
| 66名分のパス変更作業 | 強制フラグは外さない。変更しないと使えないので放置防止 |

---

## 最終チェックリスト（Phase 1-5 完了判定）

- [ ] PR-A ship 完了（認証方式変更）
- [ ] PR-B ship 完了（プロフィール拡張 + LINE連携）
- [ ] PR-C ship 完了（移行スクリプト）
- [ ] 本番移行完了（Phase 4）
- [ ] 全会員が初回ログイン + パス変更完了（モニタリング指標: `mustChangePassword=false` の件数）
- [ ] 全会員が LINE 連携完了（指標: `lineUserId NOT NULL` の件数）
- [ ] worklog.md に Phase 1-5 完了の記録追加
- [ ] claude-mem に設計判断（Q1-Q6）記録追加

---

## 参考: 実行順序の想定タイムライン

| 時期 | 作業 |
|---|---|
| W1 | PR-A 実装・PR レビュー・ship |
| W2 | PR-B 実装・PR レビュー・ship（ステージングで LINE 実連携確認） |
| W3 | PR-C 実装・テスト、ステージングで本番同等データに対して migrate:run |
| W4 | 本番適用（Phase 4）、初期パス配布、モニタリング |

## アナウンス文面例 (移行時)

移行完了後、会員向けにLINEグループ等で送信するアナウンス文のテンプレート。

---

【かげとら新システム移行のお知らせ】

旧サイトのログイン方法が変わりました。新システムではLINEログインのみとなります。

■ 手順
1. https://<本番URL>/ にアクセス
2. 「LINEでログイン」ボタンを押し、LINE認証を完了
3. 「あなたは誰ですか？」画面で、お名前を一覧から選んで確定

これで完了です。以降は1クリックでログインできます。

■ 一覧にお名前がない / 選んだけどうまく動かない 場合
管理者 (<管理者名>) までLINEでご連絡ください。

■ 注意
- 他の方の名前を誤って選ばないようご注意ください
- 誤って選んだ場合は管理者に連絡、解除後に再選択可能です
