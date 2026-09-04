---
status: completed
---
# payment-receipt-broadcast 実装手順書

親 Issue: #554

要件定義書: [requirements.md](./requirements.md)（AC は §4）。design-screen はユーザー判断でスキップ（見た目の指針は requirements §8）。

## 技術設計の要旨

### データモデル（migration 0062・新規2テーブル）

| テーブル | 役割 |
|----------|------|
| `entry_group_payment_reports` | **支払報告1回＝1行**。対象日・想定額とその出典・送信本文のスナップショット・送信状態を持つ。`entry_group_id` FK は `ON DELETE CASCADE`（`entry_group_payment_notices` と同じ規律） |
| `entry_group_payment_receipts` | **証憑画像1枚＝1行**。正規化後の JPEG 本体（`bytea`）とプレビュー（`bytea`）、公開取得用の推測不能トークン。`report_id` FK は `ON DELETE CASCADE` |

`entry_group_payment_reports` の主な列: `entry_group_id` / `event_ids`(jsonb・対象日のスナップショット) / `amount_jpy`(nullable) / `amount_source`(`payment_notice` \| `tally` \| `none`) / `unknown_grade_count` / `message_text`(送信本文の正本＝再送の再現性 AC-18) / `receipt_count` / `status`(`sent` \| `failed` \| `skipped_unlinked`) / `error_message` / `last_sent_at` / `created_by`(users FK・`ON DELETE SET NULL`) / `created_at` / `updated_at`。

`entry_group_payment_receipts` の主な列: `report_id` / `sort_order` / `filename` / `content_type`(常に `image/jpeg`) / `data`(bytea) / `byte_size` / `width` / `height` / `preview_data`(bytea) / `token`(text UNIQUE) / `created_at`。

- `bytea` は `mail-attachments.ts` の `customType` をそのまま踏襲する
- `status` は既存 `entry_form_drafts.status` と同じ流儀（pgEnum を新設せず text + `$type<...>()`）
- `event_ids` は `int[]` ではなく **jsonb**（`entry_group_payment_notices.grade_counts` の前例に倣う。raw SQL での `int[]` バインドの罠を避ける）

### 画像の扱い

- **クライアント側で縮小してから送る**: 選択直後に canvas で長辺 2048px・JPEG q0.85 へ再エンコードし、base64 で Server Action へ渡す（既存 `entry-form` の `fileToBase64` と同じ経路）。`serverActions.bodySizeLimit` は現行 `4mb`。3枚でも base64 込みで収まる見込みだが、**`8mb` へ引き上げる**（明細は文字が読めることが要件なので縮小しすぎない）
- **サーバー側で必ず再検証・再正規化**（クライアントを信用しない）: `sharp` で metadata を読み `format ∈ {jpeg, png}` 以外は拒否（PDF・HEIC はここで落ちる）→ `.rotate()`（EXIF 向き）→ 長辺 4096px 以内へ縮小 → JPEG 化 → 10MB を超えるうちは quality を段階的に下げる。それでも収まらない1枚は**その枚だけ除外**して理由を返す
- プレビューは長辺 1024px・1MB 以内の JPEG を別途生成（LINE の `previewImageUrl` 制約と、履歴のサムネ表示に使う）
- **HEIC はデコード不可**（sharp 0.34 / libvips 8.17.3 の `heif` 入力は `.avif` のみ・実測確認済み）。クライアント側の canvas デコードも失敗するため、その場で日本語のエラーを出す

### 送信

- 文言・画像を組み立ててから状態を `paid` に変える（AC-12）
- **証憑0枚**: 現行と同一。`setPaymentsPaid` の claim 経路（`sendClaimedNotificationBulk`）をそのまま通す
- **証憑1枚以上**: claim できた日があれば `sendClaimedNotificationBulk` に `[text, image...]` の配列を渡して1回の push、claim できる日が無ければ `pushMessagesToEntryGroup` で直接送る（AC-13）。どちらも宛先は同じグループの Bot
- 画像メッセージは `originalContentUrl` = `/api/line-broadcast/payment-receipts/<token>`、`previewImageUrl` = 同 `/preview`（いずれも `PUBLIC_BASE_URL` 起点の https 絶対 URL。既存 `attachmentImageUrl` と同じ規律）
- **route を `api/line-broadcast/` 配下に置く理由**: `middleware.ts` の公開判定は `config.matcher` の否定先読みで行われており、`api/line-broadcast` が既にそこに列挙されている。同じ配下に置けば **matcher を編集せずに認証を素通りできる**（LINE の画像フェッチャは Cookie を送らないため、除外し損ねると全画像がログイン画面へリダイレクトされ、メッセージだけが黙って壊れる）
- **`image-cache.ts` は使わない**。証憑は記録として永続保存するので、公開 route は DB から直接引く

### 既存コードへの触り方

- `events/[id]/actions.ts` の `setPaymentsPaid` は**中身を `applyPaymentsPaid(ids, opts)` へ抽出**し、`setPaymentsPaid` はその薄いラッパーに戻す。日ページ由来のラッパー `setPaymentPaid` の呼び出し契約は不変
- グループページの新 Server Action `reportPayment(groupId, eventIds, receipts)` が `applyPaymentsPaid` を呼ぶ。`GroupDayTable` の `setPaymentsPaidAction` はこの新 action に差し替える（証憑0枚なら現行と同一挙動）

## 実装タスク

### タスク1: スキーマ2テーブルと migration 0062
- [ ] 完了
- **目的:** 支払報告の記録と証憑画像の永続保存先を用意する
- **対応AC:** AC-17, AC-19, AC-20
- **主な変更領域:** `packages/shared/src/schema/entry-group-payment-reports.ts`（新規）・`entry-group-payment-receipts.ts`（新規）・`schema/index.ts`・`schema/relations.ts`・`packages/shared/drizzle/0062_*.sql`
- **依存タスク:** なし（**共有ホットスポット。他タスクに先行して単独で行う**）
- **必要なテスト:** スキーマの型テストは書かない。CASCADE 挙動（report 削除で receipt が消える／グループ削除で両方消える）を DB テストで1本
- **完了条件:** `pnpm db:generate` で 0062 が生成され、`pnpm --filter=@kagetra/shared test` と型チェックが通る
- **対応Issue:** #555

### タスク2: 証憑画像の正規化ユーティリティ
- [ ] 完了
- **目的:** 受け取った画像を LINE が受け付ける JPEG（本体・プレビュー）へ確実に正規化し、対応外形式を拒否する
- **対応AC:** AC-5, AC-6, AC-7
- **主な変更領域:** `apps/web/src/lib/payment-receipt/image.ts`（新規）・同 `image.test.ts`
- **依存タスク:** なし
- **必要なテスト:** PNG→JPEG 変換／4096px 超の縮小／10MB を超え続ける入力の除外／PDF バイト列と HEIC バイト列の拒否／EXIF 回転の適用。テスト用の画像は `sharp` でその場生成する（固定バイナリを repo に置かない）
- **完了条件:** 上記テストが green・`eslint` 通過
- **対応Issue:** #556

### タスク3: 想定金額の決定と文言の組み立て
- [ ] 完了
- **目的:** 「景虎上の想定金額」を要件 §3.2.3 の優先順で決め、LINE 本文を組み立てる
- **対応AC:** AC-8, AC-9, AC-10, AC-11, AC-2
- **主な変更領域:** `apps/web/src/lib/events/payment-report-amount.ts`（新規）・`apps/web/src/lib/payment-report-message.ts`（新規）・各 `.test.ts`
- **依存タスク:** なし
- **必要なテスト:** 振込連絡が送信済み／未送信／`total_jpy` が算出不能 の3分岐。級未設定注記が tally 由来のときだけ入ること。**証憑0枚の本文が `buildLifecycleMessage('payment_paid', …)` の戻り値と文字列一致すること**（回帰固定）
- **完了条件:** 上記テストが green
- **対応Issue:** #557

### タスク4: 証憑画像の公開取得 route
- [ ] 完了
- **目的:** LINE の画像フェッチャと管理画面のサムネが、推測不能トークンで証憑を取得できるようにする
- **対応AC:** AC-6, AC-20
- **主な変更領域:** `apps/web/src/app/api/line-broadcast/payment-receipts/[token]/route.ts`（新規）・`.../[token]/preview/route.ts`（新規）・`route.test.ts`。**`middleware.ts` は編集しない**（`config.matcher` の否定先読みに既にある `api/line-broadcast` を継承する）
- **依存タスク:** タスク1
- **必要なテスト:** 正しいトークンで 200 と `Content-Type: image/jpeg`／不正形式トークンで 404／存在しないトークンで 404。**`middleware.ts` の `config.matcher` が `api/line-broadcast` を除外していること**を文字列で固定する回帰テスト1本（この route が認証の内側へ落ちるとメッセージが黙って壊れるため）
- **完了条件:** 上記テストが green。既存 `line-broadcast/images/[token]` と同じトークン形式ガード（`/^[A-Za-z0-9_-]{16,64}$/`）を持つ
- **対応Issue:** #558

### タスク5: `setPaymentsPaid` の内部抽出（`applyPaymentsPaid`）
- [ ] 完了
- **目的:** 支払済化＋通知の本体を、証憑つき送信から再利用できる形に切り出す。**既存の外部契約は一切変えない**
- **対応AC:** AC-2, AC-14, AC-23, AC-24
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/actions.ts`
- **依存タスク:** なし（タスク6 の前に完了していること）
- **必要なテスト:** 新規テストは書かない。**既存の `lifecycle-actions.test.ts` / `actions.bulk-lifecycle.test.ts` を1行も書き換えずに green** であることが完了条件（これが回帰の証明）
- **完了条件:** 既存テスト green・`setPaymentsPaid` / `setPaymentPaid` のシグネチャ不変。★**挙動差分ゼロの純粋な抽出であること**（タスク6 と合わせて1つのレビュー単位になるため、既存テストの無改修 green だけが「抽出が綺麗だったか」と「抽出に意味的変更が混ざったか」を区別する材料になる）
- **対応Issue:** #559

### タスク6: Server Action `reportPayment`（証憑つき支払報告）
- [ ] 完了
- **目的:** 証憑の検証・保存・状態変更・LINE 送信・記録の作成を1つの操作としてまとめる
- **対応AC:** AC-3, AC-4, AC-5, AC-12, AC-13, AC-15, AC-16, AC-17, AC-21
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/[groupId]/actions.ts`・同 `actions.payment-report.test.ts`（新規）・**`apps/web/next.config.ts`**（`serverActions.bodySizeLimit` を `4mb` → `8mb`。★全 Server Action に効く**グローバルな変更**なので差分レビューで見えるようにここに明記する）
- **依存タスク:** タスク1, 2, 3, 5
- **必要なテスト:** 証憑0枚＝現行と同一の push 内容／1枚で text+image が1回の push／4枚目を渡すと拒否／PDF を渡すと拒否／claim できない状況でも証憑ありなら送信される／LINE 未連携なら送信せず保存だけ・`status='skipped_unlinked'`／push 失敗で `paid` は維持し `status='failed'`／非管理者セッションで `Forbidden`
  - ★**テストで `PUBLIC_BASE_URL` を https の値に設定すること**。未設定だと `line-broadcast.ts` の検証が throw し、検証したい内容と無関係な理由でテストが落ちる
  - ★AC-12 のテストは「金額が変わらないこと」ではなく**「flip 前の状態から金額が算出されていること」を assert する**（現在の `tallyEntryFeesForGroup` は支払済の日を除外しないため、順序を入れ替えても値が動かず、値の比較では順序の退行を検出できない）
- **完了条件:** 上記テストが green。zod による入力再検証（枚数・base64・サイズ）がサーバー側にあること
- **対応Issue:** #560

### タスク7: 再送 Server Action `resendPaymentReport`
- [ ] 完了
- **目的:** 送信に失敗した（またはもう一度届けたい）支払報告を、同じ内容で送り直す
- **対応AC:** AC-16, AC-18, AC-21
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/[groupId]/actions.ts`・同テスト
- **依存タスク:** タスク6
- **必要なテスト:** 保存済み `message_text` がそのまま送られること（現在の集計値を変えても本文が揺れない）／画像も同じ枚数・同じトークンで送られること／成功で `last_sent_at` 更新・`status='sent'`／非管理者で `Forbidden`
- **完了条件:** 上記テストが green
- **対応Issue:** #561

### タスク8: 支払報告シートとボタン改称
- [ ] 完了
- **目的:** 「支払済にする」を「支払報告」へ改称し、押下で写真選択＋プレビュー＋実行のシートを開く
- **対応AC:** AC-1, AC-4, AC-22, AC-23
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/[groupId]/components/PaymentReportSheet.tsx`（新規）・`GroupDayTable.tsx`・`page.tsx`（action の差し替え）・各 `.test.tsx`
- **依存タスク:** タスク2, 3, 6
- **必要なテスト:** ボタン表示が「支払報告」で「支払済にする」が DOM に無いこと／4枚目を選べないこと／HEIC 選択時に日本語エラーが出ること／プレビューに本文と選んだ枚数が出ること／現地払いのみ選択時はボタンが無効
- **完了条件:** 上記テストが green。ボトムシートは `createPortal` + `.modal-overlay-h` 規約（requirements §8）
- **対応Issue:** #562

### タスク9: 支払報告の履歴表示と再送導線
- [ ] 完了
- **目的:** 誰がいつ何を送ったかをグループページで見返し、そこから再送できるようにする
- **対応AC:** AC-17, AC-18, AC-19
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/[groupId]/components/GroupProgressSection.tsx`・`page.tsx`（履歴の取得）・`.test.tsx`
- **依存タスク:** タスク1, 7, 8（`page.tsx` をタスク8と共有するため直列にする）
- **必要なテスト:** 履歴が新しい順に並ぶこと／想定額・枚数・状態が出ること／未払に戻しても履歴が残ること／非管理者には描画されないこと
- **完了条件:** 上記テストが green
- **対応Issue:** #563

### タスク10: ドキュメント更新
- [ ] 完了
- **目的:** docs レジストリの正典を実装と同じコミット群で揃える（DoD の D2 ゲート）
- **対応AC:** AC-24
- **主な変更領域:** `docs/spec/`（申込・支払ドメインの該当ファイル）・`docs/design/db.md`（新規2テーブル）・`docs/features/INDEX.md`（主要領域の確定）
- **依存タスク:** タスク1〜9
- **必要なテスト:** なし
- **完了条件:** `gate-dod.sh` の D2 が PASS
- **対応Issue:** #564

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1**: タスク1（`packages/shared` の共有ホットスポット。単独で先行）
- **Wave 2**: タスク2, タスク3, タスク4, タスク5（互いに依存なし・変更ファイルが完全に分かれている）
  - タスク4 はタスク1 の schema に依存するので Wave 1 の後。タスク2/3/5 は Wave 1 と無関係だが、migration 番号の衝突回避のため Wave 1 の後に揃える
- **Wave 3**: タスク6（複数レイヤー跨ぎ・main が担当）
- **Wave 4**: タスク7（タスク6 と同一ファイル）
- **Wave 5**: タスク8（`page.tsx` を触る）
- **Wave 6**: タスク9（`page.tsx` をタスク8 と共有するため直列）
- **Wave 7**: タスク10

> `packages/shared` の変更（タスク1）が入るため、テストは全パッケージへ波及する。Wave 中のワーカーはテストを実行しない（project-profile の `worker_verify: none`）。
