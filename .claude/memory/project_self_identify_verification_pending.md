---
name: /self-identify 本人性検証は実装しない（リスク受容）
description: PR #5 で導入した /self-identify 自己申告フローに本人性検証は入れない。身内アプリでリスク受容するとユーザーが 2026-04-22 に判断。
type: project
originSessionId: b09f3526-58d2-4875-a1a0-7c646f986b97
---
PR #5（`76d40f1` / 2026-04-22 merged）で LINE Login + `/self-identify` 自己申告フローを導入した際、Codex Round-3 レビューで「招待された任意の LINE user が任意の会員を claim できる」という Blocker 指摘があった。

2026-04-22 にユーザーが「身内のアプリなので悪用する人はいない」と判断し、**本人性検証は実装しない方針で確定**。以前は「公開運用前に必ず塞ぐ Follow-up」として扱っていたが撤回。

**Why:**
- 会員100名超の競技かるた会内で閉じた運用。招待制 + LINE Login の二段ロックは既にかかっている。
- 悪意ある利用者が実質的にいない前提で、PIN 配布や管理者承認フローの運用コストを払う価値がない。
- 氏名のみ表示（級/所属は非表示）の緩和策は PR #5 で既に入っている。

**How to apply:**
- `/self-identify` 周辺（`apps/web/src/app/self-identify/`, `apps/web/src/auth.ts` の `signIn` callback）を触る依頼が来ても、本人性検証の追加提案は不要。
- ただし**運用方針が変わって外部公開・身内以外の招待を許す場合は再検討**。そのときは過去に整理した 3 案を参照:
  1. ワンタイムトークン / PIN — 最堅牢
  2. 管理者承認フロー — pending 状態経由
  3. 本人のみ知る属性 — 非推奨（名簿漏洩で無力）
- 関連ファイル（参考）:
  - `apps/web/src/app/self-identify/page.tsx`
  - `apps/web/src/app/self-identify/actions.ts` — `claimMemberIdentity`
  - `apps/web/src/app/self-identify/candidate-list.tsx` — 氏名のみ表示（columns: { id, name }）
