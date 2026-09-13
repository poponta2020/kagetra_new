---
name: impl-tournament-results-inbox-visibility-task1
description: tournament-results 受信箱可視性 タスク1（共有モジュール）
type: project
---

tournament-results 2026-09-13 改修（受信箱で「取込中は消す → 承認待ちで復活」）のタスク1。要件 §6 の「単一定義」「senseki-boundary で削除可能」を満たす共有モジュールを新設した。

**実装**: worktree `C:/tmp/impl-tournament-results` / ブランチ `feature/tournament-results`。
- `packages/shared/src/queries/result-import-visibility.ts`（新規・**削除可能な葉**）: 取込中 / 滞留 / 「対応不要」ガードの判定。結果取込ドメイン（`result_drafts` / `result_parse` ジョブ）の知識はここだけ
- `packages/shared/src/queries/unprocessed-mails.ts`（新規・**配線点**）: `countUnprocessedMails`
- `packages/shared/src/queries/index.ts` / `packages/shared/package.json`（`exports` に `./queries`）
- `apps/web/src/lib/result-import-visibility.test.ts`（29 ケース・実 DB。packages/shared に DB テスト基盤が無いため web 側に置いた）

**★実装手順書からの意図的な逸脱（要件を優先）**: 手順書は4エクスポートを `result-import-visibility.ts` 1ファイルに置く想定だったが、`countUnprocessedMails` を同居させると葉を削除したとき5箇所で素の `count() where ne(triage,'processed')` を書き戻す必要があり、要件 §6 の「削除すると**呼び出し側は空集合を使って**現行挙動へ縮退する」を満たさない。2ファイルに割り、削除は「葉1ファイル削除 + `unprocessed-mails.ts` の import 1行と `hiddenMailIds` 代入1行」で済む形にした（`mail-history.result-import.ts` + `mail-history.queries.ts` の前例と同構造）。エクスポート名・呼び出し側の import パス（`@kagetra/shared/queries`）は手順書どおりで、呼び出し側に差は出ない。

**★設計の勘所**:
- **取込中は「未終端」だけでなく時間窓の上限も必須**。`inArray(status,['pending','claimed'])` だけで隠すと mail-worker 停止時にメールが一覧から消えたまま戻らず、30分ルールの存在意義そのものを潰す。in-flight = `requested_at >= now - 30min`、stalled = `requested_at < now - 30min` で**時間軸上で排他**にした。滞留メールは隠さず件数にも数える
- ジョブはメールごとに**最新の `requested_at` へ畳む**。古い滞留ジョブ + 新しい再取込 → 取込中（優先順位①）が正しく出る（AC-38）
- **「対応不要」を塞ぐ規則は純関数 `resultImportBlocksDismiss` 1本**にし、一覧（表示条件）とサーバーガード（`dismissMail`）の両方がこれを通す。過去に表示条件とガードがドリフトして実害（memory project_ship-hide-inapplicable-progress-buttons）が出たため、Wave 2 の2ワーカーには「呼ぶだけ」と指示した
- サーバーガード版 `loadResultImportDismissBlock` は `FOR UPDATE` を張るので描画から呼べない。ジョブ判定だけを `hasInFlightResultImportJob`（ロック無し）に切り出し、詳細画面はそちらを使う
- `ResultImportDbLike` は **union 必須** — mail-worker の `notify*` は `Db = DbClient | DbTransaction` を受けており、`NodePgDatabase` 単体だと型が落ちる

**環境メモ**: worktree は `origin/main`（169faa3）で切られるが、要件定義コミット e07370e はローカル main のみに存在した。`git reset --hard main` で取り込んでから着手した（未 push の docs コミットがあるときの定番）。
