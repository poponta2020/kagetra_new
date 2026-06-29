---
status: completed
---
<!-- 親Issue #199 / 子 #200(T1) #201(T2) #202(T3) #203(T4) #204(T5) #205(T6) -->

# 招待URL会員登録 リデザイン＆プロフィール拡張 実装手順書

> 要件＝[requirements.md](./requirements.md)（completed）／視覚＝[design-spec.md](./design-spec.md)（locked, A-flat）。
> テストファースト（API→実装→フロント→E2E）。実装着手は別途 `/implement` か `/do-plan` の指示後。
> **対象外（別PR）:** 会員設定画面での本人 PII 自己編集。

## 実装タスク

### タスク1: スキーマ＋migration（土台） — #200
- [x] 完了
- **概要:** `users` に nullable 9列を追加。`name`(UNIQUE)/`grade`/`gender`/`dan`/`zen_nichikyo` は流用（変更なし）。
- **変更対象ファイル:**
  - `packages/shared/src/schema/auth.ts` — `family_name/given_name/family_kana/given_kana/birth_date(date)/phone/postal_code/address1/address2` を追加（全 nullable）
  - `packages/shared/drizzle/0035_*.sql` — 生成（**実装時に並行ブランチと番号衝突確認**・[[project_dev_rules]] ルール11）
  - `packages/shared/__tests__/*` — スキーマ列のテスト追補
- **依存タスク:** なし
- **完了条件:** test/dev は `db:push`、migration 生成。型・スキーマテスト green。本番は `db:migrate`（[[feedback_drizzle_kit_push_prompt]]）。

### タスク2: 住所検索 route（api/zip・サーバー経由 zipcloud） — #201
- [x] 完了
- **概要:** 郵便番号7桁→zipcloud をサーバーで照会し住所文字列を返す route。失敗/該当なしは手入力フォールバック（フォーム送信は阻害しない）。
- **変更対象ファイル:**
  - `apps/web/src/app/api/zip/route.ts`（新規）— GET `?zipcode=7桁` → `{ address } | { error }`。`/register/*` 通過中の未紐付けユーザーから利用可
  - `apps/web/src/app/api/zip/route.test.ts`（新規）— 成功 / 該当なし / 上流エラー
- **依存タスク:** なし
- **完了条件:** route テスト green（zipcloud は fetch をモック）。無認証・無鍵・本番 outbound 前提を docs 反映。

### タスク3: registerViaInvite アクション改修（API・テストファースト） — #202
- [x] 完了
- **概要:** 新 zod スキーマ（条件付き必須）→ `name` 合成 → `users` INSERT。
- **検証ロジック:** 姓/名(1-20)・せい/めい(ひらがな+ー,1-30) 常に必須／級 任意／**段位は級=A で必須(4-8)・他 null**／級∈{A,B,C} かつ zenNichikyo true で **gender(男女)・birth_date・phone・postal_code・address1 必須**、**address2 はサーバー任意**／級∈{D,E} は zenNichikyo=false・PII 全 null。`name=姓␣名`。UNIQUE(name)/line_user_id 違反処理は踏襲。
- **変更対象ファイル:**
  - `apps/web/src/app/register/[token]/actions.ts` — スキーマ刷新・合成・INSERT・「Mirrors createMember」コメント更新
  - `apps/web/src/app/register/[token]/actions.test.ts`（新規/追補）— 条件付き必須・合成・段階保存・UNIQUE 衝突
- **依存タスク:** タスク1
- **完了条件:** アクションテスト green（先に書く）。

### タスク4: 登録フォーム＋ページ（フロント・A-flat） — #203
- [x] 完了
- **概要:** design-spec の A-flat を実装。段階表示（級→段位[A]/全日協[A,B,C]→PII）、戸建てチェックで住所2 必須免除、郵便検索ボタンは api/zip 呼び出し。
- **変更対象ファイル:**
  - `apps/web/src/app/register/[token]/register-form.tsx` — 2×2 氏名・級/段位/性別セグメント・全日協チェック・PII 群・住所2 戸建てチェック・controlled・useActionState・段階表示と値リセット
  - `apps/web/src/app/register/[token]/page.tsx` — A-flat 化（白カード/影撤去）・サブタイトル「北大かるた会 大会管理アプリ」
  - `apps/web/src/app/register/[token]/*.test.tsx` — 段階表示・戸建てチェック・郵便検索・必須表示
- **依存タスク:** タスク2, タスク3
- **完了条件:** フロントテスト green。jsdom 留意点（[[feedback_jsdom_css_env]] 等）。

### タスク5: 管理者 会員編集画面の拡張（PII 閲覧/編集） — #204
- [x] 完了
- **概要:** 管理者・副管理者が新9列を閲覧/編集できるよう編集画面を拡張（可視性=管理者閲覧の担保）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/members/[id]/edit/edit-member-form.tsx` — 姓/名/かな/生年月日/電話/郵便/住所1/住所2 の表示・編集を追加
  - `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` — `updateProfileSchema` に9列を追加
  - `apps/web/src/app/(app)/admin/members/[id]/edit/page.tsx` — クエリに新列追加
  - 同 `*.test.ts(x)` — 追補
- **依存タスク:** タスク1
- **完了条件:** 一般会員に他人 PII 非可視（既存ロール制御の範囲内）。テスト green。

### タスク6: E2E — #205
- [ ] 完了
- **概要:** 招待→LINE(cookie注入)→各級パターン登録→DB 検証。
- **ケース:** D/E（氏名＋級のみ）／B/C 全日協ON（PII・住所2戸建て両系）／A（段位＋全日協）／同名衝突／期限切れ。
- **変更対象ファイル:** `apps/web/e2e/*invite-register*.spec.ts`（新規/追補）
- **依存タスク:** タスク3, タスク4
- **完了条件:** E2E green（webpack 実ビルド経路で node: import 破壊が無いことも兼ねる・[[feedback_node_import_breaks_client_bundle]]）。

## 実装順序
1. タスク1（土台・依存なし）
2. タスク2（api/zip・依存なし／1と並行可）
3. タスク3（アクション・1に依存）
4. タスク4（フォーム/ページ・2,3に依存）
5. タスク5（管理者編集・1に依存／3,4と並行可）
6. タスク6（E2E・3,4に依存）

## PR 構成メモ
- 1機能だが規模大。実装時に **(a) T1+T3+T4+T6=登録コア** と **(b) T2=zip route**・**(c) T5=管理者編集** に PR を分けても可（1PR=1機能の精神で粒度調整）。Issue は機能単位＝親1＋子6 で起票。
