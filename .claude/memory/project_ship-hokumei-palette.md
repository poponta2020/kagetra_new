---
name: ship-hokumei-palette
description: 北溟配色（白波 × 紺）への刷新
type: project
---

# 北溟配色（白波 × 紺）出荷 — PR #648

- **PR**: PR #648 feat(design): 配色を藤 × 墨から白波 × 紺へ刷新する（hokumei-palette） https://github.com/poponta2020/kagetra_new/pull/648
- **マージ**: 成功（merge commit d805fdd・2026-09-21）。CI は pending のままマージ（CI 待ちしない方針）。赤になったら追修正
- **Issue**: なし（UI リデザインのため design-spec が要件成果物）
- **レビュー**: auto-review-loop 1R（initial）で verdict=pass・blockers/should_fix/nits すべて 0・gpt-5.6-sol effort=medium（694 行で上限丸め）・累計 81,877/500,000 トークン・再レビューせずに修正した指摘なし・WONTFIX なし
- **DoD**: gate-dod 全項目 PASS（A1-A3 は CI 委譲で SKIP）

## 出荷内容
globals.css の @theme / :root を A1 白波へ（surface #ffffff・canvas #d3eafa・brand #15387d）。globals-tokens.test.ts 新設。themeColor・LINE Flex（メールバッジ・オープンチャットのボタン）・統計の級トーンを追随。design.md（純白禁止の撤回）・colors_and_type.css・UI kit palette.css・docs/spec を同期

## ★残 DoD（本番の実画面確認・未確認）
デプロイ後に本番（new.hokudaicarta.com）の 375px で確認する:
1. 地の水色の強さ（強すぎ/物足りない → 調整先は A2 の #c6e8fc。動かすなら surface-alt 以下も一緒に）
2. 純白カード上の影が過剰でないか（過剰なら alpha を下げる）
3. 背景テクスチャ（opacity 0.05）の見え方
4. 出欠バーの --kg-nonattend が水色の面の上で意図的に見えるか
5. LINE トーク上の Flex（メールカードのバッジ・オープンチャットのボタン）の紺
ほか: PWA は themeColor が変わるので再追加で反映されることがある

関連: [[feature-def-hokumei-palette]] / [[impl-hokumei-palette]] / [[auto-review-round-pr648]] / [[project-kagetra-color-tokens]]
