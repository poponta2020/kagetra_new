---
name: ship-pdf-size-warn-instead-of-block
description: AI 抽出の PDF サイズ上限を「拒否」から「警告＋確認」へ
type: project
---

PR #551 出荷。AI 抽出に渡す PDF の 1件ごとサイズ上限を「拒否」から「警告＋確認」へ変更した。

URL: https://github.com/poponta2020/kagetra_new/pull/551 / merge commit a9b311e / state=MERGED

## 何を変えたか
`MAIL_WORKER_PDF_SIZE_LIMIT_KB`（既定 8000KB）は AI 利用コストの目安でしかないのに、選択ダイアログ（チェックボックス disabled）・Server Action（`validateAttachmentSelection`）・classifier（`oversize_skipped`）の3層で送信を拒否していた。管理者が中身を見て選んだ大きめの要綱 PDF を AI に読ませられない実害が出たため、この env の役割を**注意のしきい値**へ変更。

- 選択ダイアログ: 目安超えの PDF もチェック可・行に「サイズが大きめです」、実行時に phase `confirmLarge`（「サイズの大きい添付があります」＋対象ファイル列挙）を1段挟み、はい で送信
- 選択の復元（`restorableSelection`）はサイズを理由に落とさない（削除された添付のみ）。前回確認して選んだ大きい PDF が開くたび黙って外れるのを防ぐ
- classifier は `loadCostGuardConfig` を import しなくなった。actions.ts も同様
- **合計ガードは維持**（Anthropic 32MB 由来。超えれば 413 で必ず失敗するので確認では通せない）
- 予約枠 `NON_ATTACHMENT_RESERVE_BYTES` を 6MiB→1MiB に圧縮し実用上限を約 19.5MB→**約 23.25MB** へ拡大
- result-import（自動処理・人が確認できない経路）の1件ごとガードは**維持**

## 設計上の要点
★`triggerExtractDraft` は draft を ai_processing にしてジョブを積み、worker が後から `runManualExtract` で処理する**非同期**経路。「OK した」という一過性の状態は worker まで渡せないため、列追加（マイグレーション）を避けるには**判定そのものを外して UI 側の確認に寄せる**しかなかった。結果としてスキーマ変更ゼロ。

★予約枠を薄くできる根拠は、送信直前の**実測**ガード `exceededRequestBudgetBytes` が classifier.ts に配線済みであること。事前チェックは見積りにすぎず、厚くした分だけ「実際は 32MiB に収まるのに送れない PDF」が増えるだけだった。

## 変更ファイル（12 + 要件定義書）
apps/mail-worker/src/classify/{attachment-budget,classifier}.ts / config.ts / reextract.ts、同 test/classify/{attachment-budget,classifier}.test.ts・test/manual-extract.test.ts、apps/web/src/app/(app)/admin/mail-inbox/{actions.ts,actions.test.ts,components/AIExtractConfirmDialog.tsx,同 .test.tsx}、docs/spec/mail-worker.md、docs/features/mail-ai-extract-refinements/requirements.md（AC-27/32/35/36・§3.2.4・§3.2.5・シナリオ C' を今回の挙動へ訂正）

## テスト
★**Docker Desktop を起動してテスト DB を立て、ローカルで実行済み**（近年の出荷では珍しく未実行でない）。mail-worker 44+58 / web mail-inbox 配下 429 いずれも green、typecheck（web・mail-worker）・lint（mail-worker）も green。
★`manual-extract.test.ts` は `oversize_skipped` を per-file 9MB で作っていたため壊れた → 合計超過 25MB へ作り替え。**サイズ数値のリテラルは symbol grep に掛からない**ので、この種の fixture は `grep -rn "sizeBytes: [0-9_]{7,}"` で洗う必要がある。

## レビュー
Codex 1R(i)=pass・blockers 0/should_fix 0/nits 0・修正コミットゼロ・148,508 トークン。effort=medium（判定は差分1235行のサイズ起因 high → sol 較正で medium）。**打ち切りなし・WONTFIX なし**。CI は pending のままマージ（方針 v0.9.0。赤なら追修正）。

## 残 DoD
本番実機で 8MB 超の要綱 PDF を選択 →「サイズの大きい添付があります」→「はい」で AI 抽出が完走することを確認する。
