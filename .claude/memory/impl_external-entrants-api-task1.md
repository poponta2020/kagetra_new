---
name: impl-external-entrants-api-task1
description: external-entrants-api タスク1
type: project
---

external-entrants-api タスク1（#491）完了。ホーム dashboard/page.tsx の出場者導出（①〜⑤クエリ+確定/希望/ゲスト合流の組み立て）を apps/web/src/lib/upcoming-entrants.ts へ純リファクタで共通化。commit 5054cef。

- 変更: upcoming-entrants.ts（新規）/ upcoming-entrants.test.ts（新規・DB-backed 7件）/ dashboard/page.tsx（呼び出しへ置換）。page.test.tsx は無変更で green（回帰網）
- entrant は name+familyKana/givenKana+entryGrade/userGrade 分離+basis(roster|attendance)。0名イベントも返す（アラート母集団の等価性）
- 未回答アラート用 answeredEventIds は viewer スコープ別クエリ（attend で絞らない）で等価維持
- isEligibleGrade はモジュールと page.tsx で意図的に別持ち（表示関心と導出関心の非結合）
- 委譲: task-implementer（sonnet）1機。受け入れ確認=diff全読+テスト33件/typecheck main 再実行で問題なし。移し漏れ注意3点（guest除外・複数名簿dedupe・先勝ち順序）すべて反映済みだった
- worktree: C:/tmp/impl-external-entrants-api（.env コピー+pnpm install 済み）
