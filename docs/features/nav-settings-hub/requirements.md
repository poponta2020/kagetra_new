---
status: completed
mode: 改修（delta）
design_required: true
approved_at: 2026-07-26
---

# ナビゲーション再編（上部バー廃止・設定ハブ新設） 要件定義書

## 1. 概要

### 目的
画面上部に常駐する 44px の上部バー（ワードマーク「かげとら」＋「◯◯さん」）を廃止し、
そこに集約されていた設定機能を **ボトムナビの「設定」タブ → 独立した設定ページ** へ移す。
あわせて、日常的に使わない管理導線（会員・Bot）をボトムナビから設定ページへ移設する。

### 背景・動機
- ワードマークとログインユーザー名は、常時 44px を占有する割に情報価値が低い（ユーザー申告）。
- 設定への導線が「ユーザー名をタップ」という発見しづらいアフォーダンスに埋まっている。
- ボトムナビが管理者で 7 タブまで膨らみ、375px 幅で 1 タブ 53.6px と窮屈。
- 「会員」「Bot」は日常動線ではなく、設定ハブに置くのが自然。

---

## 2. 現行挙動ベースライン（Δ1）

本機能に対応する既存の requirements.md は存在しない（`settings-sheet` / `sticky-mobile-shell` /
`role-preview-switch` の 3 機能にまたがる領域）。現行実装から起こしたベースラインは以下。
**本要件書は上記 3 機能のうち「上部バー・設定シート・ボトムナビ構成」に関する記述を上書きする**
（各機能の他の記述＝シェル高さの svh カスケード、ロールプレビューの権限判定などは有効なまま）。

### 現行の上部バー（`components/layout/app-bar-main.tsx`）
- 高さ 44px、`bg-surface` ＋下ボーダー。左＝ワードマーク「かげとら」、右＝`{name}さん` ボタン。
- `{name}さん` をタップすると `AccountMenu`（ボトムシート）が開く。中身:
  - メール通知 → `/settings/notifications`（管理者のみ）
  - LINE アカウント切替 → `/settings/line-link`
  - 表示ロール（`ROLE_PREVIEW_USER_IDS` 許可ユーザーのみ）: 切替ボタン群
  - ログアウト
- プレビュー中は `{name}さん` の左に `previewBadge` の Pill が出る。
- 表示ロール切替後は「シートを開いた時点の `pathname + search`」へ戻る（`returnTo`）。

### 現行のボトムナビ（`components/layout/bottom-nav.tsx`）
| タブ | href | 対象 |
|---|---|---|
| ホーム | `/dashboard` | 全員 |
| イベント | `/events` | 全員 |
| 統計 | `/players`（`/tournaments` も active） | 全員 |
| 申込管理 | `/admin/entries` | 管理者 |
| 会員 | `/admin/members` | 管理者 |
| メール | `/admin/mail-inbox` | 管理者 |
| Bot | `/admin/line-channels` | 管理者 |

一般会員 3 タブ / 管理者 7 タブ。

### その他の現状
- `/settings/notifications` は `(app)` グループ配下（シェルあり）。
- `/settings/line-link` は **`(app)` の外**（`src/app/settings/line-link/`）。シェルもボトムナビも無く、
  「ダッシュボードへ戻る」リンクだけが脱出口。`e2e/settings-entry.spec.ts` が notifications について
  同種の孤児化を回帰ガードしている。
- 設定ページ（`/settings` 単体）は存在しない。
- `components/ui/app-bar.tsx`（画面内ヘッダ）は定義のみで未使用。各画面は独自の `<h1>` を持つ。

---

## 3. 変更内容（Δ2）

### 3.1 上部バーの廃止
- `MobileShell` から `AppBarMain` を取り除き、シェルは `<main>` ＋ `BottomNav` の 2 要素構成にする。
- `app-bar-main.tsx` / `account-menu.tsx` を削除（設定シートは設定ページに置き換わるため）。
- 空いた 44px はコンテンツ領域に返す。

### 3.2 ボトムナビの再構成
| タブ | href | active 判定 | 対象 |
|---|---|---|---|
| ホーム | `/dashboard` | `/dashboard` | 全員 |
| イベント | `/events` | `/events` | 全員 |
| 統計 | `/players` | `/players`, `/tournaments` | 全員 |
| 申込管理 | `/admin/entries` | `/admin/entries` | 管理者 |
| メール | `/admin/mail-inbox` | `/admin/mail-inbox` | 管理者 |
| **設定** | `/settings` | `/settings`, `/admin/members`, `/admin/line-channels` | 全員 |

- 「会員」「Bot」タブは削除。一般会員 4 タブ / 管理者 6 タブ。
- 「設定」は常に最後尾。
- 表示ロールプレビュー中は「設定」タブにプレビュー中を示すバッジを出す（見た目は design-spec）。

### 3.3 設定ページ `/settings`（新規）
`(app)/settings/page.tsx` を新設。現行シートの中身＋移設分を 1 画面に集約する。

- 見出し「設定」／その下にログイン中のユーザー名（`◯◯さん`）
- **アカウント**
  - LINE アカウント切替 → `/settings/line-link`
- **管理**（管理者のみ・非管理者には項目自体を出さない）
  - 会員 → `/admin/members`
  - メール通知 → `/settings/notifications`
  - Bot → `/admin/line-channels`
- **表示ロール**（`rolePreview` が非 null のときのみ）
  - 選択可能ロールの切替ボタン群。現在の表示ロールが分かること。
  - 切替後は `/settings` に留まる。
- **ログアウト**

### 3.4 `/settings/line-link` を `(app)` 配下へ移設
- `src/app/settings/line-link/` → `src/app/(app)/settings/line-link/`（**URL は不変**）。
- シェル内に収まるレイアウトへ調整（`min-h-screen` の中央寄せカードを解除）。
- ボトムナビで戻れるため「ダッシュボードへ戻る」リンクは削除してよい。

### 3.5 ページ余白の統一（デザイン収束ループで判明・ユーザー承認済み）
上部バーが消えると、根要素に余白を持たないページの見出しが**画面最上端 (y=0)** に張り付く。
`<main>` に padding を足さない境界（PR #345 の回帰ガード）は維持したまま、
**各ページ側**に `p-4` を入れて解消する（`/events`・`/tournaments`・`/players/[id]` 等が
既に採っている規約に揃える）。対象は根要素に padding を持たない次の 14 ページ:

`dashboard` / `admin/entries` / `admin/members` / `admin/members/[id]/edit` /
`admin/mail-inbox` / `admin/mail-inbox/[id]` / `admin/mail-inbox/mail/[id]` /
`admin/mail-inbox/result-drafts/[id]` / `admin/mail-inbox/roster-drafts/[id]` /
`events-archive` / `events/new` / `events/[id]` / `events/[id]/edit` / `settings/notifications`

対象外（意図的な全幅レイアウト）: `players` / `players/ranking`（sticky フィルタバーが全幅）、
`admin/mail-inbox/attachments/[id]`（画像ビューア）。

---

## 4. 変わらないもの（回帰対象）

- `/settings/notifications`・`/settings/line-link`・`/admin/members`・`/admin/line-channels` の
  **URL と各ページ自体の機能・権限ゲート**は変更しない（導線だけが変わる）。
- ログアウトの挙動（`signOut({ redirectTo: '/auth/signin' })`）。
- 表示ロール切替の権限判定（`ROLE_PREVIEW_USER_IDS`・`buildRolePreviewSelection`）と Server Action の契約。
- シェル高さの svh カスケード（`.mobile-shell-h`）とスクロール領域が `<main>` のみである性質。
- ボトムナビの高さ計算（`52px + env(safe-area-inset-bottom)`、タップ領域 52px）。
- `<main>` に padding を足さない（PR #345 の回帰ガード `7a1e082`）。
- middleware の認証・self-identify リダイレクト挙動。

---

## 5. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-1 | `MobileShell` は上部バーを描画しない（ワードマーク「かげとら」もユーザー名も DOM に存在しない） | auto-test |
| AC-2 | `MobileShell` の子は `<main>` と `<nav>`（ボトムナビ）のみで、`<main>` は `flex-1 min-h-0 overflow-y-auto` を保つ | auto-test |
| AC-3 | `<main>` に padding クラスが付かない（PR #345 の回帰ガードを維持） | auto-test |
| AC-4 | 一般会員のボトムナビは ホーム/イベント/統計/設定 の 4 タブちょうど | auto-test |
| AC-5 | 管理者のボトムナビは ホーム/イベント/統計/申込管理/メール/設定 の 6 タブちょうど（会員・Bot タブは存在しない） | auto-test |
| AC-6 | 「設定」タブは常に最後尾に描画される | auto-test |
| AC-7 | `/settings`・`/settings/notifications`・`/admin/members`・`/admin/line-channels` のいずれにいても「設定」タブが active になる | auto-test |
| AC-8 | `/events-archive` など兄弟ルートで誤って別タブが active にならない（セグメント境界一致を維持） | auto-test |
| AC-9 | `/settings` に一般会員でアクセスすると「LINE アカウント切替」とログアウトが表示され、会員・メール通知・Bot は表示されない | auto-test |
| AC-10 | `/settings` に管理者でアクセスすると 会員・メール通知・Bot・LINE アカウント切替・ログアウトが表示される | auto-test |
| AC-11 | `/settings` の各リンクの href が `/admin/members`・`/settings/notifications`・`/admin/line-channels`・`/settings/line-link` である | auto-test |
| AC-12 | `/settings` にログイン中のユーザー名（`◯◯さん`）が表示される | auto-test |
| AC-13 | `rolePreview` が null のとき `/settings` に「表示ロール」セクションが描画されない | auto-test |
| AC-14 | `rolePreview` が非 null のとき `/settings` に選択可能ロールの切替ボタンが並び、現在の表示ロールが判別できる | auto-test |
| AC-15 | 表示ロール切替の Server Action 実行後、`/settings` に留まる（`returnTo` が `/settings`） | auto-test |
| AC-16 | プレビュー中はボトムナビの「設定」タブにプレビュー中バッジが表示され、プレビューしていないときは表示されない | auto-test |
| AC-16b | §3.5 の 14 ページの根要素に `p-4` が付いている（`<main>` は AC-3 のとおり padding 無しのまま） | auto-test |
| AC-17 | `/settings/line-link` の URL が変わらず、シェル内（ボトムナビあり）で表示される | auto-test |
| AC-18 | `/settings` のログアウトボタンでサインアウトでき、`/auth/signin` へ遷移する | auto-test |
| AC-19 | 削除した `app-bar-main.tsx` / `account-menu.tsx` への参照がリポジトリに残っていない（`layout/index.ts` の re-export 含む） | auto-test |
| AC-20 | 既存テスト・lint・typecheck が CI で green（`settings-entry.spec.ts` は新しい導線に合わせて更新済み） | auto-test |
| AC-21 | 実機 375px でボトムナビ 6 タブのラベルが折り返さず、設定ページが崩れず表示される | manual |

---

## 6. Non-goals

- `/admin/members`・`/admin/line-channels`・`/settings/notifications` の**中身**の変更（導線のみ）。
- 「申込管理」「メール」タブの移設（ボトムナビに残す）。メールは未処理バッジがあるため常時可視を維持。
- 未使用の `components/ui/app-bar.tsx` の削除やリファクタ（ついで整備はしない）。
- ダークモード・デスクトップレイアウト対応。
- 設定ページへの新規設定項目の追加（既存項目の集約のみ）。
- 各ページの**中身**の変更。触るのは §3.5 の根要素 `p-4` だけで、ホーム画面（`/dashboard`）を
  含め表示内容・ロジックは変えない。ログインユーザー名は `ようこそ、◯◯さん` で引き続き確認できる。
- ローカル dev DB のマイグレーション同期（台帳が 3/45 しか記録されておらず `/events`・`/admin/*` が
  ローカルで 500 になる既存問題。今回の変更とは無関係で、別件として扱う）。

---

## 7. 技術的制約・契約

- **削除対象**: `components/layout/app-bar-main.tsx`、`components/layout/account-menu.tsx`（＋ `.test.tsx`）。
  `components/layout/index.ts` の `AppBarMain` re-export も外す。
- **`MobileShellProps` の縮小**: `isAdmin` と `previewRoleLabel`（設定タブのバッジ文言）の 2 つだけ。
  `user` / `signOutAction` / `rolePreview` / `previewBadge` / `setRolePreviewAction` は落とす。
  `(app)/settings/page.tsx` が自前で `auth()` / `buildRolePreviewSelection()` /
  `setRolePreviewAction` を参照して解決する。`(app)/layout.tsx` の受け渡しも同様に整理する。
- **`setRolePreviewAction`** は `(app)/role-preview-actions.ts` からそのまま利用する（Server Action の契約不変）。
  `returnTo` に `/settings` を固定値で渡す（現行の `window.location` 読み取りは不要になる）。
- **`RolePreviewSelection`** の公開 API は変えない。
- **バッジ文言は `previewBadgeLabel` ではなく `roleViewLabel` を使う**（デザイン収束ループでの決定）。
  タブ幅 63px に「副管理者ビュー」は収まらないため、`管理者 / 副管理者 / 一般会員` の短い方を採る。
  結果として `previewBadgeLabel` は未使用になるので、実装時に削除する（テストも同時に外す）。
  プレビュー中かどうかの判定は `rolePreview.current !== rolePreview.real` で行う。
- **権限ゲート**: 設定ページの管理者項目は `isAdmin`（`admin` / `vice_admin`）で出し分ける。
  リンク先ページ側の既存 403 ゲートは維持（多層防御）。
- **`/settings/line-link` の移設**は route group の付け替えのみで URL 不変。`actions.ts` も一緒に移動する。
  middleware に `/settings` 固有の分岐は無いため影響なし。
- **`e2e/settings-entry.spec.ts`** は前提（ヘッダーのボタン → dialog）が丸ごと無効になるため、
  「ボトムナビ設定タブ → `/settings` → メール通知」へ書き換える。
- **`docs/design/design.md` §3**（グローバル構造・タブ一覧・「設定は `{name}さん` をタップしてシート」）は
  現行コードの正典として `bottom-nav.tsx` / `app-bar-main.tsx` のコメントから参照されているため、
  本変更に合わせて更新する（スコープ内）。
- ボトムナビは 375px 基準。管理者 6 タブで 1 タブ 62.5px（現行 7 タブ 53.6px より広くなる）。

---

## 8. デザインへの宿題（→ /design-screen nav-settings-hub）

**すべて解決済み**（2026-07-26・[design-spec.md](design-spec.md) `status: locked`）。視覚の正は
[design-prototype.patch](design-prototype.patch)。解決内容の要約:

1. **設定ページのレイアウト** → Card で包まず、区切り線リスト行（左＝ラベル＋1行説明 / 右＝`›`）
2. **設定タブのプレビューバッジ** → ラベル上に 9px の丸ピル。`roleViewLabel` の短い文言を使用
   （管理者 6 タブ・375px で実測 48px / タブ 63px、横スクロールなし）
3. **上部バー消失後の画面上端** → §3.5 のとおり 14 ページの根要素に `p-4` を入れる
4. **`/settings/line-link` のシェル内レイアウト** → 中央寄せカードを解除し通常ページ化、
   「ダッシュボードへ戻る」リンクを削除

---

## 9. 設計判断の根拠

- **上部バーごと削除**: ワードマークとユーザー名を除くと中身が空になるため、空のバーを残す意味がない。
  ユーザー名は `/dashboard` の `ようこそ、◯◯さん` と設定ページで確認できる。
- **設定はシートではなく独立ページ**: 依頼文言が「設定画面への遷移」であり、タブでシートを開くのは
  タブのアクティブ表示ができず不自然。ページなら `/settings` に active 判定も付く。
- **プレビューバッジは設定タブへ**: 上部バー削除でバッジの表示先が消えるが、プレビュー中の自覚が
  無いまま操作するのは事故のもと。切替を行う場所（設定）と一致させるのが分かりやすい。
- **切替後は `/settings` に留まる**: 設定ページで切り替える以上、現在の表示ロールをその場で確認でき、
  連続で切り替えられるほうが自然。現行の「元の画面にクエリ付きで戻る」はシートが全画面から
  開けた前提の設計だった。
- **申込管理・メールはナビ据え置き**: 管理者の日常動線であり、特にメールは未処理バッジを持つ。
- **会員・Bot を設定へ**: 参照頻度が低く、ナビの席を占有する価値が薄い。

## 変更履歴
- 2026-07-26: 新規作成（上部バー廃止・ボトムナビ再編・設定ハブ新設。理由: 上部バーの情報価値が低く、
  設定導線が発見しづらく、管理者ナビが 7 タブで窮屈なため）
- 2026-07-26: デザイン収束ループの結果を反映（design-spec `locked`）。§3.5 ページ余白の統一（14 ページ）と
  AC-16b を追加、バッジ文言を `previewBadgeLabel` → `roleViewLabel` に変更（理由: タブ幅 63px に
  「副管理者ビュー」が収まらない実測）、`MobileShellProps` を `isAdmin` + `previewRoleLabel` の 2 つに縮小
</content>
