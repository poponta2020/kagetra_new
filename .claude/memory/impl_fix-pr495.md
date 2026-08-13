---
name: fix-pr495
description: fix PR #495
type: project
---

PR #495（feature/external-entrants-api）の Codex R1 指摘修正。

対応した指摘:
- [CRITICAL] route.test.ts の JST 月末境界 flaky（AC-6）: monthStart 等がモジュール評価時固定・ルートは リクエスト時計算のため月またぎで食い違う → vi.useFakeTimers({toFake:['Date']}) + setSystemTime('2026-08-13T12:00:00+09:00') をモジュール評価タイミングで適用し afterAll で useRealTimers。commit ed21be5

トリアージ判断: 特定タイミング（月末深夜）のみ発生だが、テスト専用・修正一意・本番挙動不変・時刻境界flaky根治はプロジェクトの一貫方針（--no-file-parallelism 採用等）のため即修正扱い（ユーザー確認省略の理由として記録）。

テスト: route.test.ts 9件 green・eslint 通過。WONTFIX なし
