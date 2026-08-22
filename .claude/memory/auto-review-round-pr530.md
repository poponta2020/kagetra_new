---
name: auto-review-round-pr530
description: auto-review PR #530
type: project
---

PR #530（feature/line-bot-message-revamp / line-bot-message-revamp 全8タスク）の Codex 自動レビュー。**3ラウンドで終了（i + d + f、final で打ち切り）**。

## R1 — phase=initial / gpt-5.6-sol / effort=high（高リスクパス起因）
- verdict=needs_changes / blockers=12 / should_fix=0 / nits=0 / tokens=265,432
- 全差分 5,148行・35ファイル（docs・drizzle snapshot は既定除外で16ファイル対象外）
- トリアージ: 即修正1件（会計メンション解決が best-effort 境界外）を並行修正。残り11件をユーザー確認 → 6件修正・5件見送り
- 修正: メンション上限20件 / 400で紐付けを解除しない / 金額と支払情報を未振込の日だけに限定 / 支払情報の決定的選択 / 人数0の級にも入力欄 / payment_info の長さガード
- WONTFIX 5件: メンション対象のグループ所属検証 / 送信の TOCTOU 排他制御 / 監査スナップショットの分離 / 重複防止キー / 送信直前の binding 再検証

## R2 — phase=delta / gpt-5.6-terra / effort=medium
- verdict=pass / 0件 / tokens=76,111。前回7件すべて解消を確認 → phase=final へ

## R3 — phase=final / gpt-5.6-sol / effort=high
- verdict=needs_changes / blockers=4 / tokens=363,215
- **うち1件は R1 の修正が生んだ残り経路**（dueDays 限定にしたことで、保存人数の再利用だけが旧スコープのまま残った）
- 即修正2件（再検証後に古い人数stateで送信 / deleteMember の参照チェックに last_sent_by が漏れ）→ 並行修正
- 見送り2件（保存人数の再利用 / 期限と口座が別の日から選ばれうる）→ 要件定義書に**既知の制限として明記**
- 修正対象0件になったため 3-d の打ち切り規則で終了（r4.json を verdict=cutoff / reason=user-wontfix で記録）

## 累計
- cumulative_tokens = 704,758（上限 500,000 を超過。ただし R3 完了時点の判定で次ラウンドは発生せず）
- CI: Lint / Typecheck / Test = pass（10m56s）

## 学び
- **R1 の修正が R3 で新しい blocker を生んだ**。「集計の母集団を絞る」修正をしたら、
  同じ値を**保存して再利用する経路**もスコープを合わせる必要がある（今回は見送り判断だが、
  同種の修正では保存済みデータのスコープ整合を必ず確認する）
- Codex の blockers 16件（R1 12 + R3 4）のうち実際に修正したのは8件。発生確率の判断材料は
  運用実態を持つユーザーしか持たない（管理者1名・手動再送前提・共通項目はグループ伝播）
- `useState(() => ...)` の初期化関数は初回のみ。Server Component の再検証で props が変わっても
  client state は追随しない — 送信系の画面で踏むと「対象外の値で送る」実害になる
