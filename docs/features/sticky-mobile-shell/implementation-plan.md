---
status: completed
---
# モバイルシェル固定（ヘッダー・ボトムナビ） 実装手順書

## 実装タスク

### タスク1: viewport-fit=cover を有効化 + MobileShell を h-dvh ベースに変更 + BottomNav に safe-area padding 追加

- [x] 完了
- **概要:** スクロール時に AppBar / BottomNav が画面端に固定されるよう shell を viewport にフィットさせ、safe-area-inset-bottom に対応する。3 ファイルを 1 コミットでまとめる（互いに密接に依存する変更のため）。
- **変更対象ファイル:**
  - `apps/web/src/app/layout.tsx` — `viewport` export に `viewportFit: 'cover'` を追加
  - `apps/web/src/components/layout/mobile-shell.tsx` — shell コンテナの `min-h-screen` を `h-screen h-dvh` に変更、コメントを実装一致に更新
  - `apps/web/src/components/layout/bottom-nav.tsx` — `<nav>` を `min-h-[52px] pb-[env(safe-area-inset-bottom)]`（Tailwind arbitrary value）に変更し、各 `<Link>` に明示的に `h-[52px]` を付ける
- **依存タスク:** なし
- **対応Issue:** #51

### タスク2: MobileShell の構造テストを追加 + 既存テスト実行

- [x] 完了
- **概要:** shell の構造（`h-dvh`、main の `flex-1 overflow-y-auto`、AppBar/BottomNav の render）を Vitest で検証。既存の `bottom-nav.test.tsx` 8 ケースが壊れていないことも確認する。
- **変更対象ファイル:**
  - `apps/web/src/components/layout/mobile-shell.test.tsx` — **新規。** AppBarMain / BottomNav を `vi.mock` で stub し、render 結果から shell コンテナ class / main 要素の class / children 描画を検証
- **依存タスク:** タスク1
- **対応Issue:** #52
- **完了条件:**
  - `pnpm --filter web test` が全件 pass
  - 新規テストが pass し、`h-dvh` / `flex-1` / `overflow-y-auto` / `paddingBottom: env(safe-area-inset-bottom)` を検証している

### タスク2b: flex `min-h-auto` 罠の事後修正（PR #65 で追加）

- [x] 完了
- **概要:** PR #64 ship + 本番反映後、ユーザー実機検証で BottomNav が下スクロールで画面外に消える現象が判明。原因は flex item デフォルト `min-height: auto` で `<main>` が子コンテンツに押されて shell の h-dvh 境界を突き抜け、body スクロールが走っていたこと。
- **変更対象ファイル:**
  - `apps/web/src/components/layout/mobile-shell.tsx` — `<main>` を `flex-1 overflow-y-auto` → `flex-1 min-h-0 overflow-y-auto` に修正、罠の解説コメント追加
  - `apps/web/src/components/layout/mobile-shell.test.tsx` — main の class アサーションに `min-h-0` を追加（リグレッションガード）
  - `docs/features/sticky-mobile-shell/requirements.md` — §4.2 mobile-shell.tsx のコード例と `min-h-0` 必須の注記
- **依存タスク:** タスク1, タスク2
- **対応Issue:** #53 (事後修正の一部、実機 NG → fix → 再実機)

### タスク3: 実機確認（iPhone Safari + iPhone PWA standalone）

- [ ] 完了
- **概要:** iPhone Safari と PWA standalone モードで、コンテンツをスクロールしても AppBar と BottomNav が画面端に固定されることを目視確認する。あわせて `events/[id]/page.tsx:331` の `sticky bottom-0`（出欠ボタン）が BottomNav と重ならず main 内の下端に正しく乗ることをチェック。
- **変更対象ファイル:** なし（実機確認のみ）
- **依存タスク:** タスク1, タスク2
- **対応Issue:** #53
- **完了条件:**
  - iPhone Safari でダッシュボード / イベント一覧 / イベント詳細 / 予定 を縦スクロールしても AppBar・BottomNav が画面端に常に表示される
  - iPhone PWA standalone でも同様の挙動
  - BottomNav の下に home indicator 領域がきれいに塗られている（背景色が途切れない）
  - イベント詳細ページの出欠ボタン（sticky bottom-0）が BottomNav の上に乗り、視覚的に違和感がない
  - `(app)` 配下の各ページ（ダッシュボード / イベント / 予定 / 会員 / メール受信箱 / 管理ページ）のいずれもリグレッションなし

## 実装順序

1. タスク1（実装、依存なし）
2. タスク2（テスト追加・実行、タスク1 完了後）
3. タスク3（実機確認、タスク1・2 完了後）

実装はすべて 1 PR にまとめる（1PR=1機能の原則）。
