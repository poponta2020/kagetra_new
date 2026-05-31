---
name: feedback-nextjs-standalone-static-cp
description: Next.js standalone リビルド時に .next/static と public を standalone 配下にコピーし忘れると CSS/JS 全部 404 で画面真っ白
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bdf544e9-cf0c-4681-90d4-e0b0d2b2c4aa
---

# Next.js standalone のリビルド時は static cp 忘れない

`pnpm --filter @kagetra/web build` の直後、systemd restart する前に **必ず以下 2 行を実行**:

```bash
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public
```

**Why:** Next.js standalone モードは public/ と .next/static/ を standalone/ 配下にコピーしない仕様。standalone server.js は `apps/web/.next/standalone/apps/web/.next/static/` 配下を探すので、ここに無いと CSS/JS/フォント/manifest 全部 404 になり画面真っ白。

**How to apply:** apps/web の本番リビルド手順をスクリプト化するか、systemd unit に ExecStartPre で組み込む。手動でやる場合は build + cp + restart の 3 点セットとして必ず一緒に実行する。docs/deploy/web.md §4 に明記済みだが、修正リリース時に忘れやすい (2026-05-31 セッション3 でやらかした)。

## 関連
- [[project-event-line-broadcast-deploy]] — 2026-05-31 本番デプロイ実施
