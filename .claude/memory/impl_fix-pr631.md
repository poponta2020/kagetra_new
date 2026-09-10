---
name: fix-pr631
description: fix PR #631
type: project
---

PR #631（annual-registration-renewal）の Codex R1 指摘を修正。ブランチ feature/annual-registration-renewal・コミット a1cd241（並行修正・UI 2件）と 63038da（本体 7件）。

## 対応した指摘（CRITICAL=blockers）
- listWorkerTasks: 取消要求 CANCEL_PENDING に予約マージンを適用しない。★マージンは「これから予約を取りに行って間に合うか」の判定で、既にある予約を消す要求とは無関係。適用していたため送信5分前以内に取り消したリマインドがそのまま送信されていた
- retryChatTask: 進行中（open）の年度確認に限定。登録完了で終了したはずの失敗タスクを復活させられていた。条件は UPDATE の WHERE に入れる（読んでから書くとすり抜ける）
- saveRenewalAnswer: 先に membership_renewals を FOR UPDATE し completeRenewal とロック順序を揃える。並行すると「完了処理は未回答扱いで zen_nichikyo を残したのに回答行だけ not_register」になっていた
- 4/1 以降に反映済みの leave を撤回したとき is_circle_member を戻す
- 区分と学年の整合性を store 境界で検証（Action は isValidSchoolYear の全集合しか見ないため、区分を省いた直接 POST で不整合を保存できた）。★isSchoolYearForKind の引数は (value, kind) の順
- 表示名解決にバッチ全体の時間予算（RENEWAL_DISPLAY_NAME_BUDGET_MS=120s）。LINE API が遅いと 20人×30秒=600秒で systemd TimeoutStartSec に達し、タスクを1件も作らず停止していた

## 対応した指摘（WARNING=should_fix・3件）
- 実在しない日付の締切を DB 例外でなくエラーで返す（isRealYmd を store に追加）
- 回答成功後に編集モードが閉じない（useEffect で props 更新を監視）
- 締切保存で子の render 中から親 state を更新（useEffect 経由へ）

## 対応しなかった指摘（WONTFIX・ユーザー判断）
- RESERVING 中の取消 → ワーカーとの競合処理の作り直しが必要。上記2件で主要経路は塞がる
- 登録完了ダイアログのプレビュー鮮度 → リビジョン検証の新設が必要
- 分割リマインドの途中失敗の復旧 → 全 split の1トランザクション化が必要
- 会 LINE グループ設定の同時保存 → 初回設定は1回きり・画面から復旧可能

## テスト
変更領域 230 件 green（回帰テスト4件追加: CANCEL_PENDING のマージン除外／PENDING は据え置き／完了後の再試行拒否／leave 撤回の復元／区分矛盾の拒否／実在しない締切）。monorepo lint・check-types green。

★手戻り: 追加した回帰テストで startWith() を使ったら「学年の確認の対象ではありません」で落ちた —— 対象集合は**開始時点**で確定するので、サークル所属は startRenewal の**前**に付けておく必要がある。
