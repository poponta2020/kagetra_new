---
name: ship-mail-ai-extract-refinements
description: メール大会案内取込のAI再設計
type: project
---

PR #431 出荷。https://github.com/poponta2020/kagetra_new/pull/431
「メール大会案内取込のAI再設計（分類撤去・Sonnet 5移行・添付選択）」。親Issue #410 ＋ 子 #411-#422 の全12タスク。

## 何を変えたか
運用は既に「cron が AI を呼ばず、管理者が『会で流す』を押したときだけ AI が走る」形に変わっていたのに、プロンプトの約3割が分類の記述で、スキーマも is_tournament_announcement を要求し続けていた。そのズレを解消した。

- **分類の撤去（PROMPT_VERSION 3.0.0）** — is_tournament_announcement / confidence / short_name_stem / is_correction / references_subject / fee_jpy を削除。代わりに source_mismatch（「渡された資料が明らかに別種の文書」のときだけ申告する限定フラグ）
- **抽出項目の整理** — payment_deadline_kind（日付あり/後日連絡/記載なし）と capacity_total を追加。payment_method / entry_method を閉じた日本語 enum 化
- **Sonnet 5 移行** — thinking: disabled を明示（省略すると adaptive thinking が max_tokens を食って record_extraction が途中で切れる）。プロンプトキャッシュ撤去
- **添付選択 UI** — どの添付を AI に渡すか選べる。既定は全て未チェック・上限超過はチェック不可・全未チェック実行時は確認1段。本文は選択によらず常に渡る
- **振込締切の状態を events へ** — events.payment_deadline_kind（migration 0053）。承認した瞬間に「後日連絡だから空」が消えて申込ボードが一律「締切未設定」と出る症状を解消
- **PDF サイズ上限 800→8000KB**、受信箱一覧の tier 廃止、通称の人力入力

## レビュー（11ラウンド・詳細は auto-review-round-pr431）
initial→delta×5→final→final-delta→(main マージ)→final→final-delta。実在の不具合を8件修正。verdict=cutoff（残1件はユーザー判断で見送り）。

## ★出荷後の申し送り（ユーザーとの約束）
**DraftCard の訂正版バッジ**: 受信箱一覧のカードに、旧ドラフトの is_correction=true を拾って「⚠ 訂正版」バッジを出す分岐が残っている。今回訂正版判定は AI から外し詳細画面のヒントも撤去した（AC-19）が、一覧カードは要件に明記が無かったため触っていない。新規ドラフトでは常に false なので実害はないが、過去の AI 判定が現行の有効な判断のように見える。**気になったら別途 /quickfix で外す**。

## その他の残作業
- **AC-25 未確認**（ライブ API 検証）: 実際の抽出1件が stop_reason: max_tokens で切れず完走すること。本番で1件流して確認する
- 本番 .env の MAIL_WORKER_PDF_SIZE_LIMIT_KB を確認（未設定なら既定 8000 が効く。明示設定されていれば書き換え）
- 本番 migration は db:migrate（db:push は対話プロンプトで詰む）

## WONTFIX（ユーザー判断）
- reextract の単一 IN 句 65,535件上限 — 会のメール量では到達しない
- 再抽出がサイズ超過でスキップされたとき既存 payload を残す方針 — Codex は「ai_failed にして payload を消せ」と主張したが、抽出を試みてすらいないのに正常な抽出結果を破壊する副作用が大きいため現状維持
