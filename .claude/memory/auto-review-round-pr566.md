---
name: auto-review-round-pr566
description: auto-review PR #566
type: project
---

PR #566 payment-receipt-broadcast（支払報告に証憑アップロード＋LINE配信）の auto-review ループ。**4ラウンドで pass 収束（i + d + f + fd）**。

## R1 (initial / gpt-5.6-sol / high / 203,611 tokens) verdict=needs_changes・blockers 8
差分 4,118行・32ファイル。開始前にベース競合(DIRTY)を解消（origin/main が PR #553 出荷で進行。docs/索引/MEMORY.md のみ）。
- ★最重要: `'use server'` ファイルからの `export const MAX_PAYMENT_RECEIPTS` で**本番ビルドが確実に落ちる**（Codex が pnpm build で実測再現）。型の export は問題ない（実行時に消えるため）
- 先頭 ID だけのグループ検証／シートの画像変換レース（写真選択直後に押すと証憑0枚で確定）／履歴に対象日が無い（AC-17）
- ユーザー確認 → 修正: トランザクション分断・flip 0件でも送る二重送信・高精細写真が base64 上限で報告ごと弾かれる
- ユーザー確認 → **WONTFIX**: プレビュー金額と実送信額の乖離（発生窓が短く、送った文面は message_text に正しく残る）

## R2 (delta / gpt-5.6-terra / high / 121,295 tokens) verdict=pass
前回7件すべて解消・修正起因の新規問題なし。

## R3 (final 全差分 / gpt-5.6-sol / high / 219,634 tokens) verdict=needs_changes・blockers 5
**delta が pass でも final で5件出た** —— final ラウンドを省略していたら全部素通りしていた。
- ★**送信先の再解決**: `sendClaimedNotificationBulk` は代表イベント id から `events.entry_group_id` を**送信時点で**引き直す。保存〜送信の間にその日が別グループへ付け替えられると**証憑が別の大会の LINE グループへ流れる**。`pushMessagesToEntryGroup` + 自前 finalize へ変更
- ★**中止日への送信**: `flippedIds` は cancelled も含むので、証憑があると「cancelled には通知しない」既存ガードを迂回。`notifiableIds` を分けて判定
- **再送の重複配信**: 排他なし。`status='sending'` の条件付き UPDATE で送信権を1つだけ取る形に（5分で stale 再取得）。初回送信中のプレースホルダも failed→sending（failed だと履歴に「送信失敗」と出て誤った再送を誘発）
- `eventIds` の `.max(50)` が51日超グループで既存操作を壊す回帰／metadata 通過後の sharp 例外が「1枚除外」にならず報告全体を落とす
- ユーザー回答は「お任せ」。推奨どおり3件とも修正（再送は lease+再送キーの重装備ではなく軽量版を採用）

## R4 (final-delta / gpt-5.6-terra / high / 126,201 tokens) verdict=pass
5件すべて解消・新規指摘なし。→ 収束。

累計トークン: **670,741 / 500,000（既定上限を超過）**。R3 の final で blockers 5件が出たため、その修正確認（R4）を止めると最新結果が needs_changes のままで出荷が機械的にブロックされる。R4 は差分655行の delta で安価と判断して実行した。
WONTFIX: 1件（上記）。
