---
status: completed
design_required: false
design_note: >-
  公開全文ページは既存 /mail/[id]（member-mail-search の design-spec）の意匠・部品を
  そのまま流用するため、デザイン工程（/design-screen）は回さない。ユーザー確認済み（2026-09-07）。
completed_sections: [変更の動機と内容, 変更後の挙動, 変わらないもの, 互換性・データ, Acceptance Criteria, 技術的制約・契約]
next_section: null
approved_at: 2026-09-07
---

# mail-body-as-image 要件定義書

> **★2026-09-07 改修（本文リンクカード化）**
> 本文の LINE 配信形式を **A4 縦 JPEG 画像 → Flex カード 1 通＋公開の全文ページ** に変更する。
> slug は `mail-body-as-image` のまま維持する（他ドキュメント・Issue からの参照を壊さないため）。
> 現在の実態は「メール本文リンクカード配信」。画像化に関する記述は §8 変更履歴に残す。

## 1. 概要

### 目的

承認されたメールを LINE グループへ配信するとき、本文を **画像で貼る**のをやめ、
**メールアイコン付きの Flex カード 1 枚**に畳む。カードをタップすると、ログイン不要の
Web ページでメール全文をテキストとして読める。

### 背景・動機

- 現行（2026-06 出荷）は本文を A4 縦 150 DPI の JPEG に描画して image message で送っている。
  スクショ運用よりは読めるが、**文字が小さく、拡大しないと読めない・検索もコピーもできない**。
- LINE のテキストメッセージは URL をハイパーリンクにできず、署名付きの長い URL が
  そのままトークに露出する。**URL 直リンクは貼りたくない。**
- 添付ファイルは既に Flex カード（`buildAttachmentFlexMessage`：色付き 48px バッジ＋ファイル名、
  URL はカードのタップアクションに隠す）へ移行済みで、**本文だけが画像のまま取り残されていた。**
- `mail-body-as-image` 初版の §4.3 で「本文を Web で見る URL」用のトークン方式
  （`mail_body_share_tokens` ＋専用ルート）を検討して**あえて見送った**経緯がある。
  本改修はその積み残しを実装するもの。

### 変更の要旨（before → after）

| | before（現行） | after（本改修） |
|---|---|---|
| 本文 | A4 縦 JPEG（libreoffice→PDF→pdftoppm）を image message で 1〜30 通 | **Flex カード 1 通**（✉ バッジ＋件名＋「タップして全文を見る」） |
| 本文の全文 | 画像を拡大して読む | カードをタップ → **公開の全文ページ**（ログイン不要・署名トークン 60 日） |
| URL の見え方 | （本文にはリンク無し） | **トークに URL は一切出ない**（カードの uri アクションに隠す） |
| 画像化失敗時 | 本文全文を text message へフォールバック | **フォールバックしない**（監査行を failed にして管理者に見せる） |
| 添付 | Flex カード（変更なし） | Flex カード（**変更なし**） |

---

## 2. 機能要件

### 2.1 画面と遷移（画面インベントリ）

> 見た目は既存 `/mail/[id]`（member-mail-search の design-spec §3/§4）に合わせる。ここで再記述しない。

| # | パス | 役割 | 権限 |
|---|------|------|------|
| S1 | `/mail-share/[token]`（仮。技術計画で確定） | **公開メール全文ページ（新規）**。件名・受信日時・本文全文のみ | **認証不要**（トークン保持者。middleware 除外） |
| S2 | `/mail/[id]` | 会員向けメール詳細（既存・**変更なし**） | ログイン済み会員（ゲスト不可） |

```
LINE グループのトーク
  ├─ [text]  リード文（任意・既存）
  ├─ [flex]  本文カード ──タップ──▶ S1 公開全文ページ（未ログインで 200）
  └─ [flex]  添付カード（複数・既存）──タップ──▶ /api/line-broadcast/attachments/[token]
```

### 2.2 本文カード（Flex Message）

- **1 通のみ**。本文の長さによらず増えない。
- **アイコン**: 既存の添付カードと同形の 48px 角丸バッジに、白抜きの封筒記号 `✉`。
  背景色はブランド色（藤）系の単色（具体値は実装時に `--kg-*` トークンに合わせる）。
  外部画像は使わない（LINE 側の画像フェッチ失敗でアイコンが欠けるリスクを持ち込まない）。
- **本文行の内容は件名だけ**。受信日時・差出人・本文の抜粋は**載せない**。
  - 件名が空・NULL のときは `(件名なし)` と表示する。
  - 訂正版（`isCorrection=true`）は**件名の先頭に `【訂正】` を付ける**（例: `【訂正】第33回◯◯大会について`）。
  - 長い件名はカードが縦に伸びないよう 3 行で打ち切る（`maxLines: 3`。全文は altText と全文ページに残る）。
- **サブタイトル**: `タップして全文を見る`（添付カードの「タップして開く」と同じ位置・同じ小文字）。
- **タップ**: カード body 全体に `action: { type: 'uri', uri: <全文ページ URL> }`。
  **URL をテキストとしてトークに出さない**（本改修の主目的の一つ）。
- **altText**（トーク一覧・プッシュ通知の文言）: `📧 <件名>`（訂正版は `📧 【訂正】<件名>`）。
  LINE 仕様の 400 UTF-16 単位で切り詰める。切り詰めはコードポイント境界で行う
  （既存 `truncateToUtf16Units` を再利用。サロゲートペア分断で人名・大会名が壊れるのを防ぐ）。

### 2.3 公開の全文ページ

- **認証不要**。LINE グループには景虎にログインできない非会員（他会の応援者等）が含まれるため、
  既存の添付公開 URL と同じ「推測不能トークン＋期限」モデルを採る。
- **表示するもの（これだけ）**:
  1. 件名（`mail_messages.subject` を受信したまま。**`【訂正】` は付けない** → §7 の理由）
  2. 受信日時
  3. 本文全文（Google Groups フッター除去後・改行保持のプレーンテキスト）
- **表示しないもの**: 添付ファイル（LINE には添付カードが別途届く）・紐付いた大会名・
  イベント詳細へのリンク・処理履歴・会員向けナビゲーション（ボトムナビ等）。
- **トークン**: URL-safe base64 32 文字、**TTL 60 日**（既存 `attachment_share_tokens` と同条件）。
  同一メールの再配信では有効期限内のトークンを再利用する（URL が変わらない）。
- **期限切れ・不明なトークン**: 「有効期限が切れました」の**案内ページ**を返す。
  会員向けに「景虎のメール画面から検索できます」旨を添える。
  期限切れ・存在しない・形式不正は**同一の応答**にする（トークンの存在を推測させない）。
- **クローラ対策**: robots meta で `noindex, nofollow` を出力し、動的レンダリング
  （`force-dynamic`）で `Cache-Control: no-store` 相当を返す。メール全文が検索エンジンに
  インデックスされないようにする。

### 2.4 配信メッセージ構成

| 順序 | 種別 | 内容 | 条件 |
|------|------|------|------|
| 1 | text | リード文 | 管理者が入力したときのみ（既存） |
| 2 | flex | **本文カード（1 通）** | 本文添付 ON のときのみ |
| 3〜 | flex | 添付カード（添付ごとに 1 通） | 添付があるとき（既存・変更なし） |

- **本文添付 OFF（`includeBody=false`）のときは本文カードも出さない**。
  管理者が「本文は流さない」と決めたメールの中身が、カード経由で読めてしまう状態を作らない。
  リード文も添付も無く送るものが空になった場合は、現行どおり push せず
  `status='failed' / errorMessage='empty_message_set'` で終える。
- LINE のバッチ制約（5 message/push・1.5 秒間隔）は既存 `pushMessages` がそのまま処理する。

### 2.5 エラーケース・境界条件

| ケース | 挙動 |
|--------|------|
| 本文が空・NULL | 全文ページに `(本文なし)` を表示。カードは通常どおり送る |
| 件名が空・NULL | カード見出し `(件名なし)`、altText は `📧 (件名なし)` |
| 公開 URL のベース未設定（`PUBLIC_BASE_URL` 等） | 例外に倒れ、監査行 `status='failed'`。**本文テキストでの代替送信はしない** |
| トークン発行に失敗（DB エラー等） | 同上（failed） |
| LINE push が途中で失敗 | 既存どおり `partial`／`failed` を監査行に記録し、再送で未送信分から続ける |
| 期限切れ・不正トークンでページを開いた | 案内ページ（§2.3） |
| 本文に HTML/スクリプトが含まれる | エスケープしてテキストとして表示（実行させない） |

---

## 3. 変わらないもの（回帰の対象）★

- **添付カード**（`buildAttachmentFlexMessage`・署名 URL・60 日 TTL・バッジ色/ラベル）は一切変更しない。
- **リード文**の有無・位置・文言は変更しない。
- 配信の**多重実行防止**（CAS による `sending` 占有）、**15 分の stale reclaim**、
  **partial 再送で既配信分をスキップする挙動**は変更しない。
- `event_broadcast_messages` の**スキーマは変更しない**（既存 4 カウンタで集計する）。
- 会員向け `/mail/[id]`・`/mail` 一覧・`/admin/mail-inbox` は**触らない**。
- 他の LINE 配信経路 —— 要綱 push（`line-broadcast-guidelines`）、級別グループ配信
  （`event-grade-broadcast`）、支払報告の証憑（`payment-receipts`）、
  オープンチャット収集（`open-chat/collect`）—— は**挙動不変**。
- 添付プレビューの画像化（`attachment-image-render` の `renderPdfToJpegs` 等）は
  会員向け添付ビューア・名簿ファイル・QR 収集が使っているため**残す**。

---

## 4. 互換性・データ

- **新テーブル 1 本**: `mail_body_share_tokens`（`mail_message_id` UNIQUE / `token` UNIQUE /
  `expires_at` / `access_count` / `created_at`）。`attachment_share_tokens` と同形。
  マイグレーション 1 本（次番号は 0064）。
- **既存データの移行は不要**。過去に画像で配信済みのメッセージを作り直すことはしない（§5）。
- **日次 cleanup**（`scripts/cleanup-expired-tokens.ts`）に新テーブルを追加する
  （期限 +7 日の猶予で削除、という既存の方針をそのまま適用）。
- **監査カウンタのマッピング**（migration を避けるため既存列を流用）:
  - 本文カード → `sent_text_count`（本文枠として送った通数。今後は 0 か 1）
  - 添付カード → `fallback_link_count`（現行と同じ）
  - リード文 → `sent_lead_count`（現行と同じ）
  - `sent_image_count` → **今後は常に 0**（列は残す。過去行の値は履歴として保持）
- **デプロイ直後の再送**: 旧形式で部分配信された監査行（`sent_image_count > 0`）を再送すると、
  役割別カウントが前回より減るため既存ロジックが「配信計画が別物」と判定し、
  partial スキップをやめて**全件再送**に倒れる。これは意図した挙動として維持する（AC-21）。
- **公開契約**: 全文ページの URL は LINE のトーク履歴に 60 日間残る。
  一度発行した URL のパス形式は後方互換を壊さない（トークン再発行時も同じパス形式）。

---

## 5. Non-goals（今回やらないこと）

- 過去に画像で配信済みのメッセージの作り直し・遡及配信
- 添付ファイルの配信形式の変更（Flex カードのまま）
- 会員向け `/mail`・`/mail/[id]`・管理者 `/admin/mail-inbox` の変更
- 全文ページへの添付リンク・大会情報・処理履歴の掲載
- トークンの無期限化・レート制限・アクセス解析ダッシュボード
- 本改修で未使用になる `buildBroadcastBody`（`mail-body-cleaner.ts`）の削除。
  `stripMailFooter` は全文ページが使い続ける。`splitForLine` は `event-grade-broadcast` が使うため残す
- `/api/line-broadcast/images/[token]` ルートの撤去（未使用になるが無害。過去配信の画像は
  in-process キャッシュ（TTL 24h）が消えた時点で既に取得不能で、残しても復活しない）
- 本文の AI 要約・整形（プレーンテキストをそのまま出す）
- HTML メール（`body_html`）のリッチ表示（現行どおり `body_text` を使う）
- オープンチャット配信・要綱 push など他経路のカード化

---

## 6. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|----------|
| AC-1 | 本文添付 ON のメール配信で、本文は Flex カード **1 通**として送られ、image message も本文 text message も送られない | auto-test |
| AC-2 | 本文カードの `altText` は `📧 <件名>`（訂正版は `📧 【訂正】<件名>`）で、400 UTF-16 単位を超える場合はコードポイント境界で切り詰められる | auto-test |
| AC-3 | 本文カードは 48px バッジ（`✉`）＋件名＋「タップして全文を見る」で構成され、body に全文ページ URL の `uri` アクションを持つ（URL はテキストとしてトークに出ない） | auto-test |
| AC-4 | 件名が空・NULL のメールでは、カード見出しが `(件名なし)` になる | auto-test |
| AC-5 | 訂正版配信では、カード見出しと altText の件名先頭に `【訂正】` が付く | auto-test |
| AC-6 | 送信順は リード文 → 本文カード → 添付カード に固定される | auto-test |
| AC-7 | 本文添付 OFF のメールでは本文カードを積まない。リード文も添付も無ければ push せず `status='failed'` / `errorMessage='empty_message_set'` になる | auto-test |
| AC-8 | 公開 URL のベース未設定・トークン発行失敗のときは監査行が `status='failed'` になり、本文テキストでの代替送信は行われない | auto-test |
| AC-9 | 同一メールの再配信では、有効期限内のトークン・URL が再利用される（再生成されない） | auto-test |
| AC-10 | 期限切れのトークン行は再配信時に新しいトークン・新しい期限へ更新される | auto-test |
| AC-11 | トークンは URL-safe base64 32 文字で、有効期限は発行から 60 日である | auto-test |
| AC-12 | `cleanup-expired-tokens.ts` が `mail_body_share_tokens` も期限 +7 日の猶予で削除する | auto-test |
| AC-13 | 有効なトークンの全文ページは**未ログインで 200** を返し、件名・受信日時・本文全文が表示される | auto-test |
| AC-14 | 本文は Google Groups フッター除去後のテキストで、改行が保持され、HTML としてエスケープされる（`<script>` を含む本文でスクリプトが実行されない） | auto-test |
| AC-15 | 期限切れ・存在しない・形式不正のトークンは、いずれも同一の案内ページ（「有効期限が切れました」＋会員向け導線）を返す | auto-test |
| AC-16 | 全文ページは robots meta に `noindex, nofollow` を出力し、動的レンダリングで `Cache-Control` に `no-store` を含めて返る | auto-test |
| AC-17 | 全文ページに添付ファイル・大会名・イベント詳細リンク・会員向けナビゲーションが表示されない | auto-test |
| AC-18 | 全文ページは未ログインでもログイン画面へリダイレクトされない（middleware の除外が効いている） | auto-test |
| AC-19 | 添付カード（`buildAttachmentFlexMessage`）の出力は現行と同一である | auto-test |
| AC-20 | リード文・CAS による二重送信防止・15 分 stale reclaim・partial 再送の挙動は現行と同一である | auto-test |
| AC-21 | 旧形式で部分配信された監査行（`sent_image_count > 0`）の再送では、役割別カウント減少を検知して全件再送に倒れる | auto-test |
| AC-22 | `event_broadcast_messages` のスキーマは変更されず、本文カードは `sent_text_count`、添付カードは `fallback_link_count` に計上される | auto-test |
| AC-23 | 要綱 push・級別グループ配信・支払報告・オープンチャット収集の各経路は挙動不変（既存テストが green） | auto-test |
| AC-24 | 既存テスト・lint・typecheck が CI で green | auto-test |
| AC-25 | 本番の LINE グループでカードが届き、タップで全文ページが開いて本文が読める | manual |

**内訳: auto-test 24 件 / verify 0 件 / manual 1 件**

---

## 7. 技術的制約・契約

- **middleware**: `apps/web/src/middleware.ts` の matcher は `api/line-broadcast` 等を否定先読みで
  除外している。全文ページを**認証なしで到達可能にする除外の追加が必須**（漏れると LINE から
  開いた全員がサインイン画面に飛ばされ、本改修の目的が丸ごと失われる）。
- **公開ページの実装形態**: 既存 `/api/line-broadcast/**` は Route Handler（バイナリ・JSON）の
  名前空間で、HTML ページ＋Tailwind の配信には向かない。全文ページは App Router の
  公開ページとして作り、matcher に除外を足す方針（最終確定は技術計画）。
- **本文は untrusted 入力**（IMAP 経由の外部メール）。エスケープを必須とし、
  `dangerouslySetInnerHTML` は使わない。`body_html` は使わない。
- **LINE Flex 仕様**: `uri` は https 必須、`altText` は 400 文字上限。既存
  `line-flex-attachment.ts` は pure（node builtins に依存しない）モジュールで、
  webhook 経路からも import される。**本文カードのビルダーも同じ純度を保つ**
  （sharp / libreoffice 等の重依存を持ち込まない）。
- **廃止するコード**: 本文画像化（`mail-body-image-render.ts` とその呼び出し・
  本文の text fallback・`splitForLine` の本文用途）。`attachment-image-render.ts` の
  共有関数（`renderPdfToJpegs` / `runLibreofficeConvertToPdf` / `getOrCreateShareToken`）は
  添付プレビュー・名簿ファイル・QR 収集が使うため**残す**。
- **本番運用**: 本文配信から libreoffice / pdftoppm 依存が外れる（添付プレビュー経路では引き続き必要）。
  1 配信あたりの処理時間は短縮される。
- **訂正マーカーは配信単位・トークンはメール単位**（★設計上の非対称）: `【訂正】` は
  `event_broadcast_messages.is_correction`（＝1 回の配信）に属する情報で、共有トークンは
  `mail_message_id` に 1 行しか持てない。同じメールを通常配信したあと訂正版として別イベントへ
  再配信すると、トークン行にフラグを持たせる設計では**先の配信のカードから開いたページまで
  【訂正】になる**。したがって `【訂正】` は**カードにだけ**付け（`isCorrection` が引数として
  渡る唯一の場所）、全文ページは件名を受信したまま出す。
- **文面の正典**: 本文カード・全文ページの文言はこの文書が持つ。添付カードの文言・仕様は
  `line-flex-attachment.ts` を所有する既存機能（`attachment-open-download` 系）の側にあり、ここでは変更しない。

---

## 8. 変更履歴

- **2026-09-07**: 本文の LINE 配信形式を **A4 縦 JPEG 画像 → Flex カード 1 通＋公開の全文ページ**に変更。
  あわせて画像化失敗時の text fallback を廃止（失敗は監査行 failed で可視化）。
  （理由: 画像は文字が小さく、検索もコピーもできない。URL 直リンクをトークに出したくない。
  添付が既に Flex カード化されており、本文だけが画像で取り残されていた。）
- **2026-06**: 初版。本文を A4 縦 JPEG 化して image message で配信、添付は全形式 URL リンクに統一。
  「本文を Web で見る」トークン方式（`mail_body_share_tokens`）は当時見送り（初版 §4.3）。
