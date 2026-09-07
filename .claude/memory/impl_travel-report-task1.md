---
name: impl-travel-report-task1
description: travel-report タスク1（スキーマ・migration 0064）
type: project
---

travel-report（遠征届）タスク1: スキーマ・migration 0064・共有定数・型（main 直・Wave 1）。

worktree: C:/tmp/impl-travel-report（branch feature/travel-report）

**変更ファイル**: packages/shared/src/schema/{auth.ts, enums.ts, index.ts, entry-group-travel-settings.ts, entry-group-selection-statuses.ts, travel-routes.ts, travel-unit-notices.ts, travel-reports.ts}, src/types/index.ts, src/constants/{index.ts, travel-report.ts}, drizzle/0064_amazing_purple_man.sql, __tests__/travel-report-schema.test.ts, docs/design/{db.md, db-tables-auth-line.md, db-tables-events.md}

**検証済み**: shared 11ファイル75テスト green・tsc --noEmit green・テスト DB への push 成功（0064 適用）

**発見した問題・注意点**:
- ★requirements AC-4 の括弧書き「大学院21」は**数え違い**。R1 の列挙は22件（公共政策学教育部まで）。列挙を正として GRADUATE_SCHOOLS は22件で実装し、テストにその旨を書いた
- ★原本 .dotx（docs/遠征届資料/）は**メインリポジトリに untracked でしか存在しない**。worktree からは絶対パスで参照する。commit してはいけない（AC-29）
- 学年は pgEnum にせず text＋共有定数で検証（届にそのまま出力する仕様のため）。名簿の並びは SCHOOL_YEAR_ORDER
- is_circle_leader の partial unique index は drizzle の uniqueIndex().where(sql) で生成できた

**追加でやったこと（タスク4の前倒し）**: クリーン版テンプレ（template.b64.ts）と scripts/travel-report/build-template.mjs を main が作成。原本の PII（団体代表者 氏名/電話/所属・顧問教員3欄・docProps 作成者名）を run 単位で同幅の全角スペースへ置換し、全 zip エントリ走査で 0 件を独立検証済み。顧問教員の初期値は**空**にした（原本の氏名をコードに埋め込まない判断。requirements S4「初期値は原本の値」からの意図的な逸脱でユーザー報告済み）
