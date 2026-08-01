---
name: feature-def-mail-inbox-process-form
description: mail-inbox-mailer 統合処理フォーム 要件定義(2026-08-02改修)
type: project
---

# mail-inbox-mailer 2026-08-02 改修（統合処理フォーム）要件定義

親Issue #440 / 子 #441-446。正典= docs/features/mail-inbox-mailer/{requirements.md,design-spec.md,design-mock/,implementation-plan.md}。実装未着手。

## 何を変えるか
メール詳細 /admin/mail-inbox/mail/[id] の3セクション並び（処理3ボタン / 試合結果の取込 / 添付ごとの名簿採用シート）を「種別 → 対象の大会 → 実行」の1フォームへ畳む。

## ★根本原因の把握（この改修の芯）
ユーザーの不満は「大会を2回選ぶ」。原因は **LINE紐付けも名簿採用も元々 entry_group 単位なのに、メールの紐付け（mail_messages.linked_event_id）だけが event 単位で別セクションだった**こと。つまり本質は「共有の大会ピッカーを1本にする」であって、メール取り込み全体の再設計ではない。

## 確定した設計判断（ユーザー回答）
- 種別= 未選択 / 大会案内 / 申込名簿 / 確定名簿。**新列 mail_kind**（classification は AI/pre-filter 所有の別軸なので混ぜない）
- **未選択でも大会を選べる**＝現行「既存イベントに紐付ける」（組合せ表・訂正版・領収書）の受け皿。種別を4つ目に増やさない
- 大会の選択単位は**申込グループ**。1メール=高々1グループ
- **carrier は linked_event_id のまま**、グループ→代表イベントに解決して保存 → EventRelatedMails 無改修で回帰OK
- AI抽出は種別=大会案内 のときだけ。大会案内では LINE配信の選択肢を出さない（approveDraft は新規グループを作るので binding が無く配信は事実上 no-op）
- LINE配信する/しない・本文添付する/しない（既定ON）。本文OFF= 冒頭メッセージ＋添付リンクのみ
- 名簿は複数添付を1回で採用。**級ゼロ選択=グループ統一（null）**。取込単位ラジオは廃止
- LINE未紐付けグループでは配信を選べなくして理由表示（現状は黙ってスキップ）
- 「試合結果の取込」は種別=未選択のときだけ表示（senseki-boundary の切除しやすさ維持・種別enumには入れない）
- 確定は「すべてフォーム。実行して初めて保存」。undo は種別・紐付け・名簿採用をまとめて戻す
- 「対応不要」ボタンは別ボタンとして残す

## ★実装で踏む地雷（advisor 指摘＋実地確認）
1. **include_body の再送整合**: event_broadcast_messages に永続化するだけでは不足。prefix-skip（!force かつ deliveredCount>0）が効く経路では **保存値を優先して列を再構成**しないと、partial 行の再送で読み飛ばし位置がずれて誤スキップ／重複送信になる。manualBroadcast は既に isCorrection/leadText を保存済み行から継承しており（force:true）、include_body も同じ規約に乗せる
2. **空メッセージ列**: 本文OFF＋lead無し＋添付無し → 0通。sent にすると以後の非force送信が全部 already_sent でブロックされる。skipped を返し、かつ UI 側で lead を必須にして到達させない
3. **normalizeAdoptionGrades は [] を弾く**（旧UIの級別ラジオ前提）。新UIのゼロ選択は正当なので **null を送る**
4. **client-safe 純関数**: 候補フィルタは @kagetra/shared/schema を型importも含めて参照禁止。lint/vitest/typecheck では検知できず next build で初めて壊れる
5. 一括採用は 1 tx・revalidate は commit 後1回だけ（adoptRosterFile は tx 外で6回 revalidate している）

## AC / Wave
AC 33件（auto-test 32・manual 1）。うち回帰7件（AC-27..AC-31 ほか: 関連メール・AI承認フロー・申込管理ボードの進行判定・本文ON配信・冒頭メッセージ）。
Wave1= T1(schema)+T2(候補ローダ) / Wave2= T3(broadcast)+T6(一覧ピル) / Wave3= T4(actions.ts単独) / Wave4= T5(詳細UI)。

## デザイン
Path D（Claude Design）を選択 — **ローカル dev DB が古いスキーマで /admin/* が描画できない**ため Path L 不可（triage_status・entry_groups・tournament_entry_roster_files・event_line_broadcasts が無い）。A案（1画面の縦フロー）採用、B案（3ステップウィザード）は不採用で削除。実行前の「実行すると」要約ブロックはユーザー判断で不採用。
