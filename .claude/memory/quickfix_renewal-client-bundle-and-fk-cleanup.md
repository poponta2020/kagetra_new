---
name: quickfix-renewal-client-bundle-and-fk-cleanup
description: quickfix: renewal-client-bundle-and-fk-cleanup
type: project
---

## 修正したバグ

PR #631（annual-registration-renewal）を出荷した直後、main の CI（テスト）と本番デプロイが**両方赤**になっていた。症状は2つ。

1. **本番デプロイが build で失敗し、年度確認機能が本番へ一度も反映されなかった**
   run 34434065833 の Deploy to production が `Module not found: Can't resolve 'net'/'tls'` で失敗。import trace は `pg → db.ts → membership-renewal/store.ts → MemberRow.tsx → RenewalBoard.tsx`。
2. **open-chat-actions.test.ts の 35 テストが `Failed query: delete from "line_channels"` で全滅**

## 根本原因

1. `MemberRow.tsx` が `findMissingRegisterFields` を `store.ts` から**値**で import していた。`MemberRow` 自身は 'use client' ではないが `'use client'` の `RenewalBoard.tsx` から import されるためクライアントバンドルに入り、`store.ts → db.ts → pg` が丸ごと巻き込まれた。**lint / check-types / vitest はどれもクライアント・サーバー境界を見ず、E2E は `next dev` を使うため、CI は本番ビルドを一度も通していなかった**。
2. `club_line_groups.line_channel_id` が `ON DELETE RESTRICT`。`line_channels` を手動 delete するテストが、先行テストファイルの残した `club_line_groups` 行に引っかかった。テスト DB を共有するため実行順が変わったときだけ露出する（`line-webhook-handler.test.ts` だけは既に対応済みだった）。

## 変更ファイル一覧

- `apps/web/src/lib/membership-renewal/snapshot.ts` — `REGISTER_REQUIRED_FIELDS` と `findMissingRegisterFields` を受け入れ（DB 非依存）
- `apps/web/src/lib/membership-renewal/store.ts` — 上記を削除し `./snapshot` から import
- `apps/web/src/app/(app)/admin/members/renewal/MemberRow.tsx` — import 元を `store` → `snapshot` へ
- `apps/web/src/lib/membership-renewal/store.test.ts` / `snapshot.test.ts` — 該当 describe を DB 依存側から純粋側へ移動
- `apps/web/src/app/(app)/admin/mail-inbox/open-chat-actions.test.ts` / `src/lib/line-broadcast-guidelines.test.ts` / `src/lib/line-broadcast.test.ts` — `delete(lineChannels)` の直前へ `delete(clubLineGroups)` を追加（赤かった1ファイルだけでなく同型3ファイルすべて）
- `.github/workflows/ci.yml` — Typecheck の後・Vitest の前に **Build** ステップを追加（1 を見逃した穴を塞ぐ）

## PR・コミット

- PR #638 https://github.com/poponta2020/kagetra_new/pull/638
- コミット 1c7c25d
- Codex R1 verdict=pass（blockers 0 / should_fix 0 / nits 0・effort=medium・132,251 tokens）
- ローカル検証: check-types 通過・lint 通過・build は Compiled successfully / Module not found 0 件 / 静的ページ 15/15・vitest は共有 DB 1本の直列実行で 23 ファイル 356 テスト全 green

## ★マージ前に必須の本番作業

本 PR は**マージ前に本番 DB へ migration 0066 を適用しないと本番が壊れる**。理由は [[deploy-diff-gate-misses-failed-deploy]] を参照。
