---
name: feature-def-attachment-open-download
description: attachment-open-download 要件定義
type: project
---

# attachment-open-download 要件定義（2026-09-04）

添付ビューア3画面（`/mail/attachments/[id]`・`/admin/mail-inbox/attachments/[id]`・`/roster-files/[id]`）の改修（delta）。正典 = `docs/features/attachment-open-download/`（requirements.md / design-spec.md locked / design-mock/ / implementation-plan.md）。

## 動機になった実データ
- 本番添付 366件のうち **Excel 180・PDF 114・Word 62**。ローカル dev DB でも xlsx 71件が最多。**Excel はほぼ正しい MIME で届く**（octet-stream ではない）ので現行は inline 配信になっている。
- つまり「Excel が Excel で開けない」「ダウンロードできない」は同根＝**iOS PWA が same-origin URL を同一 WebView で開き、QuickLook から戻れない**（PR #146 の制約）。PC では普通に開けているので発覚が遅れていた。

## 主要な設計判断
- **共有シート（Web Share API `navigator.share({files})`）を第一手段にする。** iOS PWA は `Content-Disposition: attachment` を白画面死させ、inline も戻れない。ファイルを OS に渡す残る道が共有シートだけ。無ければ `<a download>` にフォールバックするラダー構造にして、片方が動かなくても壊れないようにした。
- **サーバー route は一切変更しない。** `fetch` → `Blob` は Content-Disposition を無視するので、3ルートの MIME allowlist・disposition・nosniff・no-store に触れずに済む。`attachment-route-parity.test.ts` が無傷。（当初 `?download=1` で disposition を切り替える案を検討したが不要と判明）
- **Excel（xlsx/xls/xlsm）はページ画像プレビューを廃止**し、新種別 `spreadsheet` にする。表計算のページ画像は列切れ・ページ分割で実用にならず、最多の添付種別のために毎回 LibreOffice を走らせるコストだけが残っていた。
- ★**罠: 3つの `preview/[page]/route.ts` は `detectPreviewKind(...) !== \x27document\x27` で 404 を返すので Excel 404 は自動成立するが、ビューアページも同じ条件で「プレビューできません」カード＋削除予定の但し書きに落ちる。** Task1 単独マージ禁止。
- **現行の但し書き「iPhone のアプリ内からは元ファイルを開けないことがあります。必要な場合は PC からダウンロードしてください。」は3画面から削除。** この機能がその制約自体を解消するため。
- デザインは案A（ヘッダにラベル付き `⤴ 開く・保存` ボタン）。案B（アイコンのみ）は PDF で導線の文字が画面から消えるため不採用。

## Acceptance Criteria
全19件（auto-test 16 / manual 3）。manual は iPhone PWA・Android・PC の実機3件のみ（共有シートはローカル・CI で再現不能）。

## Issue / Wave
親 #575 ／ 子 #576（spreadsheet 種別）・#577（OpenSaveButton）・#578（会員）・#579（管理者）・#580（名簿）。
Wave1 = #576 ∥ #577、Wave2 = #578 ∥ #579 ∥ #580（3ページは別ファイルで独立。ただし #580 だけ `loadAdoptedRosterFile` 経由でモック面が違う）。

## この定義中に判明した環境の事実
- **ローカル dev DB（kagetra-db:5433）は 63 マイグレーション中 3 件しか適用されておらず**、`mail_messages.triage_status` も `tournament_entry_roster_files` も無い。mail 系ページはローカルで 500 になるため **/design-screen の Path L が使えず Path D（モック）を選択**した。
- **DesignSync（claude.ai/design）はこのセッションでは未認可**で使えない（`/design-login` が非対話セッションでは走らない）。モックはローカル HTML のみで確定し、閲覧用に `design-mock/_preview.html`（トークン CSS を inline した1ファイル）を生成する運用にした。
- `docs/features/colors_and_type.css` は存在しない（既存モックのリンクが切れている）。現行トークンの正典は **`docs/design/colors_and_type.css`**（2026-08-29 の藤×墨版）。
