---
name: auto-review-round-pr611
description: auto-review PR #611
type: project
---

PR #611（line-chat-commands: LINE グループの Bot メンションで申込・支払ステータスを進める）の Codex 自動レビュー記録。

## R1 — initial（全差分1,991行 / 10ファイル）

- model=gpt-5.6-sol / effort=high（判定理由: 構造的高リスクパス（認可 `line-chat-authz.ts`）を含む。initial の sol 較正でも高リスクパス起因の high は下げない）
- verdict=**needs_changes** / blockers=1 / should_fix=0 / nits=0 / good_points=3
- round_tokens=212,408 / cumulative=212,408（上限 500,000）
- escalated=false
- レビュー対象外（既定除外）: `docs/features/line-chat-commands/{implementation-plan,requirements}.md`・`docs/spec/notifications.md`
- Codex 側の注記: `pnpm --filter=@kagetra/web check-types` は成功。対象 Vitest は Codex 実行環境の `spawn EPERM` で起動できず未実行（**こちらの main セッションでは実行済み・green**）

## 唯一の blocker → ユーザー判断で見送り（WONTFIX）

`apps/web/src/lib/line-webhook-handler.ts:1112-1222` — **紐付けの検証結果が状態遷移まで原子的に維持されていない**

`handleChatCommand` は ①broadcast 行を読んで `status='linked'` と発言元 `lineGroupId` 一致を検証 → ②**別トランザクション**で `applyEntriesApplied` / `applyPaymentsPaid` が flip し once-ever 枠を claim、という2段構成。①②の間に `revokeBroadcast`（`events/[id]/actions.ts`）や Bot の leave が入ると、既に紐付けが切れたグループからの発言で状態が進み、通知枠だけ消費されて `no_linked_binding` で `skipped` 確定＝**以降その大会の完了通知が UNIQUE により永久に送れない**。解除直後に `manualLinkGroup` で別グループへ再紐付けされていた場合は通知が別グループへ飛びうる。`expectedEntryGroupId` は申込グループ ID しか見ないので防げない。

Codex の推奨修正は「flip と同じ tx 内で broadcast 行を FOR UPDATE ロックして再検証し、通知にも binding の CAS ガードを置く」。既存の `applyEntriesAppliedInTx` / `applyPaymentsPaidInTx` の seam で実装可能（設計追加は不要・実質30〜50行）。

**見送り理由（ユーザー判断）**: 発言と紐付け解除がミリ秒単位で重なる必要があり、1人運用・会員100名規模では実質観測されない。また「紐付けが切れた状態で flip すると once-ever 枠が恒久消費される」挙動自体は**画面からの操作経路（`setEntriesApplied`）に元から存在する既存挙動**で、この PR が新たに作ったものではない（新規なのは「解除済みグループからの発言でも通れてしまう」部分のみ）。

→ `WONTFIX_LIST` に登録。以降のラウンド・以降の PR レビューでも再掲させない。将来この競合が実害化した場合は上記の InTx seam を使った修正が正典。

## 終了

- PHASE=initial の終了判定 1（見送り後の B=0 / S=0 / N=0）で **R1 即終了**
- 打ち切り記録: `scripts/review/output/codex-result-pr611-r2.json`（`verdict="cutoff"` / `reason="user-wontfix"` / `user_wontfix=1` / `reviewed_head=fixed_head=e52938d`）。**修正コミットは無い**（見送りのみ）ので HEAD は R1 レビュー時と同一
- 総ラウンド数 1 / 10、構成 = initial 1
- 再レビューせずに修正した指摘: 0 件（そもそも修正コミット無し）

## Codex が挙げた good points

- LINE user ID からの認可解決が未紐付け・退会済みを fail-closed で処理している
- 状態更新に旧状態と entry group の条件が併記され、並行した同一操作による二重 flip を防いでいる
- メンション範囲を除去した語判定と、権限別の統合テストが追加されている
