---
name: feature-def-tournament-results-inbox-visibility
description: tournament-results 受信箱可視性 要件定義(2026-09-13)
type: project
---

tournament-results（結果取込）の改修要件定義。正典 = docs/features/tournament-results/requirements.md §3.6・AC-23〜39 / implementation-plan.md（2026-09-13 版）。親 Issue #632 / 子 #633-637。実装未着手。

## 何を変えるか

「結果として取り込む」を押した時点でそのメールを `/admin/mail-inbox` の一覧（未処理・処理済みの両方）から消し、読み取りが終わったら未処理へ復活させて「結果の承認待ち」と明示し、承認画面 `/admin/mail-inbox/result-drafts/[id]` へ直リンクする。parse_failed は「取込に失敗（再試行が必要）」、30 分たっても未終端なら「取込が進んでいません」で復活。

動機: 現行の `triggerResultParse` は triage を一切触らずジョブを積むだけなので、押した痕跡が一覧に出ない。しかも一覧の `draft` リレーションは `tournament_drafts`（大会案内 AI）であって `result_drafts` ではないため、**承認待ちの結果ドラフトは一覧からまったく見えない**（メール詳細に入らないと分からない）。実運用で pending_review 長期放置が起きた原因。

## ユーザー判断（2026-09-13）

- 取込中は**完全に消す**（「取込中」枠は作らない）
- parse_failed も復活させ、失敗だと分かる表示にする
- 却下（rejected）後は未処理のまま（現行維持）
- 横展開しない（manual_extract / roster_parse は無改修＝回帰境界）
- 滞留保険は 30 分で復活＋警告
- 復活は受信日降順のまま（先頭固定しない）
- dismissMail の既存の穴も今回塞ぐ

## ★非自明な設計判断

- **triage_status は書き換えない（表示上の除外にする）**。`triage='processed'` にすると `deriveHistory`（apps/web/src/lib/mail-history.ts:216）が働き、承認前なのに会員向け `/mail` に「対応不要として処理」と表示される（H0「試合結果として取り込み」は `result_drafts.status='approved'` のときだけ出るため）。取込中という一時状態を人手の処理状態に混ぜない。
- **未処理述語は 3 箇所ではなく 5 箇所**（調査で判明）。page.tsx / unprocessed-count/route.ts に加えて `apps/mail-worker/src/notify/web-push.ts:41,127`（notifyNewMailPush・notifyExtractCompleted）と `result-import/run.ts:610` にも同じ badge 算出がある。1 箇所でも漏れるとバッジと一覧が食い違う。
- **置き場所は packages/shared/src/queries/**（新設）。mail-worker から `apps/web/src/lib` を import する前例はゼロ（別パッケージ）なので、`mail-history.result-import.ts` 型の web ローカル葉では 5 箇所を賄えない。shared は senseki-boundary の「残す」側（DB スキーマは共通のまま残すと監査 9 行目に明文化）で、依存の向きにも違反しない。判定は 1 ファイルに閉じ、削除したら空集合 → 現行挙動へ縮退する形にする。
- **相関サブクエリでなく 2 クエリ方式**（in-flight の mail id 群を引く → `notInArray`）。RQB のエイリアス問題を避けつつ shared に drizzle の SQL 断片を持ち込まない。空配列は句ごと落とす（feedback_drizzle_sql_int_array_binding）。
- **30 分の基準は `mail_worker_jobs.requested_at`**。stale-claim recovery は claimed→pending に戻すだけで requested_at を変えないので、クラッシュループでも 30 分で必ず復活する。
- **3 つの表示状態は排他ではない**ので優先順位を要件に明記した: ①in-flight なら非表示（最優先。parse_failed draft の再取込中に「取込失敗」と出さない）②ジョブ要求より後に書かれた draft があればその状態 ③それが無いまま 30 分超なら滞留警告。
- **in-flight 判定の既存前例**: actions.ts:2604-2617 の roster_parse 重複ジョブ検出（`kind` + `status IN (pending,claimed)` + `payload->>'mail_message_id' = text`）。同形を踏襲する。
- extract-only dispatcher は **30 秒間隔**（30 分ではない）。通常はボタンから 1 分前後で完了する。

## AC / タスク

AC-23〜AC-39（auto-test 16・manual 1 = AC-37 本番実機確認）。マイグレーション無し。
Wave 1 = タスク1（shared ヘルパー・#633）/ Wave 2 = タスク2 一覧（#634）・タスク3 badge 全経路（#635）・タスク4 dismissMail ガード（#636）/ Wave 3 = タスク5 docs（#637）。
