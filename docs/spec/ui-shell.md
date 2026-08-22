# モバイルシェル・PWA・設定UI (UI Shell)

> **責務:** 全画面共通の外枠（ボトムナビ・スクロール領域。上部バーは廃止済み）、PWA（manifest・Service Worker登録・standalone対応・ピンチズーム抑制）、設定ハブ（`/settings`）、ボトムシート/モーダルの共通CSS規約
> **関連画面:** 認証済み全画面（`(app)` ルートグループ配下）に共通適用。設定はボトムナビの「設定」タブから独立ページ `/settings` として開く
> **主要実装:**
> - `apps/web/src/app/layout.tsx`（RootLayout。フォント・`metadata`・`viewport`・`ServiceWorkerRegister` 設置）
> - `apps/web/src/app/(app)/layout.tsx`（認証ガード＋`MobileShell` へのユーザー情報受け渡し）
> - `apps/web/src/components/layout/mobile-shell.tsx`（縦積みシェル本体）
> - `apps/web/src/components/layout/bottom-nav.tsx`（下部タブバー）
> - `apps/web/src/components/layout/index.ts`（re-export）
> - `apps/web/src/app/(app)/settings/page.tsx`（設定ハブ。アカウント / 管理 / 表示ロール / ログアウト）
> - `apps/web/src/components/ui/app-bar.tsx`（画面内ヘッダ。詳細画面でシェルのクロムを保ったままタイトル＋戻る導線を出す用途）
> - `apps/web/src/components/ServiceWorkerRegister.tsx`（`/sw.js` 登録。前景バッジ同期の詳細は [spec/notifications.md](notifications.md) 参照）
> - `apps/web/public/manifest.webmanifest` / `apps/web/public/icons/` / `apps/web/public/apple-touch-icon.png`
> - `apps/web/public/sw.js`（Web Push 受信本体。詳細は [spec/notifications.md](notifications.md) 参照）
> - `apps/web/src/app/globals.css`（`.mobile-shell-h` / `.modal-overlay-h` の viewport height カスケード）

## 機能仕様

### アプリシェルの構成

`(app)/layout.tsx` はサーバーコンポーネントで、`auth()` によるセッションチェック（未認証は `/auth/signin` へ `redirect`）と `rolePreview` の算出のみを担い、実際の外枠描画は `MobileShell` に委譲する。`session.user.role` が `admin` または `vice_admin` のとき `isAdmin` を `true` として渡し、管理者専用タブの出し分けに使う。ログアウト用 Server Action は `(app)/settings/page.tsx` 内の inline `'use server'` 関数として定義されており、layout からはバケツリレーされない。

`MobileShell` は `<main>`（子要素）→ `BottomNav` の縦積み `flex flex-col` 構造で、`<main>` だけがスクロールする（`flex-1 min-h-0 overflow-y-auto`）。`min-h-0` は必須で、無いと flex の既定 `min-height: auto` により `<main>` がコンテンツ高まで伸び、シェル全体がビューポートを超えて body スクロールが発生し、下部バーが画面外へ流れる（iOS Safari で実際に発生した回帰）。かつて上端にあった44pxの上部バー（ワードマーク＋設定シートトリガー）は廃止済みで、シェルの子は `<main>` と `<nav>` の2つだけになった。

デザインはモバイル専用（`docs/design/design.md` §3・`docs/design/ui_kits/kagetra-mobile/primitives.jsx` の `MobileFrame` に準拠）で、`MobileShell` 自体には `md:` 等のレスポンシブ修飾子や `max-w-*` 制約を意図的に付けない。より広い表示が必要な管理画面（テーブル等）は各ページ側で個別に `max-w-5xl` 等を指定する。

### ビューポート高カスケード（`.mobile-shell-h` / `.modal-overlay-h`）

シェルの高さおよびボトムシート/モーダルオーバーレイの高さは、Tailwind のユーティリティ合成（`h-screen h-dvh h-svh` のような並記）では**保証されない**。同一プロパティに対する Tailwind ユーティリティの出力順は `className` の記述順とは無関係に決まるため、どの宣言が最終的に勝つか制御できない。そのため `globals.css` に単一の CSS ルールとして

```css
height: 100vh;   /* 旧ブラウザ fallback */
height: 100dvh;  /* dynamic viewport（後述の理由で上書きされる） */
height: 100svh;  /* small viewport ＝ 最終的な採用値 */
```

の順で列挙する専用クラスを用意し、カスケードの「最後に理解できた宣言が勝つ」性質を利用して確定的に `100svh` を勝たせている。`viewport-fit=cover` 指定時、iOS Safari の `100dvh` は下部URLバーのオーバーレイ領域を含んだ値を返すため、`dvh` のままだとシェルやモーダルの実際の高さがビューポートの表示可能域より大きくなり、BottomNav やシート下部のボタンがURLバーの下に隠れる。`100svh` はUAクロームが常に表示された状態の保守的な高さで、URLバーが後で縮んでも上下バーが隠れないことを優先し、代わりにURLバー縮小時に余白帯ができるトレードオフを取る。

このクラスは `MobileShell` のルート `div`（`.mobile-shell-h`）と、共有ボトムシート/モーダル群（`RankingFilterBar`・`StatsPeriodFilter`・`InviteCodeModal`・`RegistrationInviteModal`・`ManualLinkModal`・`GroupPickerSheet` 等、各ドメインの正典に実装詳細がある）の `.modal-overlay-h` に共通適用される。

### ボトムナビ（`BottomNav`）

`usePathname()` でアクティブタブを判定するクライアントコンポーネント。タブ定義は `bottom-nav.tsx` 内の `TABS` 配列にハードコードされており、各タブは `matches`（アクティブ判定用パスプレフィックスの配列）を持つ。判定はセグメント境界を意識し、`pathname === prefix || pathname.startsWith(prefix + '/')` で一致させる。これは単純な `startsWith` 判定だと `/events-archive` が `/events` タブを誤って光らせてしまう回帰を修正したもの。

現在のタブ構成（一般会員・管理者とも6タブ。`設定` は常に最後尾）:

| id | ラベル | href | active 判定 matches | 表示条件 |
|---|---|---|---|---|
| `home` | ホーム | `/dashboard` | `/dashboard` | 全員 |
| `events` | イベント | `/events` | `/events` | 全員 |
| `players` | 統計 | `/players` | `/players`, `/tournaments` | 全員 |
| `entries` | 申込管理 | `/admin/entries` | `/admin/entries` | 全員 |
| `mail-inbox` | メール | 管理者 `/admin/mail-inbox` ／ 一般会員 `/mail` | `/admin/mail-inbox`, `/mail` | 全員 |
| `settings` | 設定 | `/settings` | `/settings`, `/admin/members`, `/admin/line-channels` | 全員 |

各タブの機能自体（何が表示されるか）は対応ドメインの正典（events-attendance / stats / auth-admin / notifications 等）を参照。`統計` タブは `/players` と `/tournaments` の2基底配下すべてでアクティブになる（選手検索・大会結果・ランキング・大会統計の4セクションがこの2ルートに分かれているため）。`adminOnly` のタブは現在ひとつも無い。`申込管理` は当初 `adminOnly` だったが、ボード自体が表示専用で会員も知りたい進捗なので閲覧を全員へ開放した（URL は `/admin/entries` のまま据え置き）。`メール` も同様に全員へ開放したが、こちらは会員向けが**別画面**（読み取り専用の `/mail`）なので `memberHref` で遷移先だけを role で振り分ける（表示・並び・active 判定は共通。会員側の仕様は [spec/mail-worker.md](mail-worker.md)）。`isAdmin` は `session.user.role`＝実効ロール由来なので、管理者が一般会員をプレビュー中は会員と同じ `/mail` を指す。`設定` タブは会員 (`/admin/members`) と Bot (`/admin/line-channels`) の独立タブを廃止した受け皿を兼ねるため、これらのパス配下にいる間も active になる（「設定から辿った先」だと分かるように）。表示ロールをプレビュー中は `設定` タブの上にロール名バッジ（`previewRoleLabel`）が出る。

`<nav>` は `min-h-[calc(52px_+_env(safe-area-inset-bottom))]` と `pb-[env(safe-area-inset-bottom)]` を持つ。Tailwind の既定 `box-sizing: border-box` により `min-h` は border+padding+content を含む外側の高さとして扱われるため、`min-h-[52px]` のまま safe-area の padding-bottom（iPhone で約34px）を足すとタップ領域が約18pxまで潰れ、52px の `<Link>` 子要素がはみ出す。padding 分をあらかじめ `min-h` に加算する（`calc(52px + env(safe-area-inset-bottom))`）ことで、safe-area 分を差し引いた後も内容領域が52px確保される。

### 設定ハブ（`/settings`）

上部バー（44px、ワードマーク＋ `{name}さん` トリガーの設定シート）は廃止済み。設定はボトムナビの「設定」タブから開く独立ページ `apps/web/src/app/(app)/settings/page.tsx`（サーバーコンポーネント）に集約されている。ログアウト用 Server Action はこのページ内の `<form action={signOutAction}>` に対する inline `'use server'` 関数で、以前のような `(app)/layout.tsx` → `MobileShell` → … のバケツリレーは無くなった。

ページ構成は上から: 見出し「設定」＋ `${name}さん`、「アカウント」セクション、「管理」セクション（`isAdmin` のときのみ描画）、「表示ロール」セクション（`rolePreview` が非 null のときのみ描画）、ログアウトボタン。

- アカウント: `LINE アカウント切替`（`/settings/line-link` へのリンク）— 全ユーザーに表示。中身は [spec/auth-admin.md](auth-admin.md) 参照
- 管理（`isAdmin` のみ）: `会員`（`/admin/members`）、`メール通知`（`/settings/notifications`。中身は [spec/notifications.md](notifications.md) 参照）、`Bot`（`/admin/line-channels`）
- 表示ロール: `setRolePreviewAction` を叩く `<form>` 内に、選べるロールぶんの submit ボタンを並べたセクション。現在の実効ロールのボタンに `aria-current="true"` が付く。フォームは `<input type="hidden" name="returnTo" value="/settings">` を持ち、切替後もこのページに留まる（以前はシートを開いた画面へ戻す設計だったが、シートが全画面から開ける前提が無くなったため）。ロールの意味・許可条件・認可規律は [spec/auth-admin.md](auth-admin.md) 参照

`rolePreview` は `(app)/settings/page.tsx` がサーバー側で `session.user` と `process.env.ROLE_PREVIEW_USER_IDS` から都度算出する（`(app)/layout.tsx` 側でも別途算出し、`BottomNav` の設定タブバッジ用に `previewRoleLabel` として渡す — 2 箇所での算出はどちらも `buildRolePreviewSelection` を通すため不整合は生じない）。プレビュー中は設定タブの上に `previewRoleLabel` のバッジが表示される（ボトムナビ節を参照）。

**実効ロールがゲストのときは専用の分岐**（表示のみビュー: 見出し＋「登録情報」（表示名・級・所属会。値は DB の最新値）＋ログアウト）になり、アカウント／管理セクションは描画されない。ここに**唯一加わるのが「表示ロール」セクション**で、管理者がゲストビューから戻る唯一の導線になる（両分岐が同じローカルコンポーネント `RolePreviewSection` を描画する。`rolePreview` の算出をゲスト分岐より前に置くのはこのため）。本物のゲスト（`realRole === 'guest'`）には `buildRolePreviewSelection` が null を返すので出ない。ゲストビュー中の「登録情報」に出るのは**プレビュー中の管理者自身の行**（`session.user.id` で引くため）。

### 設定ページの配置と `(app)` グループの内外

`/settings`・`/settings/notifications`・`/settings/line-link` はいずれも `(app)` ルートグループ配下にあり、`MobileShell` の内側（ボトムナビ付き）で描画される。`/settings/line-link`（`apps/web/src/app/(app)/settings/line-link/page.tsx`）は LINE OAuth のリダイレクトを伴う切り替えフローだが、URL は移設前と変わらず、シェル内ページとして描画される点だけが変わった（以前は `(app)` グループの外にある独立ページで、遷移するとボトムナビへ戻る手段が無かった）。ページ内容は [spec/notifications.md](notifications.md) と [spec/auth-admin.md](auth-admin.md) にそれぞれ委譲する。

`apps/web/src/components/ui/app-bar.tsx` の `AppBar` は、詳細画面がシェルのクロムを維持したまま画面内タイトル＋戻る導線を出したいときに使う画面内ヘッダコンポーネントである。

### PWA（manifest・Service Worker・standalone）

`apps/web/public/manifest.webmanifest` は `display: "standalone"`、`orientation: "portrait"`、`start_url` / `scope` とも `/`、`lang: "ja"` を指定する静的ファイル。アイコンは 192px・512px（`purpose: "any"`）と 512px maskable の3種（`apps/web/public/icons/`）。`RootLayout`（`apps/web/src/app/layout.tsx`）の `metadata.manifest` でこのファイルを参照し、`metadata.appleWebApp = { capable: true, title: 'かげとら', statusBarStyle: 'default' }` と `metadata.icons.apple` で iOS のホーム画面追加（standalone 起動）に対応する。

`viewport` エクスポートで `maximumScale: 1` と `userScalable: false` を設定し、ブラウザタブ表示時のピンチズームを抑制してネイティブアプリに近い操作感にする（姉妹アプリ match-tracker の `maximum-scale=1.0` に合わせた仕様）。`userScalable: false` は Android Chrome 向けの補強で、iOS Safari は単独では無視するが `maximumScale: 1` と組み合わせて機能する。`viewportFit: 'cover'` は `env(safe-area-inset-*)` を非ゼロにするために必須で、`BottomNav` の safe-area padding-bottom はこの設定に依存する。

`ServiceWorkerRegister`（クライアントコンポーネント、`RootLayout` の `<body>` 直下に1つだけ設置）は `navigator.serviceWorker.register('/sw.js')` を呼ぶだけがシェルとしての責務であり、失敗時（非対応ブラウザ等）は黙ってスキップする。同コンポーネントが併せて行っている前景バッジ同期（`navigator.setAppBadge` の可視化タイミング同期）と、`apps/web/public/sw.js` が実装する `push` / `notificationclick` イベントハンドラの中身は Web Push 通知機能の一部であり、詳細は [spec/notifications.md](notifications.md) の正典とする。

### フォント・テーマカラー

`RootLayout` は `next/font/google` の `Noto_Sans_JP`（本文、`display: 'swap'`）と `Noto_Serif_JP`（見出し等の一部、`weight: ['700']` のみプリロード無効）を CSS 変数として `<html>` に適用する。`viewport.themeColor` および manifest の `background_color` / `theme_color` はいずれも `#ffffff` で統一されている。

## 既知のギャップ・未確認事項

- `apps/web/public/sw.js` は現状 Web Push（notifications ドメイン）専用の実装のみを持ち、UI シェル固有の PWA 挙動（オフラインキャッシュ等）は実装されていない。将来オフライン対応が追加された場合、この仕様書の PWA セクションを更新する
