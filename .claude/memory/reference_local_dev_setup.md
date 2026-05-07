---
name: ローカル動作確認セットアップ
description: 家・会社両環境でアプリ動作確認を再現するためのエントリーポイント。env 配置・Cookie 注入 vs 実 LINE Login・mail-worker 実 API テスト手順・コスト目安・トラブルシュートまで網羅
type: reference
---

ローカル動作確認の手順は [docs/dev/local-dev-setup.md](../../../docs/dev/local-dev-setup.md) が one-stop reference。

## 中身の要点

- **env ファイルは 3 種類**: `apps/web/.env.local` (Next.js) / `packages/shared/.env` (drizzle-kit) / `<repo root>/.env` (mail-worker、未作成、実 API テスト時に追加)
- **2 種類のログイン**: `pnpm --filter @kagetra/web dev:cookie` で発行した JWT を Cookie 注入する最速ルート、または本物の LINE Login channel を `.env.local` に書いて `/self-identify` 経由で claim
- **mail-worker 実 API テスト**: Anthropic API キー + Yahoo!Mail App Password が必要。Sonnet 4.6 単価で 1000 円 ≒ 360 通（標準ケース）
- **dev only ツールは `apps/web/scripts/dev-issue-cookie.ts`**: admin/member/vice_admin の seed + JWT 発行を idempotent に行う

## 何かを変えた時に追従すべき場所

- env 変数を増やした → 引き継ぎ書 1-2 節の env テンプレートを更新
- Drizzle migration を追加した → 引き継ぎ書 1-3 節は `db:push --force` で吸収するので変更不要
- mail-worker の CLI フラグを増やした → 引き継ぎ書 3-3 節の表を更新
- Sonnet モデル / 単価が変わった → `apps/mail-worker/src/classify/cost.ts` と引き継ぎ書 3-5 節
