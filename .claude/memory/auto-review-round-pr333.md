---
name: auto-review-round-pr333
description: auto-review PR #333
type: project
---

PR #333 配色のデザイントークン一元化のレビューラウンド記録。

pr: 333
rounds: 2
final_verdict: pass
effort: high (両ラウンド。auth/ パスを含むため review-effort.sh が high 判定)
escalated: false
round_tokens: R1=93,712 / R2=93,571
cumulative_tokens: 187,283 / 500,000

## R1 verdict=needs_changes (blockers=0, should_fix=3, nits=0)

3件とも同一原因: 置換で text-ink-meta(#7a6e5a) が bg-surface-alt(#f0eadc) の
上に乗り 4.16:1 となり、本文サイズの WCAG AA 基準 4.5:1 を下回った。
置換前は text-gray-500 on bg-gray-50 = 4.63:1 だったため PR による回帰。

指摘の妥当性を相対輝度から自前で再計算して確認した上で修正。さらに導入した
配色の組み合わせを全数チェックし、回帰がこの1パターンのみであることを確認した。
(成功文字は緑#16a34a→藍#2b4e8c で 3.30:1 → 7.63:1 と大幅改善していた)

対応: text-neutral-fg(#5b4f33) = 6.71:1 へ。Codex 提案の text-ink-2 は
10.27:1 で基準は満たすが本文と同じ濃さになり補足テキストの階層が潰れるため不採用。

## R2 verdict=pass

blockers/should_fix/nits すべてゼロ。

## 学び

Tailwind v4 は未定義トークン参照のクラスに CSS を出力せずエラーも出さないため、
lint/typecheck/vitest では検出できない。postcss で実スタイルシートをコンパイルし
生成 CSS を機械照合する検証を行った(27ユーティリティ/23トークン)。この手法は
配色まわりの変更で再利用価値がある。

一方その検証はコントラスト比までは見ないため、トークン置換では
「出力されるか」と「読めるか」を別々に検証する必要がある。globals.css の Ink
セクションに、どの背景の上でどのトークンが AA を満たすかを実測値付きで明記した。
