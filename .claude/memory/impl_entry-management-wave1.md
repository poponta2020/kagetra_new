---
name: impl-entry-management-wave1
description: entry-management Wave 1（タスク1・2）
type: project
---

entry-management（申込管理ボード）の Wave 1（タスク1 #323 / タスク2 #324）を実装。worktree: C:/tmp/impl-entry-management（ブランチ feature/entry-management）。

## Wave 構成と委譲
- Wave 1 = タスク1 + タスク2 を task-implementer（sonnet）2 体へ並行委譲。変更領域は完全に直交（admin/entries 純関数 / components/layout）で衝突なし。
- タスク3・4 は main 直（タスク3は既存テストの意図保存が肝、タスク4は認可+複数テーブルクエリ+UI）。
- **ワーカーには検証コマンドを渡さなかった**: apps/web の vitest global-setup が毎回 drizzle-kit push --force を共有テスト DB(5434) へ走らせるため、複数ワーカーが同時に vitest を起動すると衝突する（fileParallelism:false はプロセス内の話で、プロセス間は守らない）。ファイルスコープの eslint だけ許可し、テスト実行と typecheck は barrier 後に main が直列実行した。

## 実装内容
- タスク1: 確定プロトタイプから entry-board-utils.ts を取り込み、テスト 63 件で要件 §3.2 の分岐を固定。commit 89f6563
- タスク2: bottom-nav.tsx に 7 個目の管理者専用タブ、テスト 21 件へ更新。commit 6381ed3

## main の受け入れ確認で見つけた 2 件（ワーカーは検出できなかった）
1. **GroupedBoard の型が実体と食い違っていた**: Record<AreaId, _> だが groupBoard は AREAS（=no_applicants を含まない）のキーしか作らない。board.no_applicants が型上は EntryBoardItem[] なのに実行時 undefined。VisibleAreaId = Exclude<AreaId,'no_applicants'> を導入して型を狭め、isHiddenArea 型述語で narrowing した。
2. noUncheckedIndexedAccess により items[0] が EntryBoardItem|undefined。テストは非 null アサーションのローカル変数へ退避。

## 適用手順の要点
design-prototype.patch は **--include でファイル単位に分けて適用**した（認証バイパスを含む middleware.ts / (app)/layout.tsx と、削除予定の proto-data.ts に一切触れない）。この方式なら git grep DESIGN-PROTO が最初のコミットから 0 件になる。
