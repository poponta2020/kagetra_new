---
status: completed
---
# 大会ライフサイクル基盤（edition）＋申込・確定名簿 実装手順書

今回の変更: メール大会承認画面の系列検索・明示選択UX。
要件定義書: `docs/features/tournament-entry-rosters/requirements.md`

## 実装タスク

### タスク1: 系列検索ロジックとID選択契約を整備する
- [x] 完了
- **目的:** 正準名・別名の検索ロジックをクライアントから安全に再利用できる形へ分離し、既存系列の紐づけを自由入力文字列ではなく系列IDで確定する。
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9
- **主な変更領域:**
  - `apps/web/src/lib/edition/` — DB非依存の正規化・候補絞り込み・一致別名判定、初期候補と全系列選択肢を1回の読み取りから返すローダー、選択IDの存在・種別検証
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `approveDraftUnits` の既存系列ID経路と、明示確認された新規系列名経路の分離
  - 上記の `*.test.ts` と `actions.test.ts`
- **依存タスク:** なし
- **必要なテスト:** 正規化部分一致、別名一致表示、完全一致1件／複数／なし、種別フィルタ、存在しない・改ざんID拒否、文字入力だけでは未確定、新規作成明示、回次不正、link OFF、複数／部分承認の同一edition収束、結果取込回帰
- **完了条件:** 既存系列はIDでのみ解決され、新規系列は名称＋明示確認でのみ作成される。対象ロジック・Server Actionテストがgreenで、DBスキーマ差分がない
- **対応Issue:** #290

### タスク2: 承認フォームへ系列検索・選択UIを組み込む
- [x] 完了
- **目的:** 375px幅でAI候補から既存系列を検索・比較・選択でき、未選択／該当なし／新規作成／回次修正の状態が明確な承認操作に置き換える。
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-10, AC-11
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/mail-inbox/components/` — 既存の `ExistingEventLinkSheet` と共通する portal・`.modal-overlay-h`・`min-h-0` スクロールパターンを踏襲した系列検索シート、`ApprovalForm` の選択状態とhidden field
  - `apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx` — 承認可能時だけ全系列と初期候補を読み込み、フォームへ渡す
  - 対応するコンポーネント／ページテスト、必要に応じて `apps/web/e2e/admin-mail-inbox-approval.spec.ts`
  - `docs/spec/mail-worker.md` — ドラフト承認詳細の系列検索・ID選択仕様へ更新
- **依存タスク:** タスク1
- **必要なテスト:** 完全一致初期選択、未一致は検索語のみ、正準名／別名検索、系列選択・解除、種別不一致非表示、0件、新規系列明示、回次入力、フォーム送信値、再オープン時状態、375px実動作確認
- **完了条件:** UIテストgreen、`pnpm --filter=@kagetra/web test`・`pnpm lint`・`pnpm check-types`成功、375pxでAC-10を実動作確認、正典仕様が更新済み
- **対応Issue:** #291

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1
- Wave 2: タスク2（タスク1の検索型・ID選択契約に依存し、`apps/web`内の近接領域も触るため直列）

## 移行・互換性

- DBスキーマ・既存系列／開催データの移行は不要。
- `approveDraftUnits` の新しい承認フォームは系列IDを送る。旧自由入力形式を既存系列の暗黙選択としては受け付けず、新規系列作成の明示経路だけ名称入力を使う。
- 結果取込の `autoResolveEdition`、手動イベント作成／編集の `resolveEditionFromForm`、既存editionの一意性・並行制御は変更しない。
