---
name: feedback-implement-task-progression
description: /implement でタスクを順に進める際、各タスクの都度承認は不要（連続実装してよい）
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6235ce85-92fc-4f65-b552-9aa8c1a2e905
---

ユーザーは /implement のタスクを順次進める際、各タスクで実装許可を求めないでほしいと明言（2026-06-17, broadcast-lead-message 実装中）。「タスクを先に進める分には許可をもらう必要はないのでどんどん進めて」。

**Why:** 1人開発・身内プロジェクト。define-feature でユーザー承認済みの implementation-plan に沿って刻むだけのタスクを、都度「進めてよいか」と確認されると煩雑。

**How to apply:** 承認済み implementation-plan に沿ってタスクを連続実装してよい。各タスクで「方針提示→GO待ち」を挟まず、実装→テスト→commit→push→完了報告を回す。確認が要るのは、計画にない設計分岐・破壊的変更・想定外の問題が出た時のみ。[[feedback_main_push_authorized_for_ship]] と同種の事前承認。
