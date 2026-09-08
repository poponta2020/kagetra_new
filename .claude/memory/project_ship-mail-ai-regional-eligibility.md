---
name: ship-mail-ai-regional-eligibility
description: D・E 級の地域制限と北海道の出場可否を AI に判定させる（mail-ai-extract-refinements 3.1.0）
type: project
---

feat(mail-ai-extract-refinements): D・E 級の地域制限と北海道の出場可否を AI に判定させる（PROMPT_VERSION 3.1.0） — shipped: PR #618（https://github.com/poponta2020/kagetra_new/pull/618）。merged=ok（main f51a86d）・worktree/branch 削除済み。クローズ: 親 #612・子 #613〜#617（PR 本文の Closes）。マイグレーション無し（判定はドラフト payload 内のみ）。

レビュー: /auto-review-loop 4R（initial sol/high → delta terra/high → final sol/medium → final-delta terra/high）verdict=pass・累計 563,887 トークン（上限 500k を最終ラウンドで超過）。修正した指摘4件（①schema の D・E 集合一致検証=ユーザー決定A ②根拠照合をソース単位に ③全級除外の空選択を送信ガード=ユーザー決定 ④③を級を1つでも外した単位へ拡張）。WONTFIX 0・再レビュー未実施の修正 0。

★残 DoD（本番手作業）: AC-80 = ローカル dev DB の実要綱5件（兵庫 att#45・丸亀 #60・北海道初心者 #96・横浜 E #97・埼玉 D #89）で「再 AI 抽出」し判定と根拠の一文を目視（ANTHROPIC_API_KEY 要）。承認フォーム警告ブロックの 375px 視覚確認は未実施。CI は pending のままマージ（赤なら /quickfix）。
★教訓: 送信ガードのような「自動除外の副作用」は allRemoved だけでなく removedGrades が1つでもある単位まで最初から広げる（final で1ラウンド分＝160k トークン追加になった）。React 19 の form action は submit を常に preventDefault するので、テストで「送信が止まったか」は action スパイの呼び出し有無で見る。
