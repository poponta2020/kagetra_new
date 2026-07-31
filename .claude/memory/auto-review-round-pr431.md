---
name: auto-review-round-pr431
description: auto-review PR #431
type: project
---

PR #431 (mail-ai-extract-refinements) の Codex 自動レビュー。**8ラウンドで pass**。

## ラウンド構成
| R | phase | model/effort | verdict | B/S/N |
|---|---|---|---|---|
| 1 | initial(全差分13089行) | sol/high | needs_changes | 3/0/0 |
| 2 | delta | terra/medium | needs_changes | 1/0/0 |
| 3 | delta | terra/medium | needs_changes | 1/0/0 |
| 4 | delta | terra/high | needs_changes | 1/0/0 |
| 5 | delta | terra/high | needs_changes | 1/0/0 |
| 6 | delta | terra/high | **pass** | 0/0/0 |
| 7 | final(全差分14016行) | sol/high | needs_changes | 1/3/0 |
| 8 | final-delta | terra/high | **pass** | 0/0/0 |

## R1 の blocker 3件（すべて実在・修正済み）
1. reextract CLI が保存済み添付選択を無視（runManualExtract/reextractDraft には通したが CLI 経路を忘れていた）
2. 複数PDFの合計サイズが Anthropic 32MB を超え得る（要件§6に明記があったのに実装漏れ）
3. 上限引き下げ後に復元した超過添付を選択解除できない詰み

## ★R2〜R5 の ping-pong（4ラウンド同一 title）
「合計サイズが 32MB を超え得る」が同じ title で5回再掲された。ただし**中身は毎回別の抜け**を指しており、段階的に精度が上がった:
R1 生バイト合計のガード追加 → R2 base64化後で判定 → R3 実ペイロードを実測 → R4 JSONシリアライズ後で実測 → R5 PDFファイル名の2回送信分を計上 → R6 pass。

**学び**: 「予約枠」「見積り」といった**仮定を最終防衛線にすると Codex は必ず突いてくる**。仮定を外して実測に置き換えた R3 以降で収束が始まった。delta モードは未解消指摘に同じ title を強制するため、title の同一性だけでは真の膠着と判別できない —— rationale の中身が変わっているかを見る必要がある。

## R7(final) の blocker（★自分で入れた退行）
upsertDraft の UPDATE が confidence / is_correction / references_subject を含んでいたため、**2.x のドラフトを再抽出しただけで過去の値が消えた**。要件§6「既存行の値も残す」に反し、しかも自分で書いたコメントは「Existing rows keep theirs」と実挙動の逆だった。**コメントと実装の食い違いは、書いた本人には見えない** —— 列を「書かない」と決めたら、INSERT の既定値と UPDATE の対象列を分けて考える。

## ユーザー判断で見送り（WONTFIX）
- DraftCard の訂正版バッジ（旧ドラフトの is_correction 表示）— **ship 後に申し送り事項として伝える約束**
- reextract の IN 句 65,535件上限 — 会のメール量では到達しない

## R9-R11（main マージ後）
実装中に main へ別機能の migration 0052 がマージされ番号衝突 → 0053 へ採番し直し（PR が DIRTY になった）。マージ解消コミットは未レビューなので final を再実行（R9・sol/high）。

- R9 blocker: **再抽出がサイズ超過でスキップされたとき、Server Action が成功として返し新しい選択まで保存する**ため、古い payload が pending_review のまま残り「新しい抽出結果」と誤認して承認できた → classifyMail 直後・tx 前に throw する形に修正（選択も draft も mail 状態も一切変えない）
- R9 should_fix: 2.x ドラフトの short_name_stem を通称欄へ引き継いでいなかった → 実データから防御的に読んで初期値にする
- R10(final-delta): should_fix は解消。blocker は「throw だけでは古い payload が承認可能なまま」と再掲。**Codex 案（draft を ai_failed にして payload を消す）は、抽出を試みてすらいないのに既存の正常な抽出結果を破壊する**ため採らず、ユーザー判断で見送り（WONTFIX）。管理者は失敗を明示的に告げられており、残るのはクリック前からあった payload なので新たな危険は生まれない

## ★レビュー結果への反論が正しいこともある
R10 は「Codex の指摘に従うと副作用のほうが大きい」典型。指摘の**前提**（管理者が誤認する）を実際の画面遷移で検証すると、失敗メッセージが出ている以上その前提が成り立たない。指摘を機械的に飲まず、修正の副作用と天秤にかけてユーザーに判断材料を出す。

## Codex 環境メモ
Vitest は Codex 実行環境で spawn EPERM により起動できず、毎回「テスト未完走」と報告される。型チェックと lint は通る。テストの green は main 側で確認するしかない。
