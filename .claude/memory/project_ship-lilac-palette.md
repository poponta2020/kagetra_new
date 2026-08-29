---
name: ship-lilac-palette
description: 配色を藤色基調へ刷新し立体感を導入
type: project
---

PR #550 「feat(design): 配色を藤色基調へ刷新し、立体感（elevation）を導入」
https://github.com/poponta2020/kagetra_new/pull/550
マージ: 成功（merge commit 9f5a539・2026-08-29）。CI は **pending のままマージ**（CI 待ちはしない方針。赤なら追修正）。
クローズした Issue: なし（UI リデザインのため design-spec が要件成果物。/define-feature を回していないので Issue を作っていない）
正典: docs/features/lilac-palette/design-spec.md

## 何を出したか

アプリ名が「ライラック」になるのに合わせた配色の全面刷新（和紙 × 藍墨 → 藤 × 墨）と立体感の付与。9 コミット・13 ファイル・784 行追加。

**中心的な判断**: 「ライラック」を**西洋 lilac（OKLCH 色相 326° = 赤紫）ではなく和の藤色 290° / 菫色 297° / 紫苑 295° として読む**。軸は色相 295°。design.md の「百人一首＝古典的だから和紙×墨」という論の**中**に収まるため、名前の駄洒落ではなく設計として説明できる。

★**「地味・のっぺり」は測定できる状態だった**: 面と文字を作る 14 トークンの色相が全て 80–92° の 1 系統・カード↔背景 ΔL 0.024・ピル地↔背景 ΔL 0.009・**Card プリミティブに影ゼロ**・ink-meta が canvas / surface-alt 上で AA 未達（4.35 / 4.16）。この診断のおかげで名前が確定しなくても変更を単独で正当化できた。

- 配色: brand は旧・藍の OKLCH **L と C を保ち色相だけ 261° → 293°**（コントラスト比がほぼ完全に維持される）。**warn を danger から分離し琥珀 #b17915 を新設**（旧配色では両者が完全に同じ hex で「締切まで3日」も「送信エラー」も同じ赤だった）。ink-meta の明度を下げ 3 面すべて AA 達成 → 「surface-alt の上では neutral-fg を使う」という**旧制約が消滅**
- 立体感: 高度 3 段（段1=Card / 段2=ボトムナビ上向き / 段3=シート）。**2 層で書く**。canvas が暗くなった分**影の alpha を引き上げた**。背景に微細テクスチャ（feTurbulence）
- 据置: 朱 accent・LINE 緑・--kg-nonattend・純白の例外 6 箇所・bg-black/40

## 実装中に計画から変えた 2 点

1. **段 2 の「下向き」は作らなかった** — シェルに sticky ヘッダが存在しない（AppBar は nav-settings-hub で廃止済み）。ページ側の `sticky top-0` は 10 箇所実在するが z-index の事情が箇所ごとに異なり一律適用は PR #529 級のリスクなので Non-goals とし、適用先を失った `--shadow-md` は削除
2. **shadow-sm 14 箇所のうち冗長だったのは 1 箇所のみ** — 残り 13 箇所は Card を使わず素の section / form に手書きしている独立要素

## レビュー

Codex 1R(i) = **pass**、blockers 0 / should_fix 0 / nits 0、effort=medium（review-effort.sh は 458 行 > 400 で high を返したがサイズ起因のため sol 較正で一段下げ）、135,750 / 500,000 トークン。**修正コミットゼロ・WONTFIX ゼロ**。再レビューせずに修正した指摘は無い。

★Codex は静的読解にとどまらず**実際に pnpm 経由で tailwind-merge を実行**し、Card の基底スタイル上書き（border-warn-fg/30 が border-border-soft を置換）を検証したうえで pass を出した。

## ★残 DoD（実機確認）

影・テクスチャは純粋な描画のため jsdom で検証できず、**ローカルテストは 1 件も未実行**（worktree に node_modules が無く Tailwind の実コンパイル照合も不可。PR #532 と同じ状況）。消化手順: 出荷後に本番 https://new.hokudaicarta.com を iPhone で開き、

1. カードが背景から浮いて見えるか（段1の影）
2. ボトムナビの上向き影でコンテンツが潜って見えるか
3. 背景の微細ノイズの濃度（opacity 0.05）が適切か・強すぎないか
4. テクスチャがスクロールせず固定されているか（.mobile-shell-h に置いた判断の検証）
5. --kg-nonattend（暖色ピンク）が藤色の面の上で意図的に見えるか
6. PWA / ブラウザ UI のテーマ色（themeColor #e8e6f2）

を確認する。ノイズ濃度は実機を見て調整する前提。

## 検証済み（静的）

旧配色 hex の残存 0 件（3 ファイル）／var() の未定義参照 0 件（colors_and_type.css で --kg-shadow-md の未定義参照を 1 件検出し shadow-lg へ修正）／削除した shadow-md・shadow-fab のユーティリティ使用 0 件（Tailwind v4 の組み込みデフォルトへフォールバックしない）／--color-warn 新設前に裸の warn 参照 0 件／success==brand・danger==accent の同値維持と warn!=danger の分離と neutral-bg!=brand-bg の弁別／据置対象の差分ゼロ
