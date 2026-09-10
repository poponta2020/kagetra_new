---
name: impl-annual-registration-renewal-task1
description: 年度確認 タスク1（スキーマ・migration 0066）
type: project
---

annual-registration-renewal タスク1（スキーマ・migration 0066・共有型/定数）を main 直実装で完了。worktree=C:/tmp/impl-annual-registration-renewal（ブランチ feature/annual-registration-renewal）。

変更: packages/shared/src/schema/{enums,auth,club-line-groups,membership-renewals,membership-renewal-members,line-chat-tasks,index,relations}.ts / src/types/index.ts / src/constants/{index,membership-renewal}.ts / drizzle/0066_minor_black_bolt.sql / __tests__/membership-renewal-schema.test.ts / docs/design/{db.md,db-tables-auth-line.md}。shared テスト 102 件 green・check-types 通過。

★計画からの修正（実装手順書にも反映済み）: packages/shared は zod に依存していない（travel_routes.legs と同じで検証は Server Action 境界の責務）。RenewalSnapshot の zod は タスク2 の apps/web/src/lib/membership-renewal/snapshot.ts へ移した。部分 UNIQUE の DB 実挙動テストも packages/shared の vitest が DB を持たないため タスク4 のタスク store テストへ移した。

★確認した事実: (1) テスト DB は drizzle-kit push --force で作られるため **migration SQL 自体はローカル/CI のどのテストでも実行されない**（検証はファイルの目視と文字列アサーションのみ）。(2) 0066 では club_chat が ADD VALUE の 1 行にしか現れない（PG は同一 tx で新しい enum 値を使えない）。同じ enum への ADD VALUE は 0044（grade_broadcast）で本番実績あり。(3) deleteMember の参照チェックに membership_renewal_members は足さない（user_id CASCADE は誤登録リカバリを塞がないための意図的な設計）。

Wave 2 = タスク2・3・4 を task-implementer 3 並行で起動（worker_verify: none のためテストは書くだけ）。
