---
name: bash-timeout-orphan-node-prod-tx
description: WindowsでBashツールのタイムアウトkillはnode子プロセスを殺しきらない — 本番DB書込はゾンビが継続する。長時間書込はrun_in_backgroundで完了通知を待つ
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4e00dd32-27fd-4e59-a429-b40fd311c550
---

Windows (Git Bash) で Bash ツールの timeout がプロセスを SIGTERM で殺すとき、`pnpm exec tsx` の**node子プロセスはプロセスツリーごと死なず生き残る**。SSHトンネル経由の本番DBトランザクションはゾンビとして継続し、コミットまで到達しうる。

**実害例 (2026-07-04, Tier2台帳#21)**: 大垣3大会再取込の初回runが10分タイムアウトでkill→t791のtxをゾンビnodeが継続→「失敗した」と判断して再実行したrunが行ロック待ちでブロック→ゾンビcommit後に再実行側のDELETEが0行になり**二重取込が成立する寸前**だった。pg_stat_activityの2セッション(active DELETE=ロック待ち + idle in tx insert=ゾンビ)で検出し、再実行側のプロセスツリーをtaskkill /T /F(tx rollback)して回避。TaskStopツールも子プロセスを殺さない(taskkillで6プロセスの木を手動終了した)。

**Why:** Bashツール/TaskStopのkillはラッパー(bash/pnpm)に届くが、Windowsではプロセスグループのシグナル伝播が効かずnode孫プロセスが切り離される。クライアント生存中はPostgresセッションも生き続ける。

**How to apply:**
- 数分かかりうる本番書込スクリプトは**最初からrun_in_background**で起動し完了通知を待つ。フォアグラウンドのtimeout kill任せにしない
- kill後に再実行する前に、**必ず pg_stat_activity で旧txの残存を確認**(`state, xact_start, query`)。残っていたら (a)ゾンビの完遂を待つ か (b)pg_terminate_backend でロールバックさせてから単独再実行。**両方を同時に走らせない**
- 再取込ドライバのDELETEは影響行数0を異常として即abortするガードを入れると二重取込を構造的に防げる(_t3reingest8.mtsは未実装・今回は運用で回避)
- 関連: [[no-longlived-process-from-worktree-cwd]] [[tool-output-fabrication]]
