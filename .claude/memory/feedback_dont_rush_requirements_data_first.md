---
name: feedback_dont_rush_requirements_data_first
description: 要件定義を急いで閉じない。実データの収集・解析も要件定義の一部。協議しながら進める
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6b951586-8e1f-4fbe-988b-d8e09806a2c7
---

要件定義（/define-feature 等）で結論や実装計画へ急いで進めない。**実データを集めて中身を見てから**データに基づいて設計する。ユーザー明言（2026-06-18, tournament-results 定義時）:「調査も含めて要件定義。すぐ終わらせようとしなくていい。話し合っていきましょう」。

**Why**: ユーザーは品質重視・1人開発で、誤った前提のまま設計が走るのを強く嫌う。実際 tournament-results では「AI 毎ファイル抽出(~$50-150/年)」案がコストで却下され、実 Excel を解析したら標準ツール定型と判明し決定的パース($0)へ設計転換できた。データを見ずに進めていたら誤設計だった。

**How to apply**: AskUserQuestion で選択肢に追い込んで早期 close しない。実ファイル/コード/データを先に調べ、所見を提示して議論し、ユーザーにペースを委ねる。サンプル/データ収集中は実装手順書・Issue 作成へ進まない。コストや「無料原則」に関わる前提は推測でなく実測・実データで確認する。[[project_dev_rules]] [[feedback_implement_task_progression]]
