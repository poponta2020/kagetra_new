---
status: completed
mode: 改修（delta）
completed_sections: [現行挙動ベースライン, 変更内容, Acceptance Criteria と Non-goals, 技術的制約・契約]
approved_at: 2026-09-04
design_required: true
---
# 添付ファイルの「開く・保存」導線と Excel プレビュー廃止 要件定義書

## 1. 概要

### 目的
アプリ内の添付ファイルビューアに **OS 側へファイルを渡す導線（開く・保存）** を追加し、
**表計算ファイル（Excel）はページ画像プレビューをやめて「Excel で開く」前提**に切り替える。

### 背景・動機
- 本番の添付は **Excel が最多**（member-mail-search 調査時点で 366 件中 Excel 180・PDF 114・Word 62・画像 8・zip 1）。ローカル DB でも xlsx 71 件が最多。
- 現行ビューアは PDF/Office を LibreOffice → PDF → ページ JPEG に変換して `<img>` 縦積みで表示する。**PDF/Word には有効だが、表計算では列が切れる・意図しないページ分割が起きるなど実用にならない。**
- ヘッダの「元ファイル」リンクはバイナリ route への素の遷移。iOS ホーム画面 PWA（`scope: "/"`）では same-origin URL は同一 WebView が遷移してしまい、QuickLook 表示から**戻る UI がゼロ**になる（PR #146 で確定済みの制約）。つまり実機では「元ファイル」は事実上使えない。
- 結果として、**Excel を Excel として開く手段も、端末に保存する手段も、モバイルには存在しない**。

## 2. ユーザーストーリー
- 対象ユーザー: ログイン済みの全会員（管理者・副管理者含む）。主な端末は **iPhone のホーム画面アプリ（PWA）と Android**。PC ブラウザも利用する。
- 目的: メール添付や採用済み名簿の Excel を、**手元の Excel／表計算アプリで開く**。あるいは端末に保存して後で使う。
- シナリオ:
  1. 申込名簿の xlsx をアプリで開く → 「開く・保存」→ 共有シート →「Excel にコピー」で中身を確認する。
  2. 大会要項の PDF をアプリ内でページ画像で読む → 手元に残したいので「開く・保存」→「ファイルに保存」。

## 3. 現行挙動ベースライン（devflow 導入前後に分散して実装された部分の棚卸し）

対象ビューアは3画面。表示ロジックはいずれも `@/lib/attachment-preview` の `detectPreviewKind` に従う（実装は意図的に独立コピー）。

| 画面 | ページ | バイナリ route | ページ画像 route |
|---|---|---|---|
| 会員メール添付 | `/mail/attachments/[id]` | `/api/mail/attachments/[id]` | `…/preview/[page]` |
| 管理者メール添付 | `/admin/mail-inbox/attachments/[id]` | `/api/admin/mail/attachments/[id]` | `…/preview/[page]` |
| 名簿ファイル | `/roster-files/[id]` | `/api/roster-files/[id]` | `…/preview/[page]` |

現行の振り分け（`detectPreviewKind`）:
- `document`（PDF / doc / docx / xls / xlsx / ppt / pptx）→ LibreOffice + pdftoppm でページ JPEG 化 → `<img>` 縦積み
- `image`（jpeg/png/gif/webp/heic/heif）→ バイナリ route を `<img>` 表示
- `text`（text/plain・text/csv）→ bytea を UTF-8 で `<pre>` 表示（先頭 100,000 文字まで）
- `none`（zip・xlsm 等）→ プレビュー不可カード＋「元ファイルをダウンロード」リンク

現行の導線: ヘッダ右の「元ファイル」（`<a href={binaryUrl} target="_blank">`）と、フォールバックカード内の「元ファイルをダウンロード」の2つ。どちらもバイナリ route への素の遷移。

## 4. 変更内容

### 4.1 「開く・保存」導線の追加（対象＝すべての添付種別・3画面共通）

- ヘッダ右の「元ファイル」リンクと、フォールバックカード内のダウンロードリンクを、**1つの「開く・保存」ボタン**に置き換える（クライアントコンポーネント）。
- 押下時の動作（ラダー）:
  1. バイナリ route を同一オリジン fetch して `Blob` を取得し `File` を組み立てる。
  2. `navigator.canShare?.({ files: [file] })` が true → `navigator.share({ files: [file] })` で **OS の共有シート**を開く。iOS なら「Excel にコピー」「ファイルに保存」、Android なら同等の選択肢が出る。
  3. 共有が使えない環境（PC ブラウザ等）→ `blob:` URL ＋ `<a download>` で**その場ダウンロード**にフォールバックする。
  4. 共有シートをユーザーがキャンセルした（`AbortError`）→ **エラー表示はしない**。
  5. 取得済みバイトはボタン側に保持し、再タップ時は再ダウンロードしない。
- 取得中はボタンを「準備中…」等の待ち状態にし、二重押下を防ぐ。取得失敗時はその場にエラー文言を出す（ページは 500 にしない）。
- 「開く・保存」は **プレビューが出ているファイルにも常に出す**（PDF・画像・テキストを含む全種別）。
- 現行カードの但し書き「iPhone のアプリ内からは元ファイルを開けないことがあります。必要な場合は PC からダウンロードしてください。」は **3画面すべてから削除する**。この機能がその制約自体を解消するため、残すと事実と食い違う案内になる（デザイン収束ループで確定）。

### 4.2 表計算ファイルのページ画像プレビューを廃止（3画面一律）

- `.xlsx` / `.xls` / `.xlsm`（および対応 MIME）を新しい表示種別 **`spreadsheet`** として扱う。
- `spreadsheet` は **ページ画像を生成も表示もしない**。代わりに「この形式はアプリ内で表示しません。Excel 等で開いてください」旨のカード＋「開く・保存」ボタンだけを出す。
- 判定は既存方針を踏襲し **MIME 優先・拡張子フォールバック**（送信側 MUA が octet-stream で送ってくるため）。
- ページ画像 route（`…/preview/[page]`）は `spreadsheet` に対して **404** を返す（LibreOffice 変換を走らせない）。
- 対象外: `.csv` は従来どおり `text` としてテキスト表示のまま。Word / PowerPoint / PDF は従来どおりページ画像プレビューを維持する。

### 4.3 画面と遷移
画面インベントリ・遷移は現行から**変わらない**（3ビューアの URL・`?from=` による ✕ の戻り先・チップからの遷移すべて維持）。変わるのはビューア内の操作要素とプレビュー本体のみ。見た目の正典は `design-spec.md`（delta）。

### 4.4 エラー・境界条件

| 条件 | 挙動 |
|---|---|
| 共有シートをキャンセル | 何も起きない（エラー表示なし） |
| iOS でユーザー操作の有効期限切れ（`NotAllowedError`） | 取得済みバイトを保持したまま「もう一度タップ」を促す状態にする |
| バイナリ取得が失敗（401/404/ネットワーク） | ボタン近傍にエラー文言。ページは落とさない |
| 共有も `<a download>` も使えない環境 | バイナリ route への素のリンクを最終フォールバックとして残す |
| 空ファイル（0 バイト） | 取得はできるので通常どおり共有／保存に流す |
| PDF/Word の変換失敗 | 従来どおりプレビュー不可カード（そこに「開く・保存」が付く） |

## 5. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-1 | `detectPreviewKind` が `.xlsx` / `.xls` / `.xlsm` を `spreadsheet` に分類する（正しい MIME でも、octet-stream＋拡張子でも） | auto-test |
| AC-2 | 3ビューア（会員メール添付・管理者メール添付・名簿ファイル）とも、Excel ではページ画像 `<img>` を出さず「開く・保存」導線付きカードを表示する | auto-test |
| AC-3 | ページ画像 route（3経路）は `spreadsheet` の添付に対して 404 を返し、LibreOffice 変換を起動しない | auto-test |
| AC-4 | `navigator.canShare({files})` が true の環境では、ボタン押下でバイナリを取得し `navigator.share` にファイル付きで渡す | auto-test |
| AC-5 | 共有が使えない環境では `<a download>`（blob URL）によるダウンロードにフォールバックする | auto-test |
| AC-6 | 共有シートのキャンセル（`AbortError`）でエラー文言が表示されない | auto-test |
| AC-7 | `NotAllowedError` のとき、取得済みバイトを保持したまま再試行を促す状態になり、再タップで再取得せずに共有できる | auto-test |
| AC-8 | バイナリ取得が失敗したとき、ページを落とさずボタン近傍にエラー文言が出る | auto-test |
| AC-9 | 「開く・保存」ボタンが PDF・画像・テキスト・zip を含む全種別のビューアに表示され、従来の「元ファイル」リンクが3画面のどこにも残っていない | auto-test |
| AC-9b | 但し書き「iPhone のアプリ内からは元ファイルを開けないことがあります。…」が3画面のどこにも表示されない | auto-test |
| AC-9c | 共有も `<a download>` も使えない環境・取り込みに失敗した環境のいずれでも、バイナリ route への素のリンクが表示される（原本への行き止まりを作らない） | auto-test |
| AC-10 | PDF / Word / PowerPoint のページ画像プレビューが従来どおり表示される（回帰） | auto-test |
| AC-11 | `text/plain` / `text/csv` のテキスト表示、ラスタ画像の `<img>` 表示が従来どおり（回帰） | auto-test |
| AC-12 | バイナリ route 3経路のレスポンスヘッダ（Content-Type / Content-Disposition / nosniff / no-store）が変更前と同一で、`attachment-route-parity.test.ts` が green（回帰） | auto-test |
| AC-13 | 未ログイン・ゲストロールに対する各 route / ページの拒否が従来どおり（回帰） | auto-test |
| AC-14 | 名簿ファイルは未採用・解除済みで従来どおり 404（回帰） | auto-test |
| AC-15 | 既存テスト・lint・typecheck が CI で green | auto-test |
| AC-16 | iPhone のホーム画面 PWA で、Excel 添付から「開く・保存」→ 共有シート → Excel アプリで開ける／ファイルに保存できる | manual |
| AC-17 | Android Chrome で、Excel 添付から「開く・保存」→ 共有シート経由で保存・アプリで開ける | manual |
| AC-18 | PC ブラウザで「開く・保存」を押すと、そのままファイルがダウンロードされる | manual |

## 6. Non-goals（今回やらないこと）

- **アプリ内で Excel の中身を表として描画する**（SheetJS 等での表ビューア実装）。今回は OS 側アプリに委ねる。
- **公開トークン route（`/api/line-broadcast/attachments/[token]`）の変更**。非認証・脅威モデルが別物で、「常に attachment 固定」の方針を維持する。
- **バイナリ route の MIME allowlist / Content-Disposition ポリシーの変更**。`.xlsm` を inline 許可に加える等は行わない（fetch → 共有シート経路は disposition の影響を受けないため不要）。
- **manifest scope を外れる別オリジンでの配信**（scope 脱出による in-app browser overlay の獲得）。インフラ変更が必要で、今回の範囲外。
- 添付のサイズ上限・圧縮・遅延ロードの見直し。
- メール一覧・詳細・大会詳細など、ビューアの**外側**の画面レイアウト変更。
- ビューアの ✕ 戻り先ロジック（`?from=`）の変更。

## 7. 技術的制約・契約

- **3ビューアは意図的な独立コピー**であり、`attachment-route-parity.test.ts` が管理者／会員のバイナリ route のヘッダ一致を守っている。共通化は今回の目的ではない（「開く・保存」ボタンだけは 3 画面で共有する UI 部品にしてよい）。
- バイナリ route のレスポンス `Content-Type` は **allowlist 定数か `application/octet-stream` のみ**。保存値をそのままエコーしない現行の不変条件を維持する（ヘッダ注入の構造的封じ込め）。
- `Cache-Control: no-store` / `X-Content-Type-Options: nosniff` を維持する。
- 認可の実防御は Node 側（`isGuestRole` チェック等）。middleware の JWT role は降格直後に stale になりうるため、ここを緩めない。
- `@/lib/attachment-preview` は `node:fs/promises` を import するため、**クライアントコンポーネントから読み込まない**（バンドル破壊）。種別判定を client 側で使う必要があるなら、純粋な判定関数だけを Node 依存のないモジュールへ切り出す。
- 共有シートに渡す `File` の MIME は、**拡張子ベースの自前 allowlist 定数**か、レスポンスの Content-Type を用いる（保存値の生エコーはしない）。
- Web Share API のファイル共有が iOS ホーム画面 PWA / Android で実際に動くかは**実機でしか確認できない**（AC-16/17 が manual なのはこのため）。要件は「共有が使えなければダウンロードへフォールバックする」ラダーとして書いてあり、片方が動かなくても機能が壊れない構造にする。

## 8. デザイン（解決済み）

見た目の正典は **`design-spec.md`（status: locked）と `design-mock/`**。ここでは再記述しない。要点だけ:
- 案A（ヘッダにラベル付き `⤴ 開く・保存` ボタン）を採用。案B（アイコンのみ）は PDF で導線の文字が画面から消えるため不採用。
- 表計算カードの見出しは「Excel ファイルです」（＝*できない*ではなく*しない*）。zip・変換失敗のときだけ「アプリ内では表示できない形式です」。
- ボタン4状態の色: 通常＝brand ／ 準備中＝neutral-bg + disabled ／ もう一度タップ＝warn ／ 失敗＝ボタンは通常のまま下に danger-fg の1行。
- 名簿ビューアだけ sticky ヘッダを持たないため、ボタンはタイトル直下。
- 実装の完了ゲート＝`design-spec.md` §8 忠実度チェックリスト（10項目）。

## 9. 設計判断の根拠

- **共有シート（Web Share）を第一手段にする**: iOS ホーム画面 PWA は `Content-Disposition: attachment` を白画面死させ、inline も同一 WebView 遷移で戻れなくなる。ファイルを OS へ渡す残る道が共有シートしかない。
- **サーバー route を変えない**: fetch → Blob 経路は disposition を無視するため、ヘッダポリシーを触らずに目的を達成できる。parity テストと fail-closed allowlist を無傷で保てる。
- **Excel のプレビューを消す**: 表計算のページ画像は列切れ・ページ分割で実用にならず、最多の添付種別のために毎回 LibreOffice を走らせるコストだけが残る。表示をやめれば変換コストもゼロになる。
- **1ボタンに集約**: iOS では「開く」も「保存」も同じ共有シートに落ちるため、2ボタンに分けると同じ挙動が2つ並ぶことになる。

## 変更履歴
- 2026-09-04: 新規作成（3ビューアの現行挙動をベースライン化し、「開く・保存」導線の追加と Excel プレビュー廃止を定義）
- 2026-09-04: デザイン収束ループの結果を反映（案A 採用・現行の但し書きを削除・AC-9b 追加・§8 をデザイン確定の要約へ差し替え）
