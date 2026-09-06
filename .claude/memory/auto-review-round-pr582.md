---
name: auto-review-round-pr582
description: auto-review PR #582
type: project
---

PR #582（feature/line-bot-message-revamp / メール処理画面からの振込連絡）の Codex 自動レビュー。**verdict=pass で終了**。

| R | phase | model | effort | verdict | B/S/N | tokens |
|---|---|---|---|---|---|---|
| 1 | initial（全差分3507行） | gpt-5.6-sol | high | needs_changes | 3/0/0 | 264,788 |
| 2 | delta | gpt-5.6-terra | (auto) | pass | 0/0/0 | 89,469 |
| 3 | final（全差分3963行） | gpt-5.6-sol | high | needs_changes | 4/0/0 | 330,881 |
| 4 | final-delta（476行） | gpt-5.6-terra | high | **pass** | 0/0/0 | 129,870 |

★R3 は**1回目がネットワーク切断（DNS）で結果 JSON を残さず失敗**し 198,862 トークンを空費した。再実行分が上表の 330,881。累計 1,013,870 / 上限 500,000 で**上限超過のまま続行**（ユーザー判断: 「R3 を再実行してから ship」を選択）。

WONTFIX（見送り）なし — 全7件を修正した。

**R1 blockers（コミット 9054e5b）**
1. 送信不可時に支払締切・振込先まで保存されない → 送れない状態でも共通項目だけは編集・保存できるようにした
2. 先行配信の 400 で振込連絡が無記録のまま脱落する → 失敗記録を残す
3. 成功後の再送失敗で「送信済」と「送信失敗」が同時表示される → 表示の優先順位を整理

**R3 blockers（コミット de41267）★このループの本命**
1. **配信 OFF なのにオープンチャットが送られる** — `after()` の登録条件を振込連絡へ広げたことによる**自分で入れたリグレッション**。オープンチャット側は `includeOpenChat` しか見ておらず、`broadcast:false` ∧ `includeOpenChat:true` ∧ 振込連絡 ON の直叩きで通った。→ `input.broadcast &&` を必須条件に追加
2. **グループ切替直後に前の大会の口座情報を新しい大会へ保存できる** — ドラフト破棄が useEffect なので、切替レンダーとエフェクト実行の間に窓がある。→ ドラフトを取得元 groupId と一体で保持し、現在の選択と一致するときだけ有効化
3. **再送失敗が `total_jpy` を上書きする** — `payment-report-amount.ts` は `last_sent_at` 非 NULL のとき `total_jpy` を「会計へ伝えた額」として採用する。再送で人数を直して push が失敗すると、届いていない金額が**会員向けの支払報告通知**に載る。→ `total_jpy` は成功時の UPDATE でのみ進める（人数は従来どおり push 前に保存）。★PR 前からあった挙動だが、共有コアへ切り出したこの PR で直した
4. **世代トークン確認後の DB 待機中に取り消すと push される** — `pushMessagesToEntryGroup` は紐付けを DB から引いてから LINE API を叩く。→ 任意の中止コールバックを `pushToBinding` の LINE API 直前まで通した。`PushTextResult.outcome` に `'aborted'` を追加し、ライフサイクル通知の status へは `toNotificationStatus`（aborted→skipped）で写す

**次に効く教訓**
- `after()` の**登録条件を広げるときは、その中の各ブロックが自前でガードを持っているか必ず確認する**。今回は外側の `if (input.broadcast)` が実質のガードになっていたブロックが1つあり、外側を緩めた瞬間に無防備になった
- 監査用スナップショット列（`total_jpy`）を「試行前に書く」と、成否フラグ（`last_sent_at`）とペアで読む下流が壊れる。**ペアで読まれる列はペアで更新する**
- Codex の delta ラウンド（R2 pass）は修正差分しか見ないので、**全差分の final を省略すると R3 の4件は素通りしていた**。final を回す価値が実証された回
