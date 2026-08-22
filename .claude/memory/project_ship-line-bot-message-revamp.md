---
name: ship-line-bot-message-revamp
description: 大会別LINE Botメッセージ全面改訂＋会計メンション・振込連絡
type: project
---

**shipped: PR #530** https://github.com/poponta2020/kagetra_new/pull/530（merge commit 834ff83・2026-08-22）

大会別 LINE Bot（プール30個・申込グループ単位で紐付け）のメッセージを全面改訂し、会計へのメンションと名簿確定後の振込連絡を新設した。親 Issue #519 / 子 #520-527 すべてクローズ。

## 入ったもの
- **会計フラグ** `users.is_treasurer`（migration 0059）＋会員編集トグル・会員一覧の印。**ロール enum は増やさない**（`vice_admin` の判定が43ファイル58箇所にインライン展開されているため）。**認可判断には一切使わない識別専用の列**
- **メンション基盤** `line-mention.ts`（pure）／`line-mention-targets.ts`。textV2 の substitution を組み立てる。★自由記述を混ぜられない制約を**型と実行時検証の両方**で守る。メンションは**1メッセージ20件が上限**（substitution 全体の100件とは別枠）
- **振込連絡**（migration 0060 `entry_group_payment_notices`）。`/admin/entries/[groupId]` に導線。プレビュー必須・人数だけ編集可・単価は編集不可・再送可
- **文面差し替え**: join の返信廃止＋紐付け完了を①〜④の4通へ／通知8種から大会名と金額を除去・`M/D(曜)` 化・日別ラベル撤去（束ねは維持）／E-2 を `@会計` の予告文へ
- **波及**: reply / push を `LineMessage[]` 受けへ拡張。`FeeTallyResult.headcounts` 追加

## レビュー（/auto-review-loop 3R = i+d+f）
- R1 initial（sol/high）needs_changes・blockers 12 → 6件修正・5件見送り／R2 delta（terra/medium）pass／R3 final（sol/high）blockers 4 → 2件修正・2件見送りで cutoff
- **累計 704,758 トークン**（上限 500,000 超過。R3 完了時点の判定で次ラウンドは発生せず）
- ★**修正したが再レビューしていない指摘が2件ある**（CI が赤くなったときの手がかり）:
  1. `PaymentNoticeSection.tsx` — 再検証後に古い人数 state で送信していたのを、rows の署名変化で state を作り直すよう修正
  2. `admin/members/[id]/edit/actions.ts` — `deleteMember` の参照ゼロチェックに `entry_group_payment_notices.last_sent_by` を追加
- **見送り（受容した既知の制限）**: メンション対象のグループ所属検証（LINE のメンバー確認 API が要る）／送信の TOCTOU 排他制御／監査スナップショットの分離／重複防止キー／送信直前の binding 再検証／送信後に対象日が減ったときの保存人数の再利用／振込期限と支払情報が別の日から選ばれうる。後ろ2件は要件定義書 §3.3.2 に既知の制限として明記済み

## ★残 DoD（本番作業）
1. **migration 0059・0060 を本番へ適用**（`db:migrate`。`db:push` は対話プロンプトで詰む）
2. **AC-21: 本番で会計フラグを設定し、実際の大会グループへ振込連絡が届くことを確認**
3. **同時に「メンションが実際に表示されるか」を確認する** — 会計担当がその大会の LINE グループに居ない場合に textV2 全体が拒否される可能性を、レビュー指摘のうえ見送っている。届かなければ追修正（素テキストへのフォールバック等）
4. CI は R3 修正の push 直後で pending のままマージした。赤なら追修正
