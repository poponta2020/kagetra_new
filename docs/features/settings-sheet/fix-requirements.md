---
status: completed
audit_source: 会話内のユーザー指摘（#P1406 / #P1407「設定画面への導線あります？」）
selected_items: [1]
---
# 設定シート（設定画面への導線）改修要件定義書

## 1. 改修概要

- **対象機能**: アプリのグローバルナビゲーション（設定画面への導線）
- **改修の背景（監査で検出された問題）**:
  - 設定ページが 2 つ実装済み（[/settings/notifications](../../../apps/web/src/app/settings/notifications/page.tsx) = Web Push 購読 / [/settings/line-link](../../../apps/web/src/app/settings/line-link/page.tsx) = LINE アカウント切替）だが、**UI 上のどこからもリンクされておらず URL 直打ちでしか到達できない孤立ページ**になっている。
  - `apps/web/src` 全体を grep しても設定ページへの `href` / `router.push` は 0 件（自己参照・redirect・テストのみ）。
  - 特に `/settings/notifications` は先日 ship した未処理バッジ機能（mail-triage-badge / PR #95）の購読設定であり、ここに到達できないと対象ユーザー（管理者/副管理者）が Web Push を有効化できず**機能が活きない**。
  - さらに両ページは `(app)` ルートグループの**外**にあるため、アプリシェル（[MobileShell](../../../apps/web/src/components/layout/mobile-shell.tsx) = 上バー＋ボトムナビ）が描画されず、`/settings/notifications` には「戻る導線」も無い。
- **設計上の根拠**: [docs/design/design.md](../../design/design.md) §3 に導線仕様が**既に明記されているが未実装**だった。
  > ヘッダ は左にワードマーク、右に `{name}さん`。**設定は `{name}さん` をタップしてシート。**
  > タブは 4 個 : ホーム / イベント / 予定 / 会員。**5 個以上にしない。**

  → 新タブ追加や歯車アイコンは採らず、仕様どおり「ヘッダの `{name}さん` タップ → 設定シート」を実装する。
- **改修スコープ（ユーザー確定）**:
  1. 設定シート（ボトムシート型の設定メニュー）を新規実装し、ヘッダの `{name}さん` から開けるようにする
  2. `/settings/notifications` を `(app)` ルートグループ配下へ移動し、アプリシェル（戻る導線）内で表示する
  3. ヘッダ右のログアウトボタンを設定シート内へ集約する

## 2. 改修内容

### 2.1 設定シートの新規実装
- **現状の問題**: 設定ページへの導線が一切存在しない。
- **修正方針**: 既存モーダルと同一の**手書きボトムシート**パターン（[InviteCodeModal](../../../apps/web/src/components/events/InviteCodeModal.tsx) / [ManualLinkModal](../../../apps/web/src/components/admin/ManualLinkModal.tsx)）で `AccountMenu` クライアントコンポーネントを新規作成。shadcn/Radix は未導入のため**新規依存は追加しない**。
- **あるべき姿**: ヘッダ右の `{name}さん` をタップするとボトムシートが開き、設定メニュー（ロール出し分け）＋ログアウトに到達できる。

### 2.2 設定ページのシェル内移動
- **現状の問題**: `/settings/notifications` が `(app)` 外にあり、上バー・ボトムナビが描画されず戻る手段が無い。
- **修正方針**: ディレクトリを `apps/web/src/app/settings/notifications/` → `apps/web/src/app/(app)/settings/notifications/` へ移動。ルートグループ `(app)` は URL に影響しないため **URL は `/settings/notifications` のまま不変**。
- **あるべき姿**: 設定ページがアプリシェル内で表示され、ボトムナビから他画面へ戻れる。
- **LINE 連携ページ**: [/settings/line-link](../../../apps/web/src/app/settings/line-link/page.tsx) は独自の全画面センタリングレイアウト＋「ダッシュボードへ戻る」リンクを持つ**独立フロー**のため、本改修では移動・スタイル変更せず据え置く（`1PR=1機能` / ついでリファクタ禁止）。見た目の統一は将来の別 PR で検討。

### 2.3 ログアウトの集約
- **現状の問題**: ログアウトがヘッダ右の独立ボタンとして常時露出。design.md の「ヘッダ右は `{name}さん`」仕様と差異。
- **修正方針**: ログアウトを設定シート内へ移動し、ヘッダ右は `{name}さん`（タップでシート）のみにする。ログアウトは引き続き Server Action（`signOutAction`）を `<form>` 経由で呼ぶ。

## 3. 技術設計

### 3.1 API 変更
- なし（フロントエンドのナビゲーションのみ）。

### 3.2 DB 変更
- なし。

### 3.3 フロントエンド変更
- **新規** `apps/web/src/components/layout/account-menu.tsx`（クライアント）
  - Props: `user: string`（整形済み表示名）, `isAdmin: boolean`, `signOutAction: () => Promise<void>`
  - `{user}` ボタン → タップで `open` 状態 true → ボトムシート描画
  - シート内リンク（ロール出し分け）:
    - **メール通知** → `/settings/notifications`（`isAdmin` のときのみ表示。ページ自体が一般会員を /403 へ飛ばすため導線も合わせる）
    - **LINE アカウント切替** → `/settings/line-link`（全員）
    - 区切り線
    - **ログアウト** → `<form action={signOutAction}>` の submit ボタン
  - a11y/挙動: `role="dialog"` `aria-modal="true"` `aria-label="設定"`、背景クリック／×ボタン／Escape で閉じる、リンクタップでシートを閉じてから遷移。iOS セーフエリア考慮で底面に `pb-[env(safe-area-inset-bottom)]`。
- **変更** `apps/web/src/components/layout/app-bar-main.tsx`（サーバー）
  - `AppBarMainProps` に `isAdmin: boolean` を追加
  - 右側の `<span>{user}</span>` ＋ ログアウト `<form>` を削除し、`<AccountMenu user={user} isAdmin={isAdmin} signOutAction={signOutAction} />` を描画
- **変更** `apps/web/src/components/layout/mobile-shell.tsx`
  - `<AppBarMain>` に `isAdmin` を渡す（MobileShell は既に `isAdmin` を受領済み）
- **移動** `apps/web/src/app/settings/notifications/` → `apps/web/src/app/(app)/settings/notifications/`
  - 対象: `page.tsx` / `actions.ts` / `actions.test.ts` / `NotificationSettings.tsx`
  - 相対 import（`./`）はフォルダごと移動で維持、`@/` エイリアスは不変。`revalidatePath('/settings/notifications')` も URL 不変のため修正不要。

### 3.4 バックエンド変更
- なし。

## 4. 影響範囲

- **影響を受ける既存機能**:
  - ヘッダ表示（全 `(app)` 画面）: `{name}さん` がタップ可能になり、ログアウトの位置がシート内へ移る。
  - `/settings/notifications`: シェル内描画に変わる（URL・認可ロジックは不変）。
- **テストへの影響**:
  - [mobile-shell.test.tsx](../../../apps/web/src/components/layout/mobile-shell.test.tsx): `AppBarMain` モックへ `isAdmin` を追加、isAdmin 透過の assertion を追加。
  - 新規 `account-menu.test.tsx`: 開閉・ロール出し分け・リンク href・ログアウト form を検証。
  - 移動した `notifications/actions.test.ts` は相対 import 維持でそのまま green の想定。
- **破壊的変更の有無**: なし。
  - URL 不変（route group は透過）。
  - 認可不変（notifications ページの /403 リダイレクト維持、シート側もロール出し分けで二重防御）。
  - 新規 npm 依存なし。

## 5. 設計判断の根拠

- **シート方式（タブ追加・歯車アイコンを採らない）**: design.md §3 が「設定は `{name}さん` タップでシート」「タブは 4 個、5 個以上にしない」と明記。設計の未実装分を埋める形にする。
- **手書きボトムシート（新規依存なし）**: 既存モーダル 2 件が同パターンを採用済み。Radix/shadcn 導入はオーバースペックかつバンドル増。一貫性のため踏襲。
- **シート＝リンクメニュー（設定内容をインライン展開しない）**: Web Push 購読トグル等の対話 UI はシートに直接埋めず、専用ページへリンク。関心の分離を保つ。
- **notifications のみ (app) へ移動、line-link は据え置き**: notifications はシェル前提のレイアウト（`flex flex-col gap-4` ＋ Card）で書かれており戻る導線が無いのは欠陥。一方 line-link は独自の全画面フロー＋戻るリンクを持つ自己完結ページ。移動対象を分けるのは妥当（ついでリファクタ回避）。
