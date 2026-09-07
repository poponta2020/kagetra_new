---
name: auto-review-round-pr592
description: auto-review PR #592
type: project
---

PR #592 travel-report 遠征届の自動レビュー（完了）。

## ラウンド構成と結果
| R | phase | model / effort | verdict | B/S/N | tokens |
|---|---|---|---|---|---|
| 1 | initial（全差分 14,772行・106ファイル） | sol / high | needs_changes | 16/0/0 | 902,820 |
| 2 | delta | terra / high | needs_changes | 2/0/0 | 70,336 |
| 3 | delta | terra / high | needs_changes | 1/0/0 | 13,012 |
| 4 | delta | terra / medium | **pass** | 0/0/0 | 35,787 |
| 5 | final（全差分） | sol / medium | needs_changes | 5/0/0 | 345,268 |
| 6 | final-delta | terra / high | needs_changes | 1/0/0 | 62,905 |
| 7 | — | — | cutoff (user-wontfix) | — | — |
累計 1,430,128 トークン（既定上限 500,000 をユーザー承認で2回引き上げ）。

**修正した blocker 計19件**（R1:13・R2:2・R3:1・final:4。※R3 は誤検知だが提案形を採用）

## ★誤検知だったもの（今後の教訓）
- **R3「dirty フラグのスプレッドが b の true を a の false で潰す」** — `dirty` には `true` しか入らず、キーが無い側のスプレッドは上書きしない。Codex は `Partial<Record<..,true>>` を「false が入る」と誤読した
- **final「jszip が pnpm-lock.yaml の apps/web importer に無い」** — ★**review-diff.sh が lockfile を機械生成物として除外するため Codex から見えない**。`pnpm install --frozen-lockfile` が "Lockfile is up to date" で成功することを実地確認。**lockfile 絡みの指摘は必ず frozen install で実証してから判断する**
- **final-delta「古い再計算応答が settledSplit を巻き戻す」** — 提案された guard は該当行の直前に既に存在。応答順逆転の回帰テストを足して pass を確認

## ユーザー判断の見送り（WONTFIX 計5件）
- 通知判定の対象者集合を tx 外で読む／通知 claim の outbox 化 → 1人開発・同時操作がほぼ起きない前提で受容。既存の振込連絡と同じ claim→コミット後push→finalize を維持
- 管理者編集でのサークル所属 ON 必須強制／退会時の遠征フラグ自動解除 → requirements R1・R2 の明示仕様どおり
- final-delta の誤検知

## 実装上の学び
- **905k トークンの内訳はほぼ R1**。106ファイル・645KB の PR を1本で出すと initial だけで予算を使い切る。大機能は PR を割るか、initial の effort を下げる判断が要る
- Codex は「同時に2人が操作する」前提の指摘を多く出す。身内アプリでは運用実態をユーザーに判断させる（3-c.5 の設計が効いた）
