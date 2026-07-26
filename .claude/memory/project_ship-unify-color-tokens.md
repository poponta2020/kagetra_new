---
name: ship-unify-color-tokens
description: 配色のデザイントークン一元化
type: project
---

配色をデザイントークンに一元化した。PR #333 (https://github.com/poponta2020/kagetra_new/pull/333) merge済み (f877e6c)。対応 Issue なし（会話由来の quickfix）。

## 何を変えたか

正典は apps/web/src/app/globals.css の @theme（Tailwind ユーティリティ生成用）と
:root の --kg-*（inline style から var() 参照用）の2系統。会員向けメイン画面は
既にトークン化済みだったが、管理画面と認証まわりだけデザインシステム導入前の
素パレットのまま残っていた。

- 素の Tailwind パレット 106箇所/10ファイルをトークンへ（gray→ink/border/surface系、
  red→danger、amber→warn、green→success）。リポジトリ全体で該当ゼロを確認
- ベタ書き LINE 緑 #06c755/#05a648 → bg-line/hover:bg-line-hover（同一hexのトークンが
  定義済みかつ未使用だった。視覚変化なし）
- bg-white→bg-surface、bg-brand 上の text-white→text-ink-on-brand
- hover:bg-brand/90 → hover:bg-brand-hover
- attendance-counts の不参加バー #F3B4B4 → 新規トークン --kg-nonattend（同一hex）
- PWA themeColor #ffffff → #f4efe3（canvas と同値）

## 意図的に純白のまま残した6箇所（コード内にコメントで理由明記）

LINE ログインボタンの文字3箇所（LINE緑の上は純白が正）／イベント一覧トグルの
つまみ（OFF時トラック#ebe3ceとのコントラスト確保）／添付プレビューの文書背景
（白い紙面の周囲に和紙色が覗くのを避ける）。
モーダル背景 bg-black/40（12ファイル）は既に統一済み・対応トークンなしで対象外。

## ★重大な学び1: Tailwind v4 の無言failure

Tailwind v4 は未定義トークンを参照するクラスに CSS を出力せず、エラーも出さない。
text-ink-meta を text-ink-metal とタイポしてもビルド・lint・typecheck・vitest すべて
green のまま該当要素だけ無色になる。**この失敗モードは既存のどのゲートでも検出できない。**

対策として postcss + @tailwindcss/postcss で実スタイルシートをコンパイルし、
(1)導入した27ユーティリティ全てがCSSを出力する (2)期待どおり var(--color-*) を参照する
(3)参照先23トークンが期待hexで出力される (4)撤去したパレットクラスが消えている
を機械照合した。配色変更では再利用すべき手法。

## ★重大な学び2: 「出力されるか」と「読めるか」は別

上記の生成CSS検証はコントラスト比を見ない。Codex R1 が WCAG AA 回帰を検出した:
text-ink-meta(#7a6e5a) on bg-surface-alt(#f0eadc) = 4.16:1 で本文基準4.5:1未満。
置換前の text-gray-500 on bg-gray-50 は 4.63:1 だったため PR による回帰だった。

相対輝度から自前で再計算して指摘の正しさを確認し、導入した配色の組み合わせを
全数チェック（回帰はこの1パターンのみ。成功文字は緑→藍で 3.30:1→7.63:1 と大幅改善）。
text-neutral-fg(#5b4f33)=6.71:1 へ修正。Codex 提案の text-ink-2 は 10.27:1 で基準は
満たすが本文と同じ濃さになり補足テキストの階層が潰れるため不採用。

再発防止として globals.css の Ink セクションに、どの背景の上でどのトークンが AA を
満たすかを実測値付きで明記した:
  ink-meta on surface 4.67 OK / on surface-alt 4.16 NG / on canvas 4.35 NG
  ink-muted は本文に使わない（surface 上 2.53）

## 残課題

ink-meta × surface-alt の同居が他に10箇所あるが、いずれも本PRの差分外の既存コード
（大半は hover 時のみで通常時は bg-surface で PASS）。スコープを膨らませないため
本PRでは扱わず、別タスクとして切り出し済み。

## レビュー

auto-review-loop 2R。R1=needs_changes(should_fix 3件・上記コントラスト)、R2=pass。
effort=high(auth/パスを含むため)、累計187,283トークン。詳細は auto-review-round-pr333。
CI は pending のままマージ（v0.9.0 方針。赤になったら追修正）。
