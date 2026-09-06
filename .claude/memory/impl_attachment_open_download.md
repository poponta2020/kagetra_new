---
name: impl-attachment-open-download
description: attachment-open-download 実装
type: project
---

# attachment-open-download 実装（2026-09-04・全5タスク）

worktree: `C:/tmp/impl-attachment-open-download` / ブランチ `feature/attachment-open-download`。
親 #575 ／ 子 #576-#580。Wave1 = T1+T2、Wave2 = T3a/b/c。**全て main が直接実装**（サブエージェント委譲なし）。

## コミット
- `8316dc3` T1 spreadsheet 種別（#576）
- `84dee1c` T2 OpenSaveButton（#577）
- `0d48f66` T3a 会員ビューア（#578）／ `aa9c6f4` T3b 管理者（#579）／ `a1c6685` T3c 名簿（#580）
- `ed3b2be` docs/spec 反映 ／ `8d5b62f` 忠実度ゲートで見つけた修正

## 実装の要点
- `AttachmentPreviewKind` に `spreadsheet` を追加し、xls/xlsx/xlsm を `OFFICE_CONTENT_TYPES`・`DOCUMENT_EXTENSIONS`・`OFFICE_EXTENSION_BY_TYPE` の**3箇所すべてから削除**。これで `conversionExtension()` が Excel を弾き、変換経路が構造的に閉じる。3本の preview route は `!== \x27document\x27` で 404 なので自動的に止まる。
- `components/attachment/OpenSaveButton.tsx`（client）: fetch → File → `navigator.canShare` → `share` / `<a download>` のラダー。**サーバー route は無変更**なので parity テストが無傷。
- 3ビューアの `fallbackCard` を `noticeCard` に置換し、但し書き「iPhone のアプリ内からは…PC からダウンロード」を全削除。

## 検証（実行済み・すべて green）
- vitest 対象実行: attachment-preview / OpenSaveButton / 3ページ = **72 tests passed**
- `pnpm --filter=@kagetra/web check-types` green ／ 変更10ファイルの eslint green
- フルスイート・E2E は未実行（CI 委譲）

## ハマりどころ（次回のため）
- **このリポジトリに jest-dom は入っていない。** `toHaveTextContent` / `toBeDisabled` は使えない → `el.textContent` / `(el as HTMLButtonElement).disabled` で書く。
- `vi.fn(async () => {})` のままだと `share.mock.calls[0] as [{files}]` が TS2352。スタブに引数型を持たせ、キャストは `as unknown as` にする。
- jsdom は blob URL の `<a>.click()` で `Not implemented: navigation` を stderr に吐く（テストは通る。無害なノイズ）。
- `ensure-worktree.sh` が切る worktree は **origin/main 基点**。/define-feature の成果物をローカル main にコミットしただけでは worktree に入らない — 明示的に cp + commit が要る（[[feedback-define-feature-docs-uncommitted]] の実例）。
- 忠実度ゲートで実際に不具合を1件検出: `Btn` に `shrink-0` があってもそれを包む**ラッパー div** が sticky ヘッダの flex 子として縮む。チェックリスト項目「375px でファイル名が長くてもボタンが押し出されない」がなければ見逃していた。
