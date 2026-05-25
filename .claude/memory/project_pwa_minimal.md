---
name: project-pwa-minimal
description: PWA 最小対応 ship 完了 (PR #49)、本番稼働中、Issue #43 + 子 #44-#48 全 close
metadata:
  node_type: memory
  type: project
  originSessionId: d4a500a2-0f82-4650-9613-03a4a7fbea9f
---

PWA 最小対応 ship + 本番反映 + 実機検証まで全完了 (2026-05-25)。

- 親 Issue: #43 CLOSED
- 子 Issue: #44 #45 #46 #47 #48 全 CLOSED
- PR: #49 (`feat: add minimal PWA support`), merge commit `cb1bf45`
- 本番反映: `new.hokudaicarta.com` で manifest/icons 200 配信、iPhone Safari でホーム画面追加 → standalone 起動 → LINE OAuth 完走を確認 (2026-05-25)
- 実装: SVG ロゴ (中央「か」) + sharp 生成 PNG 4 枚 + manifest.webmanifest + layout.tsx Metadata/Viewport + middleware matcher で PWA 静的ファイル除外
- アイコン再生成: `pnpm --filter @kagetra/web exec tsx scripts/generate-pwa-icons.ts`

**Why:** スマホでホーム画面追加してもアドレスバー付きのブラウザ起動になっていた。最小コストで standalone 起動を実現した。

**How to apply:** 完了済み。次にロゴを差し替えたい場合は `apps/web/public/icons/icon.svg` を編集 → 生成スクリプト再実行 → 生成 PNG をコミット。本番反映時は **public/ → standalone/apps/web/ のコピー必須** (PR #42 までは public 不在で deploy script に未組込)。

**知見:**
- Next.js 15 の Metadata API `appleWebApp.capable: true` は `mobile-web-app-capable` のみ出力するが、iOS Safari でも standalone モードは効いた (`apple-mobile-web-app-capable` 追加不要)
- middleware matcher に静的アセット除外を追加するパターンが今後の PWA 系/公開静的アセット拡張のテンプレ

関連: [[project_production_deploy]] (Phase D 完了済み)、[[feedback_windows_worktree_path]] (worktree 作成時の罠を本タスクで踏んだ)
