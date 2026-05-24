---
status: completed
---
# PWA 対応（最小） 実装手順書

## 実装タスク

### タスク1: アイコンソース SVG + 生成スクリプト
- [x] 完了
- **対応 Issue:** #44
- **概要:**
  - 中央に「か」を配置したシンプルな SVG ロゴ（白背景・ダーク文字）を作成。
  - `sharp` を使って 192/512/maskable-512/180(apple-touch-icon) の PNG を出力するスクリプトを作成。
  - スクリプト実行で生成された PNG 4 枚を public/ にコミット（CI 再生成なし）。
  - maskable は safe zone 80% 内に文字を収めて Android アダプティブアイコン対応。
- **変更対象ファイル:**
  - `apps/web/public/icons/icon.svg` — 新規。512×512 viewBox、中央に「か」配置（フォントは Noto Sans JP もしくは system font）。背景 #ffffff、文字 #111111。
  - `apps/web/scripts/generate-pwa-icons.ts` — 新規。sharp で SVG を読み込み、4 PNG を出力。冒頭コメントに「アイコン変更時はこのスクリプトを再実行してコミット」と明記。
  - `apps/web/package.json` — devDependencies に `sharp` を追加。
  - `apps/web/public/icons/icon-192.png` — 新規（生成物）。
  - `apps/web/public/icons/icon-512.png` — 新規（生成物）。
  - `apps/web/public/icons/icon-maskable-512.png` — 新規（生成物、safe zone 80%）。
  - `apps/web/public/apple-touch-icon.png` — 新規（180×180）。
- **依存タスク:** なし

### タスク2: manifest.webmanifest 作成
- [x] 完了
- **対応 Issue:** #45
- **概要:** Web App Manifest を作成。display:standalone、orientation:portrait、白背景。アイコン 3 種（192 any / 512 any / 512 maskable）を登録。
- **変更対象ファイル:**
  - `apps/web/public/manifest.webmanifest` — 新規。要件定義書 3.1 の JSON をそのまま使用。
- **依存タスク:** タスク1（アイコンパスを参照）

### タスク3: layout.tsx に Metadata 追加
- [x] 完了
- **対応 Issue:** #46
- **概要:** Next.js 15 Metadata API で `manifest`/`appleWebApp`/`icons` を追加、Viewport API で `themeColor` を設定。`Viewport` 型 import 追加。
- **変更対象ファイル:**
  - `apps/web/src/app/layout.tsx` — 既存 `metadata` を拡張、`viewport` を追加。
- **依存タスク:** タスク1, タスク2

### タスク4: ローカル動作確認
- [x] 完了 (一部 Lighthouse/DevTools Installable はユーザー検証へ)
- **対応 Issue:** #47
- **概要:** Chrome DevTools と Lighthouse でインストール可能性を確認。問題があればタスク1〜3 に戻る。
- **確認手順:**
  1. `pnpm dev` で `http://localhost:3000` を起動
  2. Chrome DevTools → Application → Manifest: manifest が読み込まれているか、エラーがないか
  3. Application → Service Workers: 警告なし（SW なしは想定通り）
  4. Lighthouse → "Progressive Web App"カテゴリ → Installable と判定されること
  5. HTML head に `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="theme-color">`, `<meta name="apple-mobile-web-app-capable">` が出ていること
- **変更対象ファイル:** なし（確認のみ）
- **依存タスク:** タスク3

### タスク5: iOS / Android 実機検証 + 必要に応じ修正
- [ ] 完了
- **対応 Issue:** #48
- **概要:** 本機能はマージ後に本番反映してから実機確認する性質。マージ後の本番 (`new.hokudaicarta.com`) で詰まれば fix PR で即修正。
- **検証手順:**
  1. PR をマージして本番反映を待つ
  2. iPhone Safari で `https://new.hokudaicarta.com` を開く
  3. 共有メニュー → 「ホーム画面に追加」→ アイコンが出ること
  4. ホーム画面のアイコンタップ → アドレスバーなしの standalone 起動
  5. （未ログインなら）LINE ログインボタン → LINE 認可画面 → 戻ってログイン状態になること
  6. ダッシュボード等を回遊し、cookie が維持されていることを確認
  7. Android Chrome があれば同様に「アプリをインストール」できることを確認
- **詰まりやすい箇所と対処（fix PR）:**
  - 外部 Safari に飛んで戻れない → Auth.js v5 cookie 設定 (`sameSite: 'lax'`, `secure: true`, `useSecureCookies: true`) 見直し
  - 戻ってきたが未ログイン状態 → session cookie が standalone 側に書き込まれていない可能性。`pages: { signIn: ... }` の URL 形式を絶対 URL → 相対パスに統一
  - アイコン未表示 → public パスの大文字小文字、`apple-touch-icon` のサイズ（180×180 必須）
- **変更対象ファイル:** （詰まった場合のみ）`apps/web/src/auth.ts` 周辺。問題なければ変更なし。
- **依存タスク:** タスク4 + PR マージ

## 実装順序

1. タスク1（アセット生成 — sharp 追加 + SVG + スクリプト + PNG 出力）
2. タスク2（manifest.webmanifest）
3. タスク3（layout.tsx Metadata）
4. タスク4（ローカル DevTools 確認）
5. → PR 作成 → レビュー → マージ → 本番反映
6. タスク5（実機検証 — 詰まれば即 fix PR）

## 補足

- タスク1〜4 は 1 PR で完結。
- タスク5 は本番反映後の検証なので、fix PR が必要な場合のみ別 PR。
- 全体所要時間目安: 実装 1〜2h + 検証 30min + 詰まった場合の fix +30min〜1h。
