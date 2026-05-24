---
status: completed
---
# PWA 対応（最小） 要件定義書

## 1. 概要

- **目的**: スマホのホーム画面に「かげとら」アイコンを追加し、タップでアドレスバーなしのスタンドアロン表示で起動できるようにする。
- **背景**: モバイルファーストのグループウェアだが、現状 `manifest.webmanifest`・Service Worker・アイコン素材が一切なく、「ホーム画面に追加」してもアプリ風起動にならない。`apps/web/public/` ディレクトリすら未作成。最小コストでアプリ感を得る。
- **スコープ外**: Service Worker / オフラインキャッシュ / Web Push 通知（LINE 通知で代替済み）。誘導バナーや「ホーム画面に追加してください」のアプリ内案内 UI も入れない。

## 2. ユーザーストーリー

- **対象ユーザー**: スマホで日常利用する会員（約50名）。会員制で常時ログイン状態を期待。
- **ユーザーの目的**: ブラウザブックマークではなく、ホーム画面のアイコンタップで素早く起動したい。アドレスバーがない方がアプリらしくて気持ちいい。
- **利用シナリオ**:
  1. 初回: スマホブラウザで `new.hokudaicarta.com` を開く → 共有メニュー/メニューから「ホーム画面に追加」 → アイコンができる
  2. 2回目以降: ホーム画面のアイコンタップ → スタンドアロン起動 → 通常通り利用（既ログインなら即ダッシュボード）

## 3. 機能要件

### 3.1 manifest.webmanifest

```json
{
  "name": "かげとら",
  "short_name": "かげとら",
  "description": "競技かるた会グループウェア",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "lang": "ja",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 3.2 アイコン素材

- ソース: `apps/web/public/icons/icon.svg`（中央に「か」を配置したシンプルな文字ロゴ。白背景にダーク文字）
- 出力ファイル（PNG）:
  - `apps/web/public/icons/icon-192.png` (192×192, any)
  - `apps/web/public/icons/icon-512.png` (512×512, any)
  - `apps/web/public/icons/icon-maskable-512.png` (512×512, maskable, safe zone 80% に文字配置)
  - `apps/web/public/apple-touch-icon.png` (180×180)
- 暫定ロゴ前提。将来差し替え可能（SVG 差し替え + 再生成スクリプト実行）。

### 3.3 メタタグ追加（`apps/web/src/app/layout.tsx`）

Next.js 15 Metadata API で追加:

- `metadata.manifest = '/manifest.webmanifest'`
- `metadata.appleWebApp = { capable: true, title: 'かげとら', statusBarStyle: 'default' }`
- `metadata.icons = { icon: [192, 512], apple: '/apple-touch-icon.png' }`
- `viewport.themeColor = '#ffffff'`

### 3.4 ビジネスルール / 制約

- 誘導 UI は入れない（Android Chrome は OS 標準のインストールプロンプトが出ることがある。iOS Safari は手動操作のみで、必要なら別途 Wiki で手順案内）。
- portrait 固定。タブレット横置きでも縦表示。
- 既存ブラウザアクセスは影響なし（HTML head にメタが追加されるだけ）。

### 3.5 エラーケース / 想定リスク

- **iOS Safari standalone モードでの LINE OAuth 詰まり**: 既知問題で、外部 Safari に飛ばされて戻ってこない / cookie store 分離で再ログイン要求されるケースがある。実機で詰まった場合、本 PR 内で以下のいずれかを実施:
  - Auth.js v5 の cookie 設定確認（`sameSite: 'lax'`, `secure: true`）
  - `redirect_uri` の絶対 URL 化
  - LINE Developers の Callback URL に standalone モードからのアクセスでも問題ない設定が入っているか確認
- アイコン未表示: PNG 生成漏れ / パス誤り。タスク4 のローカル DevTools 確認で潰す。

## 4. 技術設計

### 4.1 ファイル構成

```
apps/web/
├── public/                                  （新規ディレクトリ）
│   ├── manifest.webmanifest                 （新規）
│   ├── apple-touch-icon.png                 （新規, 180×180）
│   └── icons/
│       ├── icon.svg                         （新規, 編集ソース）
│       ├── icon-192.png                     （新規, 生成物）
│       ├── icon-512.png                     （新規, 生成物）
│       └── icon-maskable-512.png            （新規, 生成物）
├── scripts/
│   └── generate-pwa-icons.ts                （新規, 1回切り再生成ツール）
├── src/app/
│   └── layout.tsx                           （Metadata 追加のみ）
└── package.json                             （sharp を devDependencies に追加）
```

### 4.2 layout.tsx 変更内容

```typescript
import type { Metadata, Viewport } from 'next'
// ... 既存 import

export const metadata: Metadata = {
  title: 'かげとら',
  description: '競技かるた会グループウェア',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'かげとら',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
}
```

### 4.3 アイコン生成スクリプト

- `apps/web/scripts/generate-pwa-icons.ts`
- 依存: `sharp` （devDependencies）
- 入力: `apps/web/public/icons/icon.svg`
- 出力: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `../apple-touch-icon.png`
- 実行: `pnpm --filter @kagetra/web exec tsx scripts/generate-pwa-icons.ts`
- CI に組み込まない（手動実行 + 生成物コミット）。理由は 6 章。

### 4.4 動作確認手順

- **ローカル**: `pnpm dev` → Chrome DevTools Application タブで manifest が読み込まれること、Installability チェックが通ること、Lighthouse PWA Audit でインストール可能判定が出ることを確認。
- **iOS 実機**: `new.hokudaicarta.com` を Safari で開く → 共有 → ホーム画面に追加 → アイコンタップ → standalone 起動 → LINE ログインフローが完了することを確認。詰まったら同 PR 内で修正。
- **Android Chrome 実機（あれば）**: 同様に「アプリをインストール」できることを確認。

## 5. 影響範囲

- **既存ユーザー**: 影響なし（追加のみ）。
- **認証フロー**: standalone モードで LINE OAuth が動くか実機検証が必須。詰まれば本 PR 内で修正。
- **CI/CD**: 影響なし。テスト追加なし（E2E は standalone モード再現困難 + 効果薄）。生成済み PNG をコミットするため CI で再生成も不要。
- **ビルド/デプロイ**: `apps/web/public/` 配下の静的ファイル追加のみ。`output: 'standalone'` で自動的にビルド成果物に含まれる。
- **shared/ , API**: 影響なし。
- **新規依存**: `sharp` を `apps/web` の devDependencies に1つ追加。

## 6. 設計判断の根拠

- **next-pwa / Serwist を使わない**: 最小スコープでは Service Worker 不要のため、静的ファイル + Metadata API だけで足りる。SW 入れると更新戦略・キャッシュ無効化など運用負荷が発生し、最小スコープと整合しない。
- **アイコンは暫定文字ロゴ**: アプリのブランドアセットが未整備。先にホーム画面追加可能化が目的なので、後で差し替え前提でシンプルに進める。
- **白背景 + ダーク文字**: 現状の Tailwind デフォルト UI と整合。色設計は将来の UI リブランディング時にまとめて見直す。
- **portrait 固定**: モバイルファースト方針一致。タブレット横置きでの UI 崩れも防止。
- **Service Worker / Web Push なし**: オフライン要件なし（常時オンライン前提）。Push は LINE で代替済み。
- **誘導バナー UI なし**: Android Chrome は OS 標準のインストールプロンプトが自動で出る。iOS Safari は OS 機能で誘導不可。会員50名規模なら口頭/Wiki 案内で十分。
- **アイコン生成は手動スクリプト + 生成物コミット**: 1回切りの作業（SVG 差し替え時のみ再実行）。ビルドに組み込むと CI で毎回 sharp が走り無駄。生成物コミットで本番デプロイも素直。
- **iOS LINE OAuth 検証を本 PR に含める**: 「ホーム画面に追加したのにログインできない」が一番痛い。最小スコープでもこの動作確認だけは妥協しない。
