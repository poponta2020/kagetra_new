---
status: completed
---

# mail-body-as-image 実装手順書

## 前提
- 要件定義書: `docs/features/mail-body-as-image/requirements.md`
- ブランチ: `feat/mail-body-as-image`
- 1 PR で全タスク完了
- worktree: `C:/tmp/impl-mail-body-as-image`

## 実装タスク

### タスク1: HTML テンプレート + 本文画像化 helper の新規実装

- [x] 完了
- **概要:** 件名・本文・訂正フラグを HTML に流し込み、libreoffice → pdftoppm パイプラインで JPEG 配列を返す helper を新規作成する。`renderPdfToJpegs` を内部再利用する。
- **変更対象ファイル:**
  - `apps/web/src/lib/mail-body-image-render.ts` (新規) — HTML テンプレート、`buildBodyImageHtml()`、`renderBodyImageToJpegs()`
  - `apps/web/src/lib/mail-body-image-render.test.ts` (新規) — `buildBodyImageHtml` のスナップショット (件名あり/なし/訂正版/footer 除去)
- **テンプレート要件:**
  - A4 縦 / margin 25mm × 20mm / Noto Sans CJK JP / 11pt / line-height 1.7
  - ヘッダー (件名): 14pt bold, border-bottom 1px solid #888, 訂正版は `【訂正】【件名】`
  - 本文: `<pre>` で改行・空白保持、`white-space: pre-wrap; word-break: break-word`
  - 件名が空の場合はヘッダーごと省略
  - 訂正版で件名なしの場合は `<h1>【訂正】</h1>` のみ
- **依存タスク:** なし
- **対応Issue:** #74

### タスク2: line-broadcast.ts の本文画像化 + 添付リンク統一

- [ ] 完了
- **概要:** `broadcastMailToEvent` 内の本文構築を text → image に切り替え、`renderAttachment` の PDF/Word 画像化分岐を削除して全添付 URL リンク統一にする。画像化失敗時の text fallback パスを追加。
- **変更対象ファイル:**
  - `apps/web/src/lib/line-broadcast.ts`:
    - import 整理: `renderBodyImageToJpegs` を追加。`renderDocxToJpegs` の import 削除
    - `broadcastMailToEvent`:
      - 本文 text 構築 (`splitForLine`) を撤去し、まず `renderBodyImageToJpegs` を try で呼ぶ
      - 成功: 既存 `buildRenderedImageMessages` を本文画像用に再利用 (attachment 引数を持たないバリエーション、または共通化) して image message を作る
      - 失敗 (catch): `buildBroadcastBody` + `splitForLine` で text message に降格、`logger.warn` で失敗理由を記録
      - 30 ページ超: image render の `truncated=true` を受け取り、本文 text fallback に切り替え (専用 share token は導入しない)
      - `roles` 配列に `body_image` を追加 (sent_image_count にカウント)
    - `renderAttachment`:
      - PDF / Word 分岐を削除
      - 全添付を `buildFallbackTextMessage` で URL リンク 1 本に統一
      - `usedFallback: true` を常に返す
  - 共通 image messages 構築の関数化: `buildRenderedImageMessages` を本文 + 添付両方で使えるよう、 attachment 引数を optional にするか、本文用に「filename を持たない」軽量版を切り出す
- **依存タスク:** タスク1
- **対応Issue:** #75

### タスク3: attachment-image-render.ts の整理

- [ ] 完了
- **概要:** 本文画像化から内部呼び出しする `renderPdfToJpegs` はそのまま残す。添付経路で唯一使われていた `renderDocxToJpegs` は外部から不要になるが、本文画像化が libreoffice → renderPdfToJpegs 経由なので **export は維持** (PDF 化 helper として再利用)。
- **変更対象ファイル:**
  - `apps/web/src/lib/attachment-image-render.ts`:
    - `renderDocxToJpegs` の export 自体は残す (libreoffice 呼び出し helper として `mail-body-image-render` から呼ばれる可能性がある場合)。最終的に未使用なら削除
    - 既存テスト (もしあれば) で削除対象を判断
  - libreoffice 呼び出し部分を `mail-body-image-render.ts` から再利用しやすくするため、private helper `runLibreofficeConvertToPdf(inputPath, workDir)` を抽出して export する選択肢を検討
- **依存タスク:** タスク1, タスク2
- **対応Issue:** #76

### タスク4: テスト更新

- [ ] 完了
- **概要:** `line-broadcast.test.ts` を本文 image / 添付 link の新挙動に合わせて更新。
- **変更対象ファイル:**
  - `apps/web/src/lib/line-broadcast.test.ts`:
    - 既存「本文 text message」を期待しているケースを「本文 image message」に変更
    - 添付 PDF / Word が image を返すケースを「fallback link」に変更
    - 画像化失敗 → text fallback の新規ケースを 1 つ追加 (libreoffice mock を spawn-level で reject)
    - role 別カウント (`sent_text_count` / `sent_image_count` / `fallback_link_count`) の期待値を更新
  - `apps/web/src/lib/mail-body-cleaner.test.ts`: 変更なし (fallback パスで継続使用)
- **依存タスク:** タスク1, タスク2
- **対応Issue:** #77

### タスク5: ローカル検証 + worklog 記入 + PR 作成準備

- [ ] 完了
- **概要:** worktree でユニットテスト・型チェック・lint を通し、worklog.md に進捗を追記、`/prepare-pr` で PR を作る準備をする。
- **検証コマンド:**
  - `pnpm --filter @kagetra/web vitest run src/lib/mail-body-image-render.test.ts`
  - `pnpm --filter @kagetra/web vitest run src/lib/line-broadcast.test.ts`
  - `pnpm --filter @kagetra/web typecheck`
  - `pnpm --filter @kagetra/web lint`
- **依存タスク:** タスク1〜4
- **対応Issue:** #78

## 実装順序

1. **タスク1** (HTML テンプレート + helper): 依存なし。完全に独立で着手可能
2. **タスク2** (line-broadcast 改修): タスク1 完了後。`renderBodyImageToJpegs` の signature が固まってから
3. **タスク3** (attachment-image-render 整理): タスク2 で削除が必要か確定してから (実は変更不要のケースもある)
4. **タスク4** (テスト更新): タスク2 と並行可能 (テスト ファースト寄りに進めても可)
5. **タスク5** (検証 + PR): タスク1〜4 完了後

## 完了条件

- 全タスクのチェックボックスが完了
- ユニットテスト全 green
- 型チェック・lint pass
- ローカル (Linux/Windows) で `LINE_NOTIFY_DRY_RUN=1` 配信が正常完了し、画像生成パスが logger に出ること (本番投入前の煙テスト)
- PR 作成、`/auto-review-loop` で Codex 構造化レビュー passing
- 本番デプロイ後、実機 (LINE グループ) で本文画像が表示されることを目視確認

## スコープ外 (将来課題)

- 本文専用 share token テーブル `mail_body_share_tokens` の新設 (30 ページ超メールが頻発するなら検討)
- 画像 fonts/レイアウトの細かいカスタマイズ (主催者ロゴ挿入、配色テーマ等)
- 既存配信のリトライ UI から本機能の image render を再試行する機能
