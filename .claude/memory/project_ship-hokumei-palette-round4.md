---
name: ship-hokumei-palette-round4
description: 北溟配色 round 4: 地と枠線の彩度を 0.375 倍へ落とす
type: project
---

**PR #661** — 北溟配色 round 4: 地と枠線の彩度を 0.375 倍へ落とす
URL: https://github.com/poponta2020/kagetra_new/pull/661
マージ: **成功**（merge commit b19e84a・2026-09-23。CI `Lint / Typecheck / Test` は **pending のままマージ**＝CI 待ちをしない方針 v0.9.0。赤になったら /quickfix で追修正）
クローズした Issue: なし（UI リデザインのため design-spec が要件成果物。requirements.md・GitHub Issue は作らない方式）

## 変更
面と枠線のラダー 5 トークン（`canvas`・`surface-alt`・`border-soft`・`border`・`border-strong`）の OKLCH **彩度だけ**を 0.375 倍。canvas `#d3eafa` → `#dfe8ed`（彩度 0.033 → 0.012）。明度・色相・他の全トークン・className は不変。

- `apps/web/src/app/globals.css`（@theme + :root の 2 系統で値 10 行 + コメント）／`globals-tokens.test.ts`／`layout.tsx`（themeColor）
- `docs/design/colors_and_type.css`・`ui_kits/kagetra-mobile/palette.css`・`design.md`（地の呼称を「水色」→「水色鼠」）
- コミット: 7f0ae01（round4 docs 取込）/ 7160b17（タスク1）/ 4fd6969（タスク2）/ 5729c0e（実測値コメント追随）

## レビュー（auto-review-loop）
1 ラウンド（initial のみ・final 省略）・verdict=**pass**・blockers 0 / should_fix 0 / nits 0・model gpt-5.6-sol・effort low（ルーブリック medium → initial の sol 較正で一段下げ）・累計 21,302 / 500,000 tokens。**打ち切りなし・WONTFIX なし・「修正したが再レビューしていない指摘」なし**

★**docs/ 配下は review-diff.sh の既定除外でレビュー対象外**だった（正典 globals.css の写し 3 ファイルの同期＝タスク2 は Codex を通っていない）。値の一致は `git grep` で A1 の 5 hex が 0 件であることを確認済み

## DoD
全項目 PASS（A1〜A3 は CI 実行中のため SKIP＝CI 委譲、A4 は WARN＝ローカル HEAD が PR HEAD と異なるが A 項目が全て CI 委譲のため影響なし）

## ★残 DoD（本番 375px の実機確認。未確認）
design-spec §7「round 4 の実画面確認」の 5 項目:
1. 地の青みが淡くなりすぎて「冷たい灰」に見えて寂しくないか → 調整先は案2 `#dde8f0`（palette-check.mjs の `LADDER_CHROMA` を 0.5 へ）。**どちらへ動かすにせよ明度は据え置く**
2. 背景テクスチャ（opacity 0.05）が汚れて見えないか
3. 藍みの影が浮いて見えないか
4. `surface-alt` の上の neutral / info の地（メール取込の下書きカードの状態ピル、`admin/members` の種別バッジ）が読めるか → 輪郭が溶けるのは design-spec §2.1 で想定済み・§10 で Non-goal
5. PWA のステータスバー色が地と揃っているか（反映には PWA の再追加が要ることがある）

関連: [[impl-hokumei-palette-round4]] [[auto-review-round-pr661]] [[project-kagetra-color-tokens]]
