---
name: fix-pr530
description: fix PR #530
type: project
---

PR #530（feature/line-bot-message-revamp）の Codex レビュー R1 指摘への修正。

## 対応した指摘（CRITICAL 7件）
- メンション上限を 100 → **20**（textV2 の substitution 全体は100だが、メンションは別枠で20。超過でメッセージ全体が拒否される）
- **400 では LINE 紐付けを解除しない**。解除は 401 / 403 / 404 のみ。textV2 導入でペイロード起因の 400 が起こりうるようになり、宛先と無関係な不備で大会の通知が全停止するのを防ぐ
- 会計メンション解決（`resolveTreasurerMention`）を best-effort の try 内へ。claim 済み行が finalize されないまま UNIQUE で再 claim できず通知が恒久的に失われる経路だった
- 振込連絡の金額・単価・支払情報を **未振込の日（dueDays）だけ**から引く。`tallyEntryFeesForGroup` は支払済みの日を除外しないので**二重請求**になっていた
- 支払情報の選択を決定的に（クエリに `ORDER BY event_date, id`）
- 単価が解決できる対象級は**人数0でも入力欄を出す**（0人の級を落とすと確定名簿に合わせて増やせない＝機能の目的が果たせない）
- `payment_info` を LINE の1通上限（5000文字）で分割（支払情報は最大4通・超過分は末尾を切る）

## 見送り（WONTFIX・ユーザー判断）
- メンション対象のグループ所属検証 → LINE のメンバー確認 API が要りスコープ大。本番実機確認（AC-21）で見る
- 送信の TOCTOU 排他制御 → 管理者が実質1名
- 監査スナップショットの分離 → 人数を残すのは意図的な設計
- 重複防止キー（X-Line-Retry-Key）→ 手動・再送前提の機能なので重複は運用で許容
- 送信直前の binding 再検証 → ミリ秒の窓・既存経路も同形

## 副次
`FeeTallyResult.headcounts` の追加（タスク7）で `entry-fee-tally.test.ts` の `toEqual` 3件が落ちていたのを修正。**追加フィールドでも `toEqual` の全体一致アサーションは壊れる** — 追加時は当該スイートを回すこと。

コミット: 63ea3b6（並行修正）/ cfeb9f9（本体）
