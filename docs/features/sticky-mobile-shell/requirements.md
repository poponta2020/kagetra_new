---
status: completed
---
# モバイルシェル固定（ヘッダー・ボトムナビ） 要件定義書（ドラフト）

## 1. 概要

- **目的:** モバイル（iPhone Safari / PWA standalone）でページコンテンツをスクロールしたときに、上部の AppBar（かげとら / ログアウト）と下部の BottomNav（ホーム / イベント / 予定 / 会員 / メール）が画面端に常に表示されるようにする。
- **背景:** 現状の `MobileShell` は `min-h-screen flex flex-col` で構成されており、`<main>` に `overflow-y-auto` が付いているものの、コンテンツが viewport を超えるとシェル全体が伸びてしまい、結果として body 全体がスクロールしてヘッダー/ナビごと画面外に消える。コメントには「sticky 44px top bar」「sticky 52px bottom tab bar」と書かれているが、実装が追従していない。

## 2. ユーザーストーリー

- **対象ユーザー:** モバイル端末（iPhone Safari、iPhone PWA standalone）で「かげとら」を利用する全会員（一般会員・副管理者・管理者）。
- **ユーザーの目的:** ダッシュボード / イベント詳細 / 予定一覧 / 会員管理 / メール受信箱など、縦に長いリストや本文を閲覧しているときに、スクロール位置に関係なくいつでもタブ切り替え・ログアウトができる。
- **利用シナリオ:**
  1. 会員がイベント詳細ページを下までスクロールして出欠ボタンを押した後、すぐに BottomNav の「ホーム」をタップしてダッシュボードに戻る。
  2. 管理者が `/admin/members` の長いリストを下までスクロールしながら、上部のログアウトボタンに常にアクセスできる。
  3. PWA standalone モードで利用中、画面下部のホームインジケータ領域とナビが被らず、タブが押しやすい。

## 3. 機能要件

### 3.1 画面挙動

- **AppBar（44px）と BottomNav（52px）は常に画面端に表示される。** ページコンテンツがどれだけ縦に長くてもスクロール中に画面外に消えない。
- **スクロールするのは `<main>` の内側のみ。** `<html>` / `<body>` 全体はスクロールしない。
- **iPhone Safari の URL バー出現/非表示による viewport 高さ変動に追従する。** `h-dvh`（dynamic viewport height）を使い、シェルが常に「現在の見えている viewport」にフィットする。
- **iPhone のホームインジケータ領域（safe-area-inset-bottom）にも BottomNav の背景色を伸ばす。** タップ領域は 52px のまま維持し、background だけ safe area の高さ分追加する。

### 3.2 ナビゲーション挙動（変更なし）

- **ページ遷移ごとに `<main>` のスクロール位置はトップに戻る。** Next.js App Router のデフォルト挙動を維持し、タブ間スクロール位置の記憶は実装しない。
- **同じタブをタップしたときの再タップ挙動は何もしない。** `next/link` のデフォルト挙動に任せる（クライアントナビゲーションだけ走る）。

### 3.3 スコープ外

- **個別ページ内の横スクロール（例: `/admin/members` の `max-w-5xl` テーブル）は本 PR では触らない。** 各ページが自分の `<main>` の中で `overflow-x-auto` を持つ責務とする。
- **`<keyboard>` 出現時の挙動最適化は本 PR では触らない。** iOS Safari は仮想キーボード出現時に visualViewport を縮める挙動があるが、入力フォーム自体が小さいため致命的ではない（必要なら別 PR）。
- **スクロール位置の記憶やタブ再タップでのスクロールトップは別 PR。**

### 3.4 ビジネスルール

- 既存の BottomNav タブ構成・admin ゲーティング・active 判定ロジックは変更しない（PR #2 系・mail-tournament-import で固まった仕様を維持）。
- 既存ページのレイアウト・スタイルを壊さない（リグレッションなし）。

## 4. 技術設計

### 4.1 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `apps/web/src/app/layout.tsx` | `viewport` export に `viewportFit: 'cover'` を追加（safe-area-inset-* を有効化するために必須） |
| `apps/web/src/components/layout/mobile-shell.tsx` | shell コンテナを `min-h-screen` → `h-screen h-dvh` に変更、コメントを実装と一致させる |
| `apps/web/src/components/layout/bottom-nav.tsx` | `<nav>` に Tailwind arbitrary value `pb-[env(safe-area-inset-bottom)]` を追加（jsdom CSSOM が inline `env()` を弾くため class 化）、高さを `h-[52px]` から `min-h-[52px]` 系に調整しタブ自体は 52px を維持 |
| `apps/web/src/components/layout/mobile-shell.test.tsx` | **新規。** shell に `h-dvh` クラスが付くこと、main に `flex-1 overflow-y-auto` が付くこと、BottomNav が render されることを構造テスト |

### 4.2 実装詳細

**`apps/web/src/app/layout.tsx`**

```tsx
export const viewport: Viewport = {
  themeColor: '#ffffff',
  viewportFit: 'cover',  // ← 追加。safe-area-inset-* を有効化
}
```

**`apps/web/src/components/layout/mobile-shell.tsx`**

```tsx
<div className="flex h-screen h-dvh flex-col bg-canvas text-ink font-sans">
  <AppBarMain ... />
  <main className="flex-1 overflow-y-auto">{children}</main>
  <BottomNav isAdmin={isAdmin} />
</div>
```

- `h-screen h-dvh` の順で書くことで、`h-dvh` 未サポートブラウザは `h-screen` (100vh) にフォールバック、サポートブラウザは後勝ちで `h-dvh` が適用される。
- 既存コメントの「sticky 44px top bar + scrollable main + sticky 52px bottom tab bar」を「Fits viewport via h-dvh; AppBar/BottomNav stay at flex edges, main scrolls.」のような実装一致の記述に更新。

**`apps/web/src/components/layout/bottom-nav.tsx`**

```tsx
<nav className="min-h-[52px] pb-[env(safe-area-inset-bottom)] flex-shrink-0 flex items-stretch bg-surface border-t border-border">
  {visibleTabs.map((tab) => (
    <Link
      ...
      className={cn(
        'h-[52px] flex-1 flex items-center justify-center text-[11px] font-medium border-t-2 transition-colors',
        ...
      )}
    >
      {tab.label}
    </Link>
  ))}
</nav>
```

- `<nav>` 高さは `min-h-[52px]` + Tailwind arbitrary value `pb-[env(safe-area-inset-bottom)]`（safe-area 込みで 52px + α）。
- 当初は inline style で `paddingBottom: 'env(...)'` を当てる方針だったが、jsdom (vitest) の CSSOM が `env()` を invalid と判定して style attribute ごと捨てるためテスト不能。Tailwind arbitrary value に切り替えて class 名で検証可能にした（実機の挙動は等価）。
- 各 `<Link>` のタップ可能領域は明示的に `h-[52px]` で 52px 固定。
- safe-area 部分（home indicator 領域）は `<nav>` の padding 領域として bg-surface のまま描画される。

**`apps/web/src/components/layout/mobile-shell.test.tsx`**（新規）

- mock `AppBarMain` / `BottomNav` を入れて MobileShell 単体の構造を検証。
- 検証項目: shell に `h-dvh` クラスが付く / `main` 要素が `flex-1` と `overflow-y-auto` を持つ / BottomNav と AppBarMain が children と一緒に render される。

### 4.3 既存テストへの影響

- `bottom-nav.test.tsx` の既存 8 ケース（admin タブ表示・active 判定）は構造に依存しないので、`h-[52px]` から `min-h-[52px]` への変更でも壊れない見込み。実行して確認する。

## 5. 影響範囲

### 5.1 既存ページのスクロール挙動の変化

修正前は `<html>`/`<body>` 全体がスクロールしていたのが、修正後は `<main>` 内だけがスクロールするようになる。これにより以下の影響が出る可能性がある:

- **`apps/web/src/app/(app)/events/[id]/page.tsx:331`** — `sticky bottom-0` の出欠トグル UI。
  - 修正前: body スクロールでの sticky → 画面下端（BottomNav と重なる懸念あり）
  - 修正後: `<main>` 内スクロールでの sticky → main の下端、つまり BottomNav のすぐ上に乗る
  - **想定はむしろ良い方向への変化** だが、視覚チェック必須。
- **`apps/web/src/app/self-identify/candidate-list.tsx`** — `scrollIntoView` を使う可能性。中身を確認しスクロール container が `<main>` でも動くか検証。
  - そもそも self-identify ページは `(app)` 配下ではないので MobileShell でラップされていない → 影響なし。
- **その他の `(app)` 配下ページ全般** — 縦に長いページで window.scrollTo / scrollY を使っているコードがあれば壊れる。grep で `window.scroll` / `document.scrollingElement` の使用箇所を最終確認する。

### 5.2 MobileShell の外のページ（影響なし）

以下は `(app)` 配下ではなく MobileShell を使っていない:

- `apps/web/src/app/auth/signin/page.tsx`
- `apps/web/src/app/403/page.tsx`
- `apps/web/src/app/self-identify/page.tsx`
- `apps/web/src/app/settings/line-link/page.tsx`

各々 `min-h-screen` を使っているがそのまま維持。

### 5.3 viewport-fit=cover の副作用

- `viewport-fit=cover` を入れると iOS で WebView がノッチ/ホームインジケータ領域に「広がる」。今のところ AppBar / BottomNav / main の各セクションは bg-surface / bg-canvas で塗りつぶされる前提なので、左右ノッチが目立つことはない想定。
- 念のため `<main>` 内のページ（ダッシュボード等）の左右パディングをチェックし、ノッチ越しに切れる文字がないか実機で確認する。

### 5.4 互換性

- `h-dvh`: iOS Safari 15.4+ (2022-03), Android Chrome 108+ (2022-11) 対応。`h-screen` フォールバックがあるので未サポート環境でも極端な破綻はしない。
- `env(safe-area-inset-bottom)`: iOS 11+, 主要ブラウザ全て対応。

## 6. 設計判断の根拠

### 6.1 なぜ `h-dvh` ベース（方針 A）にするか

- 候補 B（`sticky` 化）は親の overflow が絡むと挙動が読みにくい（とくに iOS Safari）。デバッグが脱走しやすい。
- 候補 C（`fixed` 化）は AppBar/BottomNav の位置と main の padding を分離管理する必要があり、修正コストと考慮事項が増える。
- 候補 A は flex 一本で完結し、`<main>` の `overflow-y-auto` が確実に効くので最もシンプル。既存コメントが想定していたモデル（「sticky 44px top + scrollable main + sticky 52px bottom」）を最も低コストで実現できる。

### 6.2 なぜ safe-area は BottomNav の `padding-bottom` で吸収するか

- shell 全体に `padding-bottom` を入れる方法だと、BottomNav の下にできる余白が `bg-canvas` 色になり BottomNav の `bg-surface` と色違いが目立つ。
- BottomNav 自身が padding 領域として safe-area を抱えると、`bg-surface` が home indicator 領域まで自然に伸び、視覚的に統一感が出る。Tailwind / Next.js モバイル UI の定石。

### 6.3 なぜ Playwright E2E は追加しないか

- スクロール挙動・safe-area・h-dvh はいずれも実機 / 実 viewport で初めて意味を持つ確認。Playwright headless は viewport を擬似的に変えるだけで実機の URL バー出現や safe-area は再現できない。
- DoD として「iPhone Safari 実機での目視確認」を入れる方が確実で、CI コストが増えるリスクに見合わない。

