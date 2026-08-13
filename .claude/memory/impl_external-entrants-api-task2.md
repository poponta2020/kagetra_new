---
name: impl-external-entrants-api-task2
description: external-entrants-api タスク2
type: project
---

external-entrants-api タスク2（#492）完了。GET /api/external/tournament-entrants を main 直で実装（認証新設のため委譲せず）。commit 21a6009。

- external-api-key.ts: verifyExternalApiKey（verifyLineSignature と同形。env 未設定/空文字は比較前に false=fail-closed・Bearer 固定・timingSafeEqual・process.env は呼び出し時読み）
- route.ts: runtime=nodejs + force-dynamic（GET のみ route は静的最適化でビルド時 DB 接続する罠）+ Cache-Control: no-store。getUpcomingEntrants({since: 当月1日JST}) を人単位へ束ね、persons=name ja昇順・entries=eventDate昇順。grade は userGrade（entryGrade と混ぜない）。confidence は basis 写像（roster→confirmed/attendance→hoped）。generatedAt は sv-SE +09:00 固定
- テスト: external-api-key.test.ts 5件（vi.stubEnv・空文字罠含む）/ route.test.ts 9件（AC-1〜AC-10。PII 非含有は値の非出現+キー集合の両面）全green・typecheck/eslint 通過
