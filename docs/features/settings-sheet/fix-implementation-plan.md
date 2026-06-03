---
status: completed
---
# 設定シート（設定画面への導線）改修実装手順書

## 実装タスク

### タスク1: 設定シート（AccountMenu）コンポーネント新規作成 + ユニットテスト
- [x] 完了
- **概要:** ヘッダの `{name}さん` から開くボトムシート型設定メニューを新規実装する。テストファースト（テスト→実装）。
- **変更対象ファイル:**
  - `apps/web/src/components/layout/account-menu.test.tsx` — 新規。開閉（タップ/背景/×/Escape）、ロール出し分け（admin はメール通知リンクあり／一般会員はなし）、LINE 切替リンク、ログアウト form の存在と href を検証
  - `apps/web/src/components/layout/account-menu.tsx` — 新規。`'use client'`。Props `{ user, isAdmin, signOutAction }`。InviteCodeModal と同じボトムシートパターン（`role="dialog"` / `aria-modal` / `bg-black/40` / `rounded-t-2xl sm:rounded-2xl` / `pb-[env(safe-area-inset-bottom)]`）
- **依存タスク:** なし
- **対応Issue:** #98
- **完了条件:**
  - `{user}` ボタン押下でシートが開く／背景・×・Escape で閉じる
  - `isAdmin=true` でメール通知リンク（`/settings/notifications`）が表示、`false` で非表示
  - LINE アカウント切替リンク（`/settings/line-link`）は常に表示
  - ログアウトが `<form action={signOutAction}>` で描画
  - 新規ユニットテストが green

### タスク2: AppBar / MobileShell への配線 + 既存テスト更新
- [x] 完了
- **概要:** ヘッダの名前テキスト＋ログアウトボタンを AccountMenu に置き換え、`isAdmin` を配線する。
- **変更対象ファイル:**
  - `apps/web/src/components/layout/app-bar-main.tsx` — `AppBarMainProps` に `isAdmin` 追加。右側の `<span>{user}</span>`＋ログアウト `<form>` を削除し `<AccountMenu .../>` を描画
  - `apps/web/src/components/layout/mobile-shell.tsx` — `<AppBarMain>` に `isAdmin` を渡す
  - `apps/web/src/components/layout/mobile-shell.test.tsx` — `AppBarMain` モックに `isAdmin` を追加し、isAdmin 透過の assertion を追加
- **依存タスク:** タスク1
- **対応Issue:** #99
- **完了条件:**
  - 全 `(app)` 画面のヘッダ右が `{name}さん`（タップでシート）のみになる
  - `mobile-shell.test.tsx` を含む既存ユニットテストが green
  - `tsc --noEmit` が通る

### タスク3: /settings/notifications を (app) ルートグループ配下へ移動
- [x] 完了
- **概要:** 設定通知ページをアプリシェル内で表示させる。URL は不変。
- **変更対象ファイル:**
  - `apps/web/src/app/settings/notifications/` → `apps/web/src/app/(app)/settings/notifications/` へ移動（`page.tsx` / `actions.ts` / `actions.test.ts` / `NotificationSettings.tsx`）
- **依存タスク:** なし（タスク1/2 と独立。ただしマージ順は問わない）
- **対応Issue:** #100
- **完了条件:**
  - URL `/settings/notifications` で従来どおり表示され、上バー＋ボトムナビ（シェル）が出る
  - 一般会員アクセス時の /403 リダイレクトが維持される
  - 移動した `actions.test.ts` が green、`tsc --noEmit` が通る

### タスク4: 設定導線の E2E ハッピーパス（軽量）
- [x] 完了
- **概要:** ヘッダから設定へ到達できることを Playwright で end-to-end 確認する。
- **変更対象ファイル:**
  - `apps/web/e2e/settings-entry.spec.ts` — 新規。管理者セッションでダッシュボードを開き、`{name}さん` タップ→シート表示→「メール通知」リンクで `/settings/notifications` へ遷移するまでを検証
- **依存タスク:** タスク1, タスク2
- **対応Issue:** #101
- **完了条件:**
  - E2E がローカル／CI で green
  - （E2E 認証モックの都合で過大になる場合は最小ハッピーパスに縮小可。実機目視は DoD で別途）

## 実装順序
1. タスク3（独立・小。先に入れても後でも可）
2. タスク1（依存なし）
3. タスク2（タスク1に依存）
4. タスク4（タスク1・2 に依存）
