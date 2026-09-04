---
status: completed
---
# 添付ファイルの「開く・保存」導線と Excel プレビュー廃止 実装手順書

> 正典: 要件＝[requirements.md](./requirements.md)（AC は §5）／ 見た目＝[design-spec.md](./design-spec.md) と `design-mock/`。
> **全5タスクは1つの PR で出荷する**（1PR=1機能）。タスク1だけが単独で main に載る状態は作らない（後述の理由）。

## 技術設計の要点（実装前に読む）

- **サーバー route は一切変更しない。** `fetch` → `Blob` の経路は `Content-Disposition` を無視するため、3つのバイナリ route の MIME allowlist・disposition・`nosniff`・`no-store` に触れずに目的を達成できる。`attachment-route-parity.test.ts` は無傷で green のまま（AC-12）。
- **ページ画像 route の 404 は自動で成立する。** 3つの `preview/[page]/route.ts` はいずれも `detectPreviewKind(...) !== 'document'` で 404 を返しているので、Excel が `'spreadsheet'` に分類された時点で 404 になる（AC-3）。ただし**ページ側は同じ条件で「汎用のプレビュー不可カード」へ落ちる**ので、タスク3 を伴わないタスク1 は「Excel が『このファイル形式はアプリ内でプレビューできません』＋削除するはずの但し書き」を出す半端な状態になる。だから両者は同じ PR で出す。
- **`attachment-preview.ts` を client から import しない。** `node:fs/promises` を読むためバンドルが壊れる。今回の新規ボタンは種別判定を必要としない（ファイル名・URL だけで動く）ので、モジュール分割は不要。
- **共有シートへ渡す `File` の MIME は拡張子ベースの自前 allowlist 定数**から引く。`.xlsm` はレスポンスが `application/octet-stream` になるため、`blob.type` をそのまま使うと OS が Excel に紐付けられない。保存値のエコーではないのでヘッダ注入の懸念もない。

## 実装タスク

### タスク1: `attachment-preview` に表示種別 `spreadsheet` を追加する
- [x] 完了
- **目的:** `.xlsx` / `.xls` / `.xlsm` を `document`（ページ画像化）から切り離し、LibreOffice 変換の対象から外す。
- **対応AC:** AC-1, AC-3
- **主な変更領域:** `apps/web/src/lib/attachment-preview.ts` / `apps/web/src/lib/attachment-preview.test.ts`
- **依存タスク:** なし
- **実装メモ:**
  - `AttachmentPreviewKind` に `'spreadsheet'` を追加。
  - `SPREADSHEET_CONTENT_TYPES` = `application/vnd.ms-excel` / `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` / `application/vnd.ms-excel.sheet.macroenabled.12`（`normalizeContentType` が小文字化するので**小文字で**定義する。IANA 表記の `macroEnabled` ではない）。
  - `SPREADSHEET_EXTENSIONS` = `xls` / `xlsx` / `xlsm`。
  - **`OFFICE_CONTENT_TYPES` と `DOCUMENT_EXTENSIONS` から xls / xlsx を必ず削除する**（新しい集合に足すだけでは、判定順によっては旧経路に落ちる）。`OFFICE_EXTENSION_BY_TYPE` からも xls / xlsx を削除する — こうすると `conversionExtension` が Excel を「変換不可」として弾き、変換経路が構造的に閉じる。
  - `detectPreviewKind` は **spreadsheet を document より先に判定**する。
  - ファイル docstring のパイプライン説明を実態に合わせて更新する。
- **必要なテスト:**
  - `detectPreviewKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '名簿.xlsx') === 'spreadsheet'`
  - `detectPreviewKind('application/vnd.ms-excel', '名簿.xls') === 'spreadsheet'` — **集合からの削除漏れを検出するための1本**（追加だけして削除を忘れると落ちる）
  - `detectPreviewKind('application/vnd.ms-excel.sheet.macroenabled.12', '集計.xlsm') === 'spreadsheet'`
  - `detectPreviewKind('application/octet-stream', '名簿.xlsx') === 'spreadsheet'`（拡張子フォールバック）
  - 回帰: pdf / doc / docx / ppt / pptx が `document`、csv・txt が `text`、jpg・png が `image` のまま
- **完了条件:** 上記テストが green。`detectPreviewKind` の全分岐が型で網羅されている（`AttachmentPreviewKind` の union 追加により、3ビューアで未処理分岐があれば型エラーになること）。
- **対応Issue:** #576

### タスク2: 「開く・保存」ボタン（クライアントコンポーネント）を新設する
- [x] 完了
- **目的:** バイナリを取り込み、OS の共有シート（無ければダウンロード）へ渡す唯一の UI 部品を作る。
- **対応AC:** AC-4, AC-5, AC-6, AC-7, AC-8
- **主な変更領域:** `apps/web/src/components/attachment/OpenSaveButton.tsx`（新規）/ `OpenSaveButton.test.tsx`（新規）
- **依存タスク:** なし
- **実装メモ:**
  - `'use client'`。props は `href`（バイナリ route の URL）・`filename`・`variant: 'header' | 'block'` の3つ。`variant` は `Btn` の `size`（`sm` / `md` + `block`）に対応する（design-spec §4 の対応表）。
  - 押下フロー: `fetch(href, { credentials: 'same-origin' })` → `res.ok` 判定 → `blob()` → `new File([blob], filename, { type: pickShareMimeType(filename, blob.type) })`。
  - `pickShareMimeType(filename, fallback)` は**拡張子→MIME の allowlist 定数**（xlsx/xls/xlsm/docx/doc/pptx/ppt/pdf/csv/txt/画像）。未知の拡張子は `fallback`（レスポンスの Content-Type）。
  - 取得した `File` は ref に保持し、再タップでは再取得しない。
  - `navigator.canShare?.({ files: [file] })` が true → `await navigator.share({ files: [file] })`。false/未実装 → `URL.createObjectURL` ＋ 一時 `<a download={filename}>` をクリック → `revokeObjectURL`。
  - 例外分岐: `err.name === 'AbortError'` → **何もせず idle へ戻す**（キャンセル）。`err.name === 'NotAllowedError'` → `retry` 状態（File は保持済みなので次のタップは即 share）。それ以外 → `error` 状態でボタン下に文言。
  - 状態は `idle` / `preparing` / `retry` / `error` の4つ。`preparing` は `disabled`。色は design-spec §5 のとおり（通常=primary、準備中=neutral-bg、retry=warn、error はボタン通常＋下に danger-fg の1行）。
- **必要なテスト（jsdom には `navigator.share` / `canShare` が無いので明示的にスタブする）:**
  - canShare=true: `fetch` が `href` を叩き、`navigator.share` が `files: [File]` 付きで呼ばれる（File の name と type を検証）
  - canShare が未定義: `<a download>` 経路に落ちる（`createObjectURL` が呼ばれ、`revokeObjectURL` される）
  - `share` が `AbortError` を投げる: エラー文言が **表示されない**
  - `share` が `NotAllowedError` を投げる: retry 文言に変わり、**2回目のタップで `fetch` が再度呼ばれない**
  - `fetch` が 401/500/ネットワーク例外: エラー文言が出て、コンポーネントが throw しない
  - 取得中はボタンが `disabled`
- **完了条件:** 上記テストが green。`node:` import ゼロ。lint / typecheck 通過。
- **対応Issue:** #577

### タスク3a: 会員のメール添付ビューアへ組み込む
- [x] 完了
- **目的:** `/mail/attachments/[id]` を新しい導線とカードに差し替える。
- **対応AC:** AC-2, AC-9, AC-9b, AC-10, AC-11, AC-13
- **主な変更領域:** `apps/web/src/app/(app)/mail/attachments/[id]/page.tsx` / `page.test.tsx`（既存）
- **依存タスク:** タスク1（#576）・タスク2（#577）
- **実装メモ:**
  - ヘッダ右の `<a href={binaryUrl}>元ファイル</a>` を `<OpenSaveButton variant="header" …>` に置換（既存の 34px / `text-xs` の寸法感は維持）。
  - `kind === 'spreadsheet'` 分岐を追加し、`📊`＋「Excel ファイルです」＋説明文＋`<OpenSaveButton variant="block">` のカードを出す。**ページ画像 `<img>` を1枚も出さない。**
  - 既存 `fallbackCard` は見出しを「アプリ内では表示できない形式です」に変え、`downloadLink` を `<OpenSaveButton variant="block">` に置換し、**但し書き「iPhone のアプリ内からは…PC からダウンロードしてください。」を削除**。
- **必要なテスト:** xlsx 行で preview `<img>` が0枚かつカード文言が出ること／pdf 行でページ画像が従来どおり出ること／但し書き文字列が DOM に無いこと／「元ファイル」リンクが無いこと／既存の 404・redirect・`?from=` 検証が維持されること
- **完了条件:** 既存テストを壊さずに追加テストが green。
- **対応Issue:** #578

### タスク3b: 管理者のメール添付ビューアへ組み込む
- [x] 完了
- **目的:** `/admin/mail-inbox/attachments/[id]` に同じ変更を入れる。
- **対応AC:** AC-2, AC-9, AC-9b, AC-10, AC-11, AC-13
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/attachments/[id]/page.tsx` / `page.test.tsx`（**新規作成**）
- **依存タスク:** タスク1（#576）・タスク2（#577）
- **実装メモ:** タスク3a と同じ差し替え。ただし**この画面の既存寸法（✕ 40px・`text-sm`・リンク `text-xs`）を維持する**こと。会員側の値をコピーしない。
- **必要なテスト:** 新規 `page.test.tsx`。会員側 `page.test.tsx` のモック構成（`next/navigation` / `@/auth` / `@/lib/db` / `@/lib/attachment-preview`）を土台に、role ベースの認可分岐はこの画面のものに合わせる。検証項目はタスク3a と同じ。
- **完了条件:** 新規テストが green。
- **対応Issue:** #579

### タスク3c: 名簿ファイルビューアへ組み込む
- [x] 完了
- **目的:** `/roster-files/[id]` に同じ変更を入れる。この画面だけボタン位置が異なる。
- **対応AC:** AC-2, AC-9, AC-9b, AC-10, AC-11, AC-14
- **主な変更領域:** `apps/web/src/app/(app)/roster-files/[id]/page.tsx` / `page.test.tsx`（**新規作成**）
- **依存タスク:** タスク1（#576）・タスク2（#577）
- **実装メモ:**
  - この画面は sticky ヘッダを持たないので、`<OpenSaveButton variant="block">` を**タイトルブロックの直下**に置く（design-spec §3・`design-mock/states.html` フレーム⑤）。
  - `kind === 'spreadsheet'` のカードは「上のボタンから」と案内する（ボタンがカード内ではなく上にあるため文言が3a/3b と異なる）。
  - `fallbackCard` の但し書き削除は 3a と同じ。
- **必要なテスト:** 新規 `page.test.tsx`。**モック面が他2つと異なる** — この画面は `db.query.mailAttachments` を直接引かず `@/lib/roster-file-access` の `loadAdoptedRosterFile` / `parseCanonicalRosterFileId` を経由するので、そちらをモックする。未採用・解除済みで 404 になる既存挙動の回帰テストを含める。
- **完了条件:** 新規テストが green。
- **対応Issue:** #580

## 実装順序（Wave = 並行実装できるタスクの組）
- **Wave 1:** タスク1, タスク2（別ファイル・相互依存なし → 並行可）
- **Wave 2:** タスク3a, タスク3b, タスク3c（いずれも Wave 1 に依存。3つは別ファイルで互いに独立 → 並行可）

## 完了ゲート
1. `design-spec.md` §8 忠実度チェックリスト（10項目）を1項目ずつ確認する。
2. `attachment-route-parity.test.ts` を含む既存テスト・lint・typecheck が CI で green（AC-15）。
3. 実機確認（AC-16 iPhone PWA / AC-17 Android / AC-18 PC）は**出荷後**にユーザーが行う。ローカル・CI では共有シートが存在しないため確認できない。
