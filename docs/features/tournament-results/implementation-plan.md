---
status: completed
---
# tournament-results 実装手順書（2026-09-13 改修: 受信箱で「取込中は消す → 承認待ちで復活」）

> 対象要件 = [requirements.md](requirements.md) §3.6 / AC-23〜AC-39。
> 2026-08-22 改修（AI 取込補助 + 突合・部分承認・差し替え）までのタスクは完了済み・git 履歴参照。
> 現行仕様の正典 = docs/spec/tournaments-results.md。

## 設計メモ（タスク共通の確定事項）

- **マイグレーションは行わない**。判定は既存 `mail_worker_jobs`（`kind='result_parse'` / `status` / `requested_at` / `payload->>'mail_message_id'`）と `result_drafts`（`status` / `updated_at`）から導出する。新規列・新規 enum 値を追加しない（要件 §6）。
- **置き場所は `packages/shared/src/queries/result-import-visibility.ts`（新設）**。呼び出し元 5 箇所が `apps/web` と `apps/mail-worker` の両パッケージに跨っており、mail-worker から `apps/web/src/lib` を import する前例はゼロ（調査済み）。`packages/shared` は senseki-boundary の「残す」側（`docs/audits/senseki-boundary-audit.md:9` で DB スキーマは共通のまま残すと明文化）なので、依存の向きに違反しない。
- **senseki-boundary の作法**: 判定をこのファイル1本に閉じる。配布版で結果取込ドメインを落とすときは、**このファイルを消して呼び出し側の「除外 ID 集合」を空配列・カウントを素の `triage != 'processed'` に戻すだけ**で現行挙動へ縮退する形にする（`apps/web/src/lib/mail-history.result-import.ts` と同じ「削除可能な葉 + 配線1行」パターン）。「残す」側から `apps/mail-worker/src/result-import/` へ import を張らない（監査 AC-8）。
- **in-flight ジョブの引き当ては既存前例を踏襲**: `apps/web/src/app/(app)/admin/mail-inbox/actions.ts:2604-2617`（`roster_parse` の重複ジョブ検出）と同形で、`eq(kind, 'result_parse')` + `inArray(status, ['pending','claimed'])` + `` sql`${mailWorkerJobs.payload}->>'mail_message_id' = ${String(mailId)}` ``。本改修は逆引き（ID 集合の取得）なので `payload->>'mail_message_id'` を select して数値化する。`payload` は常に JSON number で書かれている（`parseResultParsePayload` が number 以外を throw する契約）。
- **述語は2クエリ方式**（相関サブクエリを Relational Query Builder に埋め込まない）: ① 除外対象の mail id 群を引く → ② 既存クエリに `notInArray(mailMessages.id, ids)` を足す。**空配列のときは句ごと落とす**（drizzle の `inArray`/`notInArray` は空配列で壊れる。memory `feedback_drizzle_sql_int_array_binding`）。
- **30 分の基準時刻は `mail_worker_jobs.requested_at`**。stale-claim recovery は `claimed → pending` へ戻すだけで `requested_at` を変えないため、クラッシュループしているジョブでも 30 分で必ず復活する。
- **表示の優先順位**（要件 §3.6。実装の if 連鎖の順序をこれに合わせる）: ① in-flight なら一覧に出さない（最優先） ② ジョブ要求より後に書かれた draft があればその状態（承認待ち / 取込失敗）を表示 ③ それが無いまま 30 分超なら滞留警告。

## 実装タスク

### タスク1: 未処理可視性の共有モジュールを packages/shared に新設
- [x] 完了
- **目的:** 「取込中のメールを未処理から除外する」判定を単一定義にし、web / mail-worker の 5 箇所が同じ述語を使えるようにする（要件 §6 の単一定義制約）。
- **対応AC:** AC-23, AC-24, AC-27, AC-31, AC-38, AC-39（下流タスクの土台）
- **主な変更領域:**
  - `packages/shared/src/queries/result-import-visibility.ts`（新規。エクスポートは `RESULT_IMPORT_INFLIGHT_WINDOW_MS` / `loadInFlightResultImportMailIds` / `loadStalledResultImportMailIds` / `countUnprocessedMails`）
  - `packages/shared/src/queries/index.ts`（新規・再エクスポート）
  - `packages/shared/package.json`（`exports` に `"./queries"` を追加）
  - DB 引数の型は `apps/web/src/lib/mail-history.queries.ts` の `DbLike`（`NodePgDatabase<typeof schema>`）パターンを踏襲し、web / worker のどちらの db インスタンスも受けられるようにする
  - 時刻とウィンドウはオプション引数（`{ now?: Date; windowMs?: number }`）で注入可能にする（テストで境界を固定するため。既定は `new Date()` と 30 分）
- **依存タスク:** なし
- **必要なテスト:**
  - `loadInFlightResultImportMailIds`: `pending`/`claimed` を拾う・`done`/`failed` は拾わない・`kind` 違い（`manual_extract`/`roster_parse`）は拾わない・`requested_at` が窓外なら拾わない・同一メールに複数ジョブがあっても重複しない・該当ゼロで `[]` を返す
  - `loadStalledResultImportMailIds`: 窓を超えた未終端ジョブを拾う・**ジョブ要求より後に `result_drafts` が更新されていれば拾わない**（AC-39）・draft が無ければ拾う
  - `countUnprocessedMails`: `triage != 'processed'` から in-flight を除外した件数を返す・in-flight ゼロなら現行と同値（回帰）
  - 空配列ケースがクエリを壊さないことを**テストで固定する**（規約でなくテストで担保）
  - `packages/shared` に実 DB を使うテストの前例が無い場合は、テストのみ `apps/web` 側の実 DB テスト基盤（`@/test-utils/db` + `@/test-utils/seed`）に置いてよい。**モジュール本体は必ず `packages/shared` に置く**
- **完了条件:** 上記テストが green・`pnpm check-types` 通過・`packages/shared` の新 exports が web / worker の両方から型解決できる
- **対応Issue:** #633

### タスク2: 受信箱一覧の除外と復活表示
- [x] 完了
- **目的:** 取込中のメールを一覧から消し、読み取り完了・失敗・滞留で未処理へ復活させて状態を明示する。
- **対応AC:** AC-23, AC-25, AC-26, AC-27, AC-28, AC-29（一覧側の抑制）, AC-38, AC-39
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/mail-inbox/page.tsx`
    - タスク1 のヘルパーで hidden / stalled の ID 集合を取得し、`activeRows`・`processedRows` の両方から hidden を除外（要件: 未処理にも処理済みにも出さない）
    - `LIST_WITH` に `resultDraft`（`columns: { id, status }`）を追加。relation は `packages/shared/src/schema/relations.ts:216` に `mailMessages.resultDraft`（one-to-one）として宣言済み（確認済み）
    - カードの表示を優先順位どおりに分岐: `pending_review` → 「結果の承認待ち」ピル + `/admin/mail-inbox/result-drafts/[id]` への直リンク（既存 `DraftCard` と同じ見た目の導線）／`parse_failed` → 「結果の取込に失敗（再試行が必要）」ピル + メール詳細へ／stalled → 「取込が進んでいません」警告ピル + メール詳細へ
    - 「対応不要」（`TriageActions`）の表示条件に結果ドラフト状態を追加（`pending_review` / `parse_failed` では出さない）
    - 並び順は受信日降順のまま（先頭固定にしない = AC-28）
  - `apps/web/src/app/(app)/admin/mail-inbox/components/`（ピル表示を切り出す場合のみ。既存 `Pill` / `DraftCard` のパターンを再利用し、新しい色・トークンを発明しない）
  - `apps/web/src/app/(app)/admin/mail-inbox/page.test.tsx`
- **依存タスク:** タスク1
- **必要なテスト:** 実 DB シード（`createMailMessage` + `mail_worker_jobs` + `result_drafts`）で、①in-flight のメールが未処理・処理済みのどちらにも出ない ②`pending_review` で復活し承認画面リンクが出る ③`parse_failed` で復活し失敗表示が出る ④30 分超の滞留で警告が出る ⑤`parse_failed` draft がある状態で再取込ジョブが in-flight なら非表示（AC-38）⑥ジョブ要求後に draft が更新されていれば滞留警告でなく draft 状態を出す（AC-39）⑦承認待ち・取込失敗のカードに「対応不要」が出ない
- **完了条件:** 上記テスト green・既存 `page.test.tsx` が無改修で green（回帰）
- **対応Issue:** #634

### タスク3: 未処理件数を数える全経路の統一
- [x] 完了
- **目的:** 一覧の件数とバッジ件数を常に一致させる（述語が散らばったままだとバッジだけ取込中を数えてズレる）。
- **対応AC:** AC-24, AC-31
- **主な変更領域:**
  - `apps/web/src/app/api/admin/mail/unprocessed-count/route.ts:29`
  - `apps/mail-worker/src/notify/web-push.ts:41`（`notifyNewMailPush`）, `:127`（`notifyExtractCompleted`）
  - `apps/mail-worker/src/result-import/run.ts:610`（`notifyResultParseCompleted`）
  - いずれもタスク1 の `countUnprocessedMails` 呼び出しへ置き換える（`ne(mailMessages.triageStatus, 'processed')` の直書きを残さない）
  - `apps/web/src/app/api/admin/mail/unprocessed-count/route.test.ts` と、mail-worker 側に badge のテストがあれば同様に更新
- **依存タスク:** タスク1
- **必要なテスト:** 取込中 1 通 + 未処理 2 通のとき count API が 2 を返す・in-flight ゼロなら現行と同値（回帰）・worker の badge 算出が同じ数を返す
- **完了条件:** 上記テスト green・`ne(mailMessages.triageStatus, 'processed')` の直書きが本改修の対象 5 箇所から消えている（`apps/web/src/lib/events/confirmed-roster.ts` の `eq(...,'processed')` は別目的なので触らない）
- **対応Issue:** #635

### タスク4: 「対応不要」ガードを結果ドラフトへ拡張
- [x] 完了
- **目的:** 承認待ち・取込失敗・取込中の結果ドラフトを持つメールが「対応不要」で処理済みにされ、承認待ちが宙に浮くのを防ぐ（現行は `tournament_drafts` しか見ていない既存の穴）。
- **対応AC:** AC-29, AC-30
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` の `dismissMail`（`:1311`）: 既存の `tournament_drafts` ガードに続けて、`result_drafts` が `pending_review` / `parse_failed` のとき、および in-flight な `result_parse` ジョブがあるときに日本語エラーで拒否する（既存ガードと同じ `FOR UPDATE` + トランザクション内で判定）
  - `apps/web/src/app/(app)/admin/mail-inbox/mail/[id]/page.tsx`: 詳細画面に「対応不要」導線が出ている場合は同じ条件で抑制する（`MailProcessForm` 側にある場合はそちらを確認して抑制する。導線が無ければ変更不要と記録して終える）
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts`
- **依存タスク:** タスク1
- **必要なテスト:** `pending_review` / `parse_failed` / in-flight の各ケースで `dismissMail` が拒否される・結果ドラフトが無いメールや `approved` / `rejected` のメールでは従来どおり処理済みにできる（回帰）
- **完了条件:** 上記テスト green・既存 `dismissMail` の `tournament_drafts` ガードの挙動が不変
- **対応Issue:** #636

### タスク5: 仕様書への反映と回帰確認
- [ ] 完了
- **目的:** 現行仕様の正典（docs/spec）を更新し、関連機能の requirements から相互参照できるようにする。
- **対応AC:** AC-30, AC-32, AC-33, AC-34, AC-35, AC-36
- **主な変更領域:**
  - `docs/spec/tournaments-results.md`: 取込トリガ後の受信箱可視性（取込中は非表示・復活条件・優先順位・30 分の根拠）を追記
  - `docs/spec/mail-worker.md`: badge 算出が共有ヘルパー経由になったことを追記
  - `docs/features/mail-inbox-mailer/requirements.md`: 受信箱一覧の未処理判定に結果取込由来の除外が重なる旨を **1 行だけ**相互参照として追記（仕様本体は tournament-results 側に置き、二重化しない）
  - `docs/features/INDEX.md`: `tournament-results` 行に今回の改修を追記
- **依存タスク:** タスク2, タスク3, タスク4
- **必要なテスト:** （ドキュメントのみ。回帰は CI の既存スイートで確認）
- **完了条件:** 会員向け `/mail` の履歴テスト（`mail-history*.test.ts`）が無改修で green・大会案内 AI 抽出／名簿取込の既存テストが無改修で green・lint / check-types 通過
- **対応Issue:** #637

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1**（単独。5 つの呼び出し元が依存する共有ホットスポットで、`packages/shared/` 変更は profile の `DEVFLOW_TEST_CMDS` により全パッケージのテストスコープを起動する）
- **Wave 2: タスク2, タスク3, タスク4**（変更領域が重ならない: タスク2=`page.tsx` / タスク3=`unprocessed-count/route.ts` + mail-worker 2 ファイル / タスク4=`actions.ts` + `mail/[id]/page.tsx`）
- **Wave 3: タスク5**（docs のみ。Wave 2 の結果を反映する）

## 出荷後に残る手作業

- AC-37（manual）: 本番で実メール 1 通を「取込 → 一覧から消える → 完了後に承認待ちで復活 → 承認」まで実機確認する。出荷直後に実施し、結果を worklog へ記録する。
