---
name: feedback_ship_dod_residual_check
description: PR ship 後の「残 DoD」は本番未反映で実害化しやすい。systemd / sudoers / env / migration timer / VAPID key 等は ship 直後に消化する
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 93940235-2bd6-4372-9fd7-76fa925a7682
---

PR ship 直後に「残 DoD: 本番反映後の実機目視」「systemd timer + ANTHROPIC_API_KEY 設定」「VAPID 鍵設定+実機バッジ目視」のような **本番側の手作業** を worklog に書いて未消化のまま放置すると、後で機能が動かない事故になる。

**Why:**
[[impl_event_line_broadcast_task1]] / [[project_pwa_minimal]] / [[impl_mail_body_as_image]] / [[project_mail_triage_badge]] / [[project_event_lifecycle_notify]] では全て worklog に「残 DoD」が書かれた。多くは後で本人がすぐ実機チェックして問題なかったが、**PR #127 (mail-inbox-mailer) では DoD「systemd extract timer + ANTHROPIC_API_KEY 設定」が未消化のまま 4 日経過 → ユーザーが「多摩大会の AI 抽出が完了しない」報告 → Issue #131 / PR #132 で対応**（auto-deploy.sh に unit 配置ロジック追加 + sudoers 拡張）。

**How to apply:**
1. `/ship` 完了時の worklog に「残 DoD」を書くなら、その消化手順 (本番 SSH コマンド / 確認画面 / 期待される状態) も同じ section に併記する
2. **残 DoD に「本番への手作業」(systemd, sudoers, env, key 設定) が含まれる場合は ship 完了後に必ずユーザーに口頭確認**（自動化できそうなら別 Issue 化）
3. CI/CD で吸収できる種類の DoD (unit 配置・migration 適用) は auto-deploy.sh に取り込めないか検討（PR #132 で systemd unit 自動配置を追加した経緯）
4. 実機目視系 DoD は次セッション開始時の memory プライム時に worklog から読み取って「前回の残 DoD 確認しますか?」と提案する

関連: [[project_auto_deploy]], [[impl_mail_body_as_image]], [[project_event_lifecycle_notify]], [[project_mail_triage_badge]]
