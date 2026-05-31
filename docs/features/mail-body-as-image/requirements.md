---
status: completed
---

# mail-body-as-image 要件定義書

## 1. 概要

### 目的
LINE 配信される大会連絡メールを、本文テキストではなく **画像** として送信し、
スマホ LINE 上での可読性を向上させる。あわせて添付ファイルの取り扱いを統一する。

### 背景・動機
- 現状: メール本文を `splitForLine` で 5000 文字単位に分割した text message として送信
- 問題: LINE のテキストメッセージは縦方向に長く伸び、スマホで非常に読みづらい
- 既存ワークアラウンド: ユーザー(管理者)が PDF / Word の添付画像で代用、もしくは手動でスクショを送る運用
- 解決策: 本文を A4 縦 × 150 DPI の JPEG として描画して image message で送ることで、
  スクショと同等の可読性を Web 側で機械的に再現する

あわせて、現状「添付の Excel だけ URL リンク・PDF/Word は画像化」と分岐していた取り扱いを、
**全添付 URL リンク統一** にし、本文のみ画像表示・添付は明示的にリンクから開く運用に整える。

---

## 2. ユーザーストーリー

### 対象ユーザー
- **管理者**: 承認したメールを LINE グループに自動配信し、参加者からの参照効率を上げたい
- **参加者 (LINE グループ閲覧者)**: 連絡内容を縦長スクロールせず一目で把握したい

### 利用シナリオ
1. 管理者がメール下書きを承認 (`approveDraft`)
2. システムが該当メールを本文画像 + 添付リンクで LINE グループに自動配信
3. 参加者は LINE のトーク画面で、本文を 1〜数枚の画像として閲覧
4. 添付が必要なときは、添付ごとに送られる URL リンクを開いて Web ブラウザで取得

---

## 3. 機能要件

### 3.1 メール本文の画像化

- **対象**: `broadcastMailToEvent` で送信される全メール (新規・訂正版)
- **画像レイアウト**:
  - 用紙: A4 縦 / 150 DPI / 1240 × 1754 px / 1 ページあたり
  - 背景: 白 / テキスト: 黒
  - フォント: Noto Sans CJK JP (本番に既に導入済み)
  - パディング: 全周囲 80 px 程度の余白
  - ヘッダー領域に件名を表示 (件名前置きラベル `件名:` などは付けない)
  - 訂正版マーカーは現状踏襲: ヘッダーに `【訂正】【件名】` を並べる
- **ページ分割**: 本文が長く 1 ページに収まらない場合、libreoffice の自動改ページに従って複数 JPEG を生成
- **上限**: 30 ページ超は `fallback link` 1 本 (本文を Web で見るリンク) に縮約 (既存 `RENDER_PAGE_LIMIT` と同じ運用)

### 3.2 件名の取り扱い

- 件名は画像ヘッダーに **必ず** 含める
- 別途 text message としては送信しない (text message 経路は完全廃止)
- 訂正版の場合は `【訂正】【件名】` の二重括弧表記をヘッダーに反映

### 3.3 Google Groups フッター除去

- 既存 `stripMailFooter` の挙動を画像化前にも継続適用
- 画像化対象本文 = `stripMailFooter(mail.bodyText)` の結果

### 3.4 添付ファイル

- **全形式 (PDF / Word / Excel / その他) を URL リンク方式に統一**
- 画像化処理を廃止 (`renderPdfToJpegs` / `renderDocxToJpegs` は呼び出されなくなる)
- 添付メッセージは現状の Excel と同じフォーマット:
  ```
  📎 <filename>
  https://<base>/api/line-broadcast/attachments/<token>
  ```
- 添付の `getOrCreateShareToken` ロジックは変更なし (60 日 TTL)

### 3.5 フォールバック

- **画像化失敗時** (libreoffice クラッシュ / ディスク不足 / Noto フォント欠落等)
  - 既存の text message 送信に自動的にフォールバック
  - `buildBroadcastBody` で構築した本文を `splitForLine` で分割し、text message として送信
  - logger.warn で失敗理由を記録 (運用側で気付ける)
- **30 ページ超** (極端に長い本文)
  - 「本文を Web で見る」リンクの text message 1 本に縮約
  - 添付の `fallback link` と同じ仕組み (本文専用の share token を新設するか、別エンドポイントを使う — 4.4 参照)

### 3.6 配信メッセージ構成

通常配信の最終構成:

| 順序 | 種別 | 内容 |
|------|------|------|
| 1〜N | image | 本文画像 (1〜30 ページ) |
| (失敗時) | text | 本文 text (splitForLine の chunks) |
| (30 ページ超時) | text | 本文を Web で見るリンク 1 本 |
| 次〜 | text | 添付ごとの URL リンク (📎 filename + URL) |

LINE のバッチサイズ制約 (5 message / push, 1.5 秒間隔) は既存の `pushMessages` がそのまま処理。

### 3.7 エラーケース・境界条件

| ケース | 挙動 |
|--------|------|
| 本文が空 | `(本文なし)` プレースホルダで画像化 (1 ページ) |
| 件名が空 | ヘッダーに件名行を出さず、本文だけ画像化 |
| 画像化失敗 | text fallback (3.5) |
| 30 ページ超 | fallback link (3.5) |
| 添付処理失敗 | 既存挙動を維持 (link 1 本に縮約) |
| baseUrl 未設定 | 添付があるとき・本文の link fallback を使うときに例外で `failed` |

---

## 4. 技術設計

### 4.1 新規ファイル

#### `apps/web/src/lib/mail-body-image-render.ts`

```typescript
/**
 * 本文 + 件名 + 訂正フラグを HTML テンプレートに流し込み、libreoffice
 * 経由で PDF を生成し pdftoppm で JPEG 化する。失敗時は throw して
 * 呼び出し側 (line-broadcast.ts) の text fallback パスに任せる。
 */
export interface BuildBodyImageInput {
  subject: string | null | undefined
  rawBody: string | null | undefined
  isCorrection: boolean
}

export function buildBodyImageHtml(input: BuildBodyImageInput): string
export async function renderBodyImageToJpegs(input: BuildBodyImageInput): Promise<ImageRenderResult>
```

HTML テンプレート:
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4 portrait; margin: 25mm 20mm; }
    body { font-family: 'Noto Sans CJK JP', sans-serif; font-size: 11pt; line-height: 1.7; color: #000; }
    h1 { font-size: 14pt; font-weight: bold; margin: 0 0 1em 0; border-bottom: 1px solid #888; padding-bottom: 0.5em; }
    pre { font-family: 'Noto Sans CJK JP', sans-serif; white-space: pre-wrap; word-break: break-word; margin: 0; }
  </style>
</head>
<body>
  <h1>{{訂正マーカー}}【{{件名}}】</h1>
  <pre>{{本文}}</pre>
</body>
</html>
```

実装内部:
1. HTML を tempdir に書き出し
2. `libreoffice --headless --convert-to pdf` で PDF 化
3. 既存 `renderPdfToJpegs` を呼んで JPEG 配列を取得
4. tempdir をクリーンアップ

### 4.2 既存ファイルの変更

#### `apps/web/src/lib/attachment-image-render.ts`
- `renderDocxToJpegs` を **export 解除** (line-broadcast から不要になる)。一旦残しておき、未使用 export なら次の cleanup で削除
- `renderPdfToJpegs` は `mail-body-image-render` 側で内部呼び出しする
- それ以外の変更なし

#### `apps/web/src/lib/line-broadcast.ts`
- import 変更: `splitForLine` / `buildBroadcastBody` / `renderPdfToJpegs` / `renderDocxToJpegs` の依存を整理
- `broadcastMailToEvent` 内:
  - 本文 text message 構築 (`splitForLine`) を **撤去** し、`renderBodyImageToJpegs` で画像化に置換
  - 画像化結果 → `buildRenderedImageMessages` 相当で `image` message に変換 (本文画像用は attachment 無関係なので新規 helper か既存リファクタ)
  - 画像化失敗時の catch → `buildBroadcastBody` + `splitForLine` で text fallback
  - role の追加: `body_image` (sent_image_count にカウント) と既存 `body_text` (fallback 時のみ使用)
- `renderAttachment` 内:
  - PDF / Word の分岐をすべて削除
  - 添付は **全て** `buildFallbackTextMessage` で URL リンクを返すように単純化
  - 結果として `renderAttachment` は filename / contentType に関わらず 1 text message を返す関数になる
- DB スキーマは変更なし (既存 3 カラム `sent_text_count` / `sent_image_count` / `fallback_link_count` で role 集計可能)

#### `apps/web/src/lib/mail-body-cleaner.ts`
- 既存 `buildBroadcastBody` / `stripMailFooter` はそのまま (text fallback パスで使う)
- 画像化 HTML テンプレートが直接参照する用途で `stripMailFooter` を再利用

### 4.3 本文 fallback link 用エンドポイント

30 ページ超で「本文を Web で見る」リンクを送るとき、どこに飛ばすか:

**選択肢 A**: 既存 `/api/line-broadcast/attachments/[token]` を再利用
  - 本文を「擬似添付」として `mail_attachments` に保存し、共通 token で配信
  - スキーマ変更不要だが、本来の添付と区別が付かなくなる

**選択肢 B (推奨)**: 新規 `/api/line-broadcast/mail-bodies/[token]` を作る
  - `mail_body_share_tokens` テーブルを新設 (mail_message_id + token + expires_at)
  - 既存 `getOrCreateShareToken` のパターンを踏襲
  - LINE 上は `📧 本文を Web で見る\nhttps://.../mail-bodies/<token>` の text 1 本

→ 選択肢 B を採用。30 ページ超のメールは現状ほぼ存在しないので、テーブル作成のコストよりも経路分離の方が運用上分かりやすい。
   **ただし**, 初期実装ではフォールバックを 30 ページ→画像化諦め→text fallback (本文全文を text で送信) のシンプルな経路にし、テーブル新設は本機能スコープから外す (3.5 の text fallback と同じ扱い)。

→ **最終方針: 30 ページ超は text fallback (本文全文を splitForLine で text 配信) のみ。`mail_body_share_tokens` は導入しない。**

### 4.4 テスト戦略

#### Vitest ユニットテスト
- `mail-body-image-render.test.ts` (新規):
  - `buildBodyImageHtml`: 件名あり/なし / 訂正版あり/なし / Google Groups footer 除去 のスナップショット
  - `renderBodyImageToJpegs`: libreoffice を spawn する子プロセスは **mock しない**(本番と同じ環境前提)。CI 環境に libreoffice が無い場合は skip
- `mail-body-cleaner.test.ts`: 既存テストはそのまま (fallback パスで使い続けるため)
- `line-broadcast.test.ts`: 既存テスト期待値を更新
  - 本文 → text message ではなく image message を期待
  - 添付 → 全て fallback link (text message) を期待
  - 画像化失敗時の text fallback パスを 1 ケース追加

#### Playwright E2E
- 本文画像化が走るルートは LINE_NOTIFY_DRY_RUN=1 でモック中。既存 E2E に画像化失敗ケースを 1 つ追加
- 実際の libreoffice 描画結果はローカル/本番でユーザーの目視確認に依存

### 4.5 パフォーマンス・運用

- libreoffice + pdftoppm は既存 PDF/Word 画像化と同じプロセス。本文画像化が加わると 1 配信あたり libreoffice 呼び出しが **1 回増加** (約 6 秒)
- 全添付が URL リンク化することで libreoffice 呼び出しは添付分減少 (Word/PDF 添付の数だけ短縮)
- 結果として総処理時間は **やや短縮** される見込み (添付が複数あれば顕著)

---

## 5. 影響範囲

### 5.1 変更が必要な既存ファイル

| ファイル | 変更内容 |
|---------|---------|
| `apps/web/src/lib/line-broadcast.ts` | 本文 text → image 化、添付の PDF/Word 画像化を撤去 |
| `apps/web/src/lib/attachment-image-render.ts` | `renderDocxToJpegs` の export 削除 (未使用化), 内部の `renderPdfToJpegs` は本文画像化から再利用 |
| `apps/web/src/lib/line-broadcast.test.ts` | 期待値を image 中心に更新 |
| `apps/web/src/lib/attachment-image-render.test.ts` | 既存があれば DOCX テストを削除 (TBD) |

### 5.2 新規ファイル

| ファイル | 役割 |
|---------|------|
| `apps/web/src/lib/mail-body-image-render.ts` | 本文画像化の中核 |
| `apps/web/src/lib/mail-body-image-render.test.ts` | HTML 生成テスト |

### 5.3 DB スキーマ

- **変更なし** (`event_broadcast_messages` の 3 カラムで role 集計可能)

### 5.4 既存機能への影響

| 機能 | 影響 |
|------|------|
| メール承認 → LINE 配信 | 表示形式が text → image に変わる (本機能の目的) |
| 訂正版メール配信 | 同上。`【訂正】` マーカーは画像ヘッダーに移動 |
| 添付 PDF/Word/Excel | 全て URL リンクに統一 (現行の Excel と同じ挙動) |
| /api/line-broadcast/images/[token] | 本文画像にも使うので追加変更なし |
| /api/line-broadcast/attachments/[token] | 変更なし (本文配信からの参照は無い) |

### 5.5 運用への影響

- 本番 Lightsail (現在は Oracle Cloud) 上で `fc-list :lang=ja` が引き続き有効である必要 (既に `fonts-noto-cjk` 導入済み)
- libreoffice / pdftoppm / poppler-utils が引き続き必要 (本文画像化で本機能完全に依存)
- ディスク容量: 既存と同程度

---

## 6. 設計判断の根拠

### 6.1 なぜ HTML → libreoffice → PDF → pdftoppm パイプライン?

- **依存ゼロ**: libreoffice / pdftoppm / Noto CJK は既に本番にインストール済み
- **動作実績**: PDF/Word 画像化で安定運用中 (3 ヶ月以上)
- **代替案 puppeteer/playwright**: heavy (~250MB chromium), 本番 ARM への load 負荷
- **代替案 node-canvas + 手動レイアウト**: フォントメトリクス・改ページの自前実装が膨大

### 6.2 なぜ件名を画像ヘッダーに含める?

- 別 text message にすると LINE 上で本文画像の前にテキストが残り、結局縦に伸びる
- スクショ運用と同じ「1 つの絵で完結」を再現する目的に整合

### 6.3 なぜ添付も URL リンクに統一?

- ユーザー要望 (画像化していた PDF/Word も Excel と同じ URL に揃えたい)
- 添付ファイルは「明示的に開く」操作のほうが情報量が多い (Word の細かい文字を小画像で見るより、専用アプリで開いた方が読みやすい)
- 配信時間が短縮 (libreoffice 呼び出しが添付分減る)

### 6.4 なぜ画像化失敗時に text fallback?

- ユーザーの希望は「常に画像」だが、libreoffice クラッシュで配信全体が止まると業務影響が大きい
- 画像化失敗時に既存の text 経路に倒すことで、可読性は劣るが連絡の到達は守る
- logger.warn で失敗を可視化し、運用側が原因 (フォント欠落等) に気付ける

### 6.5 なぜ 30 ページ超も text fallback?

- 本文専用 share token テーブル新設は将来の機能 (極長メールが頻発するなら検討)
- 現状の運用で 30 ページ超のメールは稀 (添付 PDF と違い本文はせいぜい 2-3 ページ)
- text fallback で十分対応可能

---
