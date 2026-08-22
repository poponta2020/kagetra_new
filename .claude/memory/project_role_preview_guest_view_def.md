---
name: feature-def-role-preview-guest-view
description: role-preview-switch ゲストビュー解禁 要件定義
type: project
---

表示ロールのプレビュー切替（role-preview-switch）に「ゲスト」を追加する改修。親Issue #514 https://github.com/poponta2020/kagetra_new/issues/514 / 子 #515・#516・#517。正典= docs/features/role-preview-switch/requirements.md（R1 / R7 / S1〜S3 / AC-20〜AC-27）と同 implementation-plan.md。guest-role/requirements.md の R7・AC-24・AC-36 も同時に書き換え（両方に変更履歴セクションを新設）。

## 発端（バグ報告 → 仕様変更へ振り替え）
ユーザーの「管理者はゲストのロール操作にもスイッチできる実装を加えた気がするがUIに導線がない」という報告を調査した結果、**バグではなく guest-role R7 / AC-36 で意図的に禁止していた仕様**と判明。Issue は bug ラベルでは立てず、/define-feature 改修モードへ振り替えた。

## ★禁止根拠が実装の進行で無効化されていた
guest-role 定義時の禁止理由は「ゲストビューに入ると設定画面がゲスト用の表示のみに変わり、切替セクションごと消えて復帰不能」。しかし後続実装で復帰の材料が既に揃っていた:
- 設定タブは `guestVisible: true`（nav-settings-hub 以降）
- `/settings` は**完全一致で**ゲスト許可リスト内（`isGuestAllowedPath`。下位ページ `/settings/*` は許可外）
- 解除操作は許可リスト判定を迂回できる（AC-10b の締め出し防止）
- `returnTo=/settings` は `sanitizeReturnPath` を通る
→ 足りないのは「ゲスト設定画面にセクションを出す」1点だけ。**要件の禁止根拠は、書かれた時点の実装事実に依存している。撤回可否は根拠の再検証から入る**という教訓。

## 主要な設計判断
- **ゲストへの切替は real === 'admin' のときだけ**（ユーザー選択）。`ROLES_HIGH_TO_LOW` に guest を足すとランク比較（guest=0）で副管理者・一般会員にも生えるため、**別立てで末尾に足す**。role-preview の「意図せず広がる形は採らない」方針と整合。
- 同じ admin 限定条件を **3 層**に置く: `selectableRoles` / `auth.config.ts` の jwt コールバック / `resolveEffectiveRole`（改竄 JWT への最後の砦）。
- ゲスト設定画面は**「表示のみ」ビューのまま＋表示ロールセクションだけ追加**。まるごと管理者ビューに戻す案は却下 — 実効ロール guest では `/settings/*` と `/admin/members` が許可リスト外で、リンクを描画しても押した先が 403 になり、「ゲストから設定画面がどう見えるか」という確認目的自体を潰す。先例として**一般会員プレビュー中も本物の一般会員には出ないセクションが既に出ている**（同じ非対称）。
- **middleware も同じ authConfig の session コールバック（resolveEffectiveRole）を通る**ので、`session.user.role` は実効ロール＝ゲストの fail-closed 許可リストがプレビュー中もそのまま効く。AC-24 はこの性質に依存するため、テストで固定する（タスク3）。
- **忠実度の境界**: 切り替わるのは実効ロール依存の挙動だけ。`users.role` を直接読む処理（申込書の対象抽出・参加希望者数・督促・Web Push 宛先・参加者欄のゲスト印）は本物のロールのまま＝プレビュー中の自分にゲスト印は付かない。
- **受容したリスク**: 改竄 JWT で `viewAsRole='guest'` を押し込めるようになる（降格方向のみ・realRole 保持で復帰可・昇格不能は維持）。

## Acceptance Criteria
追加 8 件（AC-20〜AC-27・すべて auto-test）。既存 AC-3 / AC-4 / AC-13 / AC-14 を更新（AC-13/14 は nav-settings-hub 以降の現行 UI への訂正を含む）。**既存テストの反転を伴う破壊的変更（開発ルール5）はユーザー承認済み** — auth-config-callbacks.test.ts の AC-36 系・lib/role-preview.test.ts の guest-role ブロック・settings/page.test.tsx のゲスト分岐。

## タスクと Wave
- Wave 1: #515 タスク1 認可層（role-preview.ts 3関数・next-auth.d.ts の JWT.viewAsRole 型・auth.config.ts の `requested !== 'guest'` 撤去）
- Wave 2: #516 タスク2 設定ページの復帰導線（buildRolePreviewSelection 呼び出しをゲスト分岐より前へ移動＋セクション JSX をローカル抽出して両分岐共用）／#517 タスク3 境界と回帰（middleware.test.ts・bottom-nav/mobile-shell テスト追加のみ、実装変更なし）

migration なし・環境変数の追加なし・本番の再配備手順なし（code push の自動デプロイのみ）。
