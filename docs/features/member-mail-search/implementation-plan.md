---
status: completed
---
# member-mail-search 実装手順書

> 正典: `requirements.md`（AC・Non-goals・履歴導出ルール §3.4）と `design-spec.md`（視覚の正＝`design-mock/`・忠実度チェックリスト §8）。
> **マイグレーション不要。管理者側（`/admin/mail-inbox` 配下の画面・Server Action・API）は一切変更しない。**

## 技術設計の要点（全タスク共通の前提）

### ルート構成（すべて新規）

| パス | ファイル | 役割 |
|---|---|---|
| `/mail` | `apps/web/src/app/(app)/mail/page.tsx` | 一覧＋検索（`searchParams: { q?, att? }`） |
| `/mail/[id]` | `apps/web/src/app/(app)/mail/[id]/page.tsx` | 詳細 |
| `/mail/attachments/[id]` | `apps/web/src/app/(app)/mail/attachments/[id]/page.tsx` | 添付ビューア |
| `GET /api/mail/attachments/[id]` | `apps/web/src/app/api/mail/attachments/[id]/route.ts` | 添付バイナリ |
| `GET /api/mail/attachments/[id]/preview/[page]` | `.../preview/[page]/route.ts` | ページ画像 |

### 認可
全ルートで `await auth()` → `session.user.id` の有無のみを見る（role を見ない）。`/admin/entries` 開放時と同じ形。

### 既存ルートを触らずに security drift を防ぐ方針 ★
会員用バイナリルートは管理者ルート（`api/admin/mail/attachments/[id]/route.ts:51-73`）の inline 許可リストとヘッダ方針を**コピーして独立実装**する（共有モジュールへ抽出すると管理者ルートの変更になり、Non-goal に抵触するため）。
コピーの劣化は **ブラックボックスの drift テスト**で防ぐ: 同一の `contentType` 集合（許可リスト内の代表＋`image/svg+xml`・`text/html`・不正文字列）を両ルートに投げ、`Content-Type` / `Content-Disposition` / `X-Content-Type-Options` / `Cache-Control` が**完全一致**することを assert する。管理者ルートのコードには一切手を入れない。

### 履歴導出の構造（`senseki-boundary` 可搬性）
- `apps/web/src/lib/mail-history.ts` — 純関数。入力（1メール分の導出材料）→ `HistoryRow[]`（日時昇順）。H1〜H6。
- `apps/web/src/lib/mail-history.result-import.ts` — **H0 のみ**を担う独立モジュール。`mail-history.ts` はこれを optional に合成するだけで、ファイルごと削除しても H1〜H6 が成立する（AC-33）。
- `apps/web/src/lib/mail-history.queries.ts` — `loadHistoryInputs(mailIds: number[])`。一覧N件ぶんを**一括**で引く（N+1 回避。design-spec §10）。

### 検索
`apps/web/src/lib/member-mail/search.ts`。空白区切りの各語について「件名 / 差出人名 / 差出人アドレス / 本文 / 添付ファイル名 / 添付抽出テキスト のいずれかに部分一致」を AND で重ねる。`ILIKE` のワイルドカードは既存 `lib/players/queries.ts:145` と同じ `replace(/([%_\\])/g, '\\$1')` でエスケープする。添付側の一致は `EXISTS` サブクエリで表現し、メール行が添付数ぶん重複しないようにする。

### 追加読込
既存 `players/ranking/RankingList.tsx` の方式を踏襲: Server Action で次ページを取得し、client component が `exhausted` / `loading` / `error` を保持する。多重実行ガードと「空配列なら終端」も同じ。

---

## 実装タスク

### タスク1: 履歴導出ロジック（純関数＋一括ローダ）
- [x] 完了
- **目的:** requirements §3.4 の H0〜H6 を、画面から独立した純関数として確定させる。一覧・詳細の両方がこれ1つを使う。
- **対応AC:** AC-11, AC-12, AC-12b, AC-13, AC-13b, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-32, AC-33
- **主な変更領域（このタスクだけが触る）:**
  - `apps/web/src/lib/mail-history.ts` ＋ `.test.ts`
  - `apps/web/src/lib/mail-history.result-import.ts` ＋ `.test.ts`
  - `apps/web/src/lib/mail-history.queries.ts` ＋ `.test.ts`
- **依存タスク:** なし
- **必要なテスト:**
  - H1 の対象イベントが `events.tournament_draft_id` の逆参照と `tournament_drafts.event_id` の**和集合**であること（本番34件中10件が後者のみ＝AC-12b の回帰）
  - H2 が `status='sent'` のみを拾い、`sent` 以外を出さない。添付件数＝メールの添付総数。`include_body=false` で「本文と」を落とす
  - H3 の名簿種別による文言差し替え
  - H4/H5 の分岐と、H5 で日付を出さないこと
  - H6 で空配列を返すこと
  - 複数行が日時昇順に並ぶこと
  - `mail-history.result-import.ts` を差し込まない構成でも H1〜H6 が成立する（可搬性＝AC-33）
  - 対象大会ラベルが `deriveEntryGroupName` で畳めるときは単一ラベル、畳めないときは全件
  - `loadHistoryInputs` が N 件を定数回のクエリで引く（N+1 でない）
- **完了条件:** 上記テストが green・`pnpm check-types` 通過
- **対応Issue:** #471

### タスク2: 検索クエリ
- [x] 完了
- **目的:** キーワード横断検索と「添付ありのみ」絞り込みを、ページングつきで提供する。
- **対応AC:** AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-28
- **主な変更領域（このタスクだけが触る）:** `apps/web/src/lib/member-mail/search.ts` ＋ `.test.ts`
- **依存タスク:** なし
- **必要なテスト:**
  - 件名 / 差出人 / 本文 / 添付ファイル名 / 添付抽出テキスト の各1件でヒットする
  - 空白区切り2語が AND で効く
  - キーワード未入力で全件・受信日降順
  - 「添付ありのみ」で添付なしが消える
  - `classification='noise'` と `triage_status='unprocessed'` が結果に含まれる（除外していない）
  - `%` `_` `\` を含む入力がリテラル扱いになる
  - 添付が複数あるメールが結果に重複しない
  - projection に `mail_attachments.data` が含まれない（AC-28）
  - offset/limit が重複・欠落なくページングする
- **完了条件:** 上記テストが green・`pnpm check-types` 通過
- **対応Issue:** #472

### タスク3: 会員向け添付ルート2本
- [x] 完了
- **目的:** 会員がログイン状態で添付のバイナリとページ画像を取得できるようにする。セキュリティ方針は管理者ルートと完全同一。
- **対応AC:** AC-1, AC-3, AC-22, AC-23, AC-24, AC-25
- **主な変更領域（このタスクだけが触る）:**
  - `apps/web/src/app/api/mail/attachments/[id]/route.ts` ＋ `route.test.ts`
  - `apps/web/src/app/api/mail/attachments/[id]/preview/[page]/route.ts` ＋ `route.test.ts`
  - `apps/web/src/app/api/mail/attachments/attachment-route-parity.test.ts`（drift テスト）
- **依存タスク:** なし
- **必要なテスト:**
  - 未ログイン → 401、`role='member'` → 200
  - 許可リスト内の型は宣言 MIME ＋ `inline`、`image/svg+xml` / `text/html` / 不正文字列は `application/octet-stream` ＋ `attachment`
  - `X-Content-Type-Options: nosniff` と `Cache-Control: no-store` を常時付与
  - 非ASCIIファイル名が RFC 5987 形式（`filename*=UTF-8''…`）
  - 不正ID（`1.5` / `1e5` / 負数 / int4 超）が 400、存在しないIDが 404
  - プレビュー生成失敗時に 502（ページルート）
  - **drift テスト:** 同一入力に対し会員ルートと管理者ルートの応答ヘッダが一致する（管理者ルートは読むだけで変更しない）
- **完了条件:** 上記テストが green・管理者ルートのファイルに差分が無い
- **対応Issue:** #473

### タスク4: 一覧画面 `/mail`
- [ ] 完了
- **目的:** 検索・絞り込み・追加読込つきの一覧を、design-mock `list-normal.html` / `edge.html`① の見た目で作る。
- **対応AC:** AC-2, AC-6, AC-7, AC-8, AC-9, AC-10, AC-28
- **主な変更領域（このタスクだけが触る）:**
  - `apps/web/src/app/(app)/mail/page.tsx` ＋ `page.test.tsx`
  - `apps/web/src/app/(app)/mail/actions.ts`（追加読込 Server Action）＋ `actions.test.ts`
  - `apps/web/src/app/(app)/mail/MailSearchBar.tsx`
  - `apps/web/src/app/(app)/mail/MailList.tsx`（client・追加読込）＋ `MailList.test.tsx`
  - `apps/web/src/app/(app)/mail/MailCard.tsx` ＋ `MailCard.test.tsx`
- **依存タスク:** タスク1・タスク2
- **必要なテスト:** 一覧描画（`member` で 403 にならない）／検索・トグルの反映／初回20件＋追加20件で重複欠落なし／履歴サマリ最新1行が出る・未処理では出ない／差出人を出していない／空状態の文言（トグル有効時のみ「外す」提案）
- **完了条件:** テスト green・design-spec §8 の一覧関連項目を満たす
- **対応Issue:** #474

### タスク5: 詳細画面 `/mail/[id]`
- [ ] 完了
- **目的:** design-mock `detail-a-timeline.html` / `history-variants.html` / `edge.html`②③ の見た目で詳細を作る。**セクション順はユーザー確定事項**。
- **対応AC:** AC-19, AC-20, AC-29
- **主な変更領域（このタスクだけが触る）:**
  - `apps/web/src/app/(app)/mail/[id]/page.tsx` ＋ `page.test.tsx`
  - `apps/web/src/app/(app)/mail/MailHistory.tsx` ＋ `MailHistory.test.tsx`（タイムライン表示）
  - `apps/web/src/app/(app)/mail/MailAttachmentRows.tsx` ＋ `.test.tsx`
  - `apps/web/src/app/(app)/mail/MailBody.tsx`（本文の畳み／全文表示）＋ `.test.tsx`
- **依存タスク:** タスク1
- **必要なテスト:** セクション順が ヘッダ→添付→本文→処理の記録／履歴が日時昇順／大会名が `/events/[id]` リンク／H5 で履歴行内に日付文字列が無い（**履歴行要素にスコープして検証**）／H6 で履歴セクションごと出ない／本文も添付も無いメールで例外を出さず本文欄・添付欄が出ない（AC-29）／`body_text` が無ければ `body_html` を生テキスト表示（`dangerouslySetInnerHTML` を使わない）
- **完了条件:** テスト green・design-spec §8 の詳細関連項目を満たす
- **対応Issue:** #475

### タスク6: 添付ビューア `/mail/attachments/[id]`
- [ ] 完了
- **目的:** design-mock `viewer.html` の見た目で、PDF/Office はページ画像、画像はそのまま、text は `<pre>`、その他は不可カードに振り分ける。
- **対応AC:** AC-21, AC-22, AC-26
- **主な変更領域（このタスクだけが触る）:**
  - `apps/web/src/app/(app)/mail/attachments/[id]/page.tsx` ＋ `page.test.tsx`
  - `apps/web/src/app/(app)/mail/attachments/[id]/loading.tsx`
- **依存タスク:** タスク3
- **必要なテスト:** 4種の振り分け／プレビュー生成失敗でも 500 にならずダウンロード導線つきカード（AC-22）／`?from=` が `/mail` 配下でないとき ✕ の戻り先が `/mail` に倒れる（AC-26）／`?from=` が `//evil.example` でも倒れる
- **完了条件:** テスト green・既存 `lib/attachment-preview.ts` を変更していない
- **対応Issue:** #476

### タスク7: ボトムナビの「メール」タブ開放
- [ ] 完了
- **目的:** 一般会員にも「メール」タブを出し、遷移先を role で振り分ける。
- **対応AC:** AC-27, AC-27b
- **主な変更領域（このタスクだけが触る）:** `apps/web/src/components/layout/bottom-nav.tsx` ＋ `bottom-nav.test.tsx`、呼び出し元（`mobile-shell.tsx` 等）で role を渡す箇所
- **依存タスク:** タスク4（`/mail` が存在してから開放する）
- **必要なテスト:** `isAdmin=false` で6タブ（ホーム/イベント/統計/申込管理/メール/設定）がこの順序ちょうど／`isAdmin=false` のメールタブ href が `/mail`／`isAdmin=true` では `/admin/mail-inbox`／`pathname=/mail` でメールタブが active、`pathname=/admin/mail-inbox` でも active／**他タブの表示・並び・href が変わっていない**（既存テストをそのまま維持し、5タブ前提のケースだけを6タブへ更新）／**role-preview 中の挙動**: `isAdmin=false` かつ `previewRoleLabel='一般会員'` でメールタブが表示され href が `/mail`（`layout.tsx:15` の `isAdmin` は `session.user.role`＝実効ロール由来なので、管理者が一般会員プレビュー中は `/mail` を指すのが正。現状は `adminOnly` でタブごと消えている）
- **完了条件:** `bottom-nav.test.tsx` 全件 green
- **対応Issue:** #477

### タスク8: 忠実度チェックと回帰
- [ ] 完了
- **目的:** 確定デザインが実装で劣化していないことを確認し、既存への影響ゼロを担保する。
- **対応AC:** AC-30, AC-31, AC-34
- **主な変更領域:** 仕上げの微修正のみ（新規ファイルは作らない）
- **依存タスク:** タスク1〜7すべて
- **必要なテスト:** 追加なし（既存スイート）
- **完了条件:**
  - `design-spec.md` §8 忠実度チェックリスト 12項目を1つずつ確認しチェック
  - `apps/web` のテスト・`pnpm lint`・`pnpm check-types` が通る（フルスイートは CI に委譲）
  - `git diff` に `apps/web/src/app/(app)/admin/mail-inbox/**` と `apps/web/src/app/api/admin/**` の変更が**含まれていない**ことを確認
  - AC-34（実機375px）は出荷後にユーザーが確認する残タスクとして worklog に記録
- **対応Issue:** #478

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1:** タスク1（`lib/mail-history*`）／タスク2（`lib/member-mail/`）／タスク3（`app/api/mail/`） — 互いに依存なし・ディレクトリが完全に直交
- **Wave 2:** タスク4（`app/(app)/mail/` 直下の一覧系ファイル）／タスク5（`app/(app)/mail/[id]/` と表示コンポーネント）／タスク6（`app/(app)/mail/attachments/`） — 同一ディレクトリだが**触るファイルが重ならない**（上記の変更領域リストがファイル単位の契約）
- **Wave 3:** タスク7（`components/layout/bottom-nav.tsx`）
- **Wave 4:** タスク8（仕上げ・忠実度チェック）
