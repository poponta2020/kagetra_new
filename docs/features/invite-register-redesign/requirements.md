---
status: completed
completed_sections: [ユーザーストーリー, 機能要件, 技術設計, 影響範囲]
next_section: null
---
# 招待URL会員登録 リデザイン＆プロフィール拡張 要件定義書

> 既存機能 [[impl_invite_link_registration]]（`/register/[token]`）の**改修＋拡張**。視覚は `design-spec.md`（A-flat 確定）が正典＝**画面レイアウトは再記述しない**。本書は**ロジック/データ/検証/DB/API**を定義。

## 1. 概要
- **目的:** 招待URL登録画面を和紙×藍墨（A-flat）に整えつつ、新規会員の自己入力を **構造化氏名（姓/名×漢字/かな）＋級＋段位＋全日本かるた協会（全日協）登録情報（PII）** まで拡張し、会の名簿・全日協郵送先を登録時に揃える。
- **背景:** 現状は汎用UI＋単一 `name`＋級のみ。ふりがな・段位・全日協 PII（性別・生年月日・電話・郵便番号・住所）が取れず、五十音順・免状/かるた展望の郵送に支障。design-screen で A-flat 化＋プロフィール拡張が要件化された。
- **スコープ（確定）:** 上記すべてを**1機能**に含む（PII＋住所検索API含む）。

## 2. ユーザーストーリー
- **対象:** 管理者に招待URLを渡された新規会員（スマホ）。
- **目的:** 一度の登録で、正しい氏名（ふりがな付き）・級・段位・全日協登録情報まで登録し会員ページへ。
- **シナリオ:** 招待URL → LINE認証 → 氏名・級（A級は段位、A/B/C級は全日協チェック→ON で性別・生年月日・電話・郵便番号・住所）→「登録する」→ ダッシュボード。

## 3. 機能要件
> 見た目・配置・段階表示は `design-spec.md` を正とする。ここでは入力・検証・処理の**ロジック**。

### 3.1 入力項目・検証・保存先
| 項目 | 必須条件 | 検証 | 保存先（`users`） |
|---|---|---|---|
| 姓（漢字） | 常に必須 | trim 1〜20 | `family_name`（新規） |
| 名（漢字） | 常に必須 | trim 1〜20 | `given_name`（新規） |
| せい（かな） | 常に必須 | ひらがな＋`ー`、1〜30 | `family_kana`（新規） |
| めい（かな） | 常に必須 | ひらがな＋`ー`、1〜30 | `given_kana`（新規） |
| 級 | 任意 | A〜E or null | `grade` |
| 段位 | **級=A のとき必須**（既定 四段）/ 級≠A は null | 四〜八段＝int 4〜8 | `dan`（既存 integer） |
| 全日協 登録済み | 級∈{A,B,C} のとき表示・既定 ON / 級∈{D,E} は常に false | boolean | `zen_nichikyo`（既存） |
| 性別 | **全日協 ON のとき必須**（OFF は null） | male / female | `gender`（既存 enum・男女のみ） |
| 生年月日 | 全日協 ON のとき必須 | 妥当な過去日（1900〜本日） | `birth_date`（新規 date） |
| 電話番号 | 全日協 ON のとき必須 | 数字＋ハイフン、10〜13桁 | `phone`（新規 text） |
| 郵便番号 | 全日協 ON のとき必須 | 7桁（ハイフン可・正規化保存） | `postal_code`（新規 text） |
| 住所1（丁目・番地まで） | 全日協 ON のとき必須 | trim 1〜100 | `address1`（新規 text） |
| 住所2（建物名・部屋番号） | **DB任意（nullable）/ フロントは全日協ON時、戸建てチェック未選択なら必須** | trim 0〜100 | `address2`（新規 text） |

- **表示名 `name` 合成:** `name = ${姓}␣${名}`（半角スペース1つ）。UNIQUE は合成名で維持。
- **住所2 と戸建てチェック:** 「集合住宅ではない（一軒家）のため未入力」チェックは**保存しない**（フロント検証制御のみ）。ON で住所2 を空送信＝`address2` null。サーバーは `address2` を任意（nullable）受理し、フロントが戸建てチェック未選択時の必須を担保。郵便番号検索は `address1` に補完。
- **段階表示と保存の整合:** 級≠A → `dan`=null。級∈{D,E} → `zen_nichikyo`=false かつ PII 全 null。全日協 OFF → PII 全 null・`zen_nichikyo`=false。サーバー側でこの不変条件を強制（クライアント表示に依存しない）。
- **入力保持:** 検証/重複エラー時も入力値を保持（controlled・`useActionState` 踏襲）。
- **成功時:** `/` リダイレクト（成功 state は描画しない・現状踏襲）。

### 3.2 ビジネスルール / エラー
- **トークン再検証:** submit 時も有効性チェック（現状踏襲）。期限切れ→「招待リンクの有効期限が切れています。」
- **同名衝突:** 合成 `name` UNIQUE 違反→「同名の会員が既に存在します。管理者にご連絡ください。」
- **同一LINE二重:** `line_user_id` UNIQUE 違反→既登録とみなし `/` へ（現状踏襲）。
- **条件付き必須の検証:** サーバーで grade・zenNichikyo に応じ必須項目を動的判定。未充足はフィールド特定メッセージ。
- **③ リンク無効:** 導線なし（現状踏襲）。

### 3.3 郵便番号→住所 自動検索
- **サーバー経由で zipcloud**（`https://zipcloud.ibsnet.co.jp/api/search?zipcode=`）を叩く route handler を新設。クライアントは自前 route を呼ぶ（CORS回避・テスト容易）。
- 7桁正規化→照会→`address1+2+3` を住所欄へ補完（番地追記を促す）。失敗・該当なしは**手入力フォールバック**（エラーメッセージ）。zipcloud 障害時もフォーム送信は可能（住所は手入力）。
- 補完はあくまで補助。最終保存値は住所欄の内容。

## 4. 技術設計
### 4.1 API / Server Action
- **Server Action `registerViaInvite`**（`register/[token]/actions.ts`）を改修：新スキーマ（上記・条件付き必須）→ `name` 合成 → `users` INSERT（`role=member/isInvited/lineUserId/lineLinkedMethod='invite_link'` 踏襲）＋新列。UNIQUE 違反処理は踏襲。「Mirrors createMember」コメント更新。
- **住所検索 route**（新設・例 `apps/web/src/app/api/zip/route.ts`）：GET `?zipcode=7桁` → サーバーで zipcloud fetch → `{ address } | { error }`。`/register/*` 通過中の未紐付けユーザーから利用可（middleware 例外内）。外部依存・無認証 API（鍵不要）。将来のレート制限は残課題。

### 4.2 DB（migration 想定 0035・実装時に並行ブランチと番号衝突確認）
- **`users` に nullable 列を追加（計9本）:** `family_name text` / `given_name text` / `family_kana text` / `given_kana text` / `birth_date date` / `phone text` / `postal_code text` / `address1 text` / `address2 text`。
- **流用（変更なし）:** `name`(UNIQUE)・`grade`・`gender`(enum male/female)・`dan`(integer)・`zen_nichikyo`(boolean)。
- **既存会員（約100名）:** 新8列は **null のまま**（自動分割・補完しない）。`name` が正典。
- **Drizzle:** `packages/shared/src/schema/auth.ts` に8列追加。test/dev=`db:push`、本番=`db:migrate`（[[feedback_drizzle_kit_push_prompt]]）。

### 4.3 フロントエンド（視覚は design-spec）
- `register-form.tsx`: 氏名2×2＋級セグメント＋（A時）段位セグメント＋（A/B/C時）全日協チェック＋（ON時）PII群（性別/生年月日/電話/郵便番号＋検索/住所）。controlled・`useActionState`・段階表示と値リセット・郵便検索ボタンで自前 route 呼び出し。
- `page.tsx`: A-flat 化（白カード/影撤去）、サブタイトル「北大かるた会 大会管理アプリ」。3分岐ロジック不変。

### 4.4 可視性 / 権限（PII ガバナンス）
- **閲覧:** 管理者・副管理者のみ他会員の PII を閲覧可。一般会員に他人の PII は見せない。
- **編集:** 本人は自分の PII を編集可（設定画面）。管理者も編集可。
- **管理者の会員編集画面拡張:** `admin/members/[id]/edit`（form/action/page）に新8列の表示・編集を追加（現状は grade/gender/affiliation/dan/zenNichikyo のみ）。
- **本人編集（設定画面）: 本機能では対象外（確定・別PR/別 slug で後追い）。** 会員設定での PII 自己編集は本 PR に含めない。本機能では「登録時の本人入力＋管理者による閲覧/編集」までで、本人による後からの編集導線は別途定義する。

## 5. 影響範囲
- **変更:** `packages/shared/src/schema/auth.ts`（+8列）、`drizzle/0035_*.sql`、`register/[token]/actions.ts`・`register-form.tsx`・`page.tsx`、新 `api/zip` route、`admin/members/[id]/edit` 一式。
- **本機能 対象外（別PR）:** 会員設定画面での本人 PII 自己編集。
- **不変:** 管理者 `createMember`・self-identify 氏名照合は `name` 正典のまま（新列は登録/編集のみ書き込み）。
- **型注意:** `users` 推論型に8列増→ select/型テスト/スナップショットに波及（コンパイルで検出）。
- **外部依存:** zipcloud（本番ホストの outbound 許可・無料/無鍵）。
- **テスト（テストファースト）:** API（registerViaInvite の条件付き検証・合成・段階保存・UNIQUE）/ zip route（成功/失敗/フォールバック）/ フォーム（段階表示・郵便検索）/ admin 編集 / E2E（招待→LINE→各級パターン登録）。

## 6. 設計判断の根拠
- **氏名 完全分割＋ name 正典維持:** ふりがな/姓名分割を補助列で獲得しつつ、表示・照合・UNIQUE は `name` 合成で一元化＝管理者/self-identify への波及を最小化。既存会員は誤分割回避で null。
- **段位は A級必須・既定四段:** A級＝四段以上の前提（ユーザー判断）。`users.dan`（既存 integer 0-9）に 4〜8 を保存。
- **全日協 PII を C級以上で収集・全必須:** 全日協登録には全項目必要（免状・かるた展望の郵送先）。D/E は非収集。性別は既存 enum 準拠で男女のみ。
- **住所検索はサーバー経由 zipcloud＋手入力フォールバック:** CORS回避・テスト容易・障害耐性。
- **PII 可視性=管理者閲覧＋本人編集可:** 身内アプリだが PII なので一般会員には非開示。本人は自己編集可。

## 7. デザインへの宿題（→ /design-screen）※非ブロッキング
- 全必須（氏名＋PII）の flat での伝え方（必須マーク無しで検証依存の是非）。
- 「LINE 認証済み」表示位置の最終調整。A級＋全日協 ON の最長フォームのスクロール感。
