---
name: ship-renewal-production-rollout
description: 年度確認の本番反映復旧（PR #638・#641）
type: project
---

PR #631（年度確認）の出荷後、main の CI と本番デプロイが両方赤で、**機能は本番に一度も反映されていなかった**。その復旧と、本番側の残作業の消化。

## 何が起きていたか

1. マージ run 34434065833 の Deploy が `next build` の `Module not found: 'net'/'tls'` で失敗。原因は `MemberRow.tsx` が `findMissingRegisterFields` を `store.ts` から**値**で import しており、'use client' の `RenewalBoard.tsx` 経由でクライアントバンドルに `pg` が混入したこと
2. build は migration・systemd unit 配置・restart より**前**にあるので、以降が全て未実行
3. `auto-deploy.sh` は `git checkout` が build より前にあるため、失敗してもホストの HEAD は進む → **0066 と unit の差分は以降どのデプロイにも現れない**（[[deploy-diff-gate-misses-failed-deploy]]）
4. その後の PR #639（アプリ改名）の Deploy も同じ理由で失敗していた

## 出荷した PR

- **PR #638** https://github.com/poponta2020/kagetra_new/pull/638（merged 730eca2）— クライアント境界の修正（関数を DB 非依存の snapshot.ts へ移設）・`club_line_groups` の ON DELETE RESTRICT による FK 違反で落ちていたテスト 3 ファイルの修正・**CI に Build ステップを追加**（lint/check-types/vitest はクライアント/サーバー境界を見ず、E2E は next dev なので、CI は本番ビルドを一度も通していなかった＝見逃しの穴）・runbook の訂正。Codex R1 pass（132,251 tokens）
- **PR #641** — sudoers から timer の `is-active` 2 行が漏れていたのを追加し、apps/*/systemd の unit と sudoers を機械的に照合するテストを新設。Codex R1 pass（64,451 tokens）
- **match-tracker PR #1553** — `APPS_JSON`（#630 の前半）

## 本番へ実施したこと（2026-09-13・すべて検証済み）

| 作業 | 結果 |
|---|---|
| バックアップ | `kagetra-backup.service` Result=success |
| migration 0066 適用 | applied=1 / skipped=66。適用 67 件・新テーブル 4 本・users 新 2 列・club_chat enum・部分 unique index・users 33 行で健全 |
| sudoers 反映 | `visudo -c` parsed OK・440 root:root・kagetra に renewal 権限・新セッションで sudo 動作確認 |
| `LINE_CHAT_WORKER_TOKEN` 投入 | 64 文字・空白なし・600 kagetra:kagetra |
| PR #638 マージ → デプロイ | **success**（#631 以降で初）。web は 730eca2 で 21:29:40 に restart・HTTP 307 |
| systemd unit 2 組配置 | kagetra の限定 sudo 経路で install → daemon-reload → enable --now → restart。**両 timer active/enabled**（次回 00:05 と 19:30） |
| timer の初回発火 | 両サービスとも成功の no-op（`reminders: skipped (no-open-renewal)` / `apply-school-year: done {checked:0,applied:0}`）＝新コードが本番 DB の新テーブルに対して正常動作することの実地確認 |
| ワーカー API の fail-closed | トークン無し **401** / 不正 **403** / 正しい **200 + 本文 []**（AC-21・22 のとおり） |

## 残り（ユーザー作業）

- `/settings/club-line-group` の設定（Bot 招待 → 発言 → OAM URL → join でグループ ID 捕捉）
- VM の line-chat-worker/.env に `APPS_JSON` を入れて再起動（kagetra 側 serviceToken は本番の `LINE_CHAT_WORKER_TOKEN` と一致させる）
- PR #641 マージ後に sudoers を本番へ再反映
- AC-28（375px 実機）・AC-30/31/32（本番送信・メンション PoC）— **未確認**
- 親 Issue #619 は #630（メンション実装）が残るため OPEN のまま
