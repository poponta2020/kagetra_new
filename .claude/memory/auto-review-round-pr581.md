---
name: auto-review-round-pr581
description: auto-review PR #581
type: project
---

# auto-review PR #581（attachment-open-download）

対象: [Change] 添付ファイルに「開く・保存」導線を追加し Excel のページ画像プレビューを廃止。ブランチ `feature/attachment-open-download`。

## R1 — phase=initial / gpt-5.6-sol / effort=medium（サイズ起因 high を sol 較正で一段下げ）
- verdict=**needs_changes** / blockers 1 / should_fix 0 / nits 0 / tokens 137,586
- blocker: `OpenSaveButton.tsx` に共有・ダウンロード両方が失敗したときの最終フォールバックが無い。3ビューアから「元ファイル」リンクを撤去しているため原本への経路がゼロになる。
- ★**要件 §4.4 に自分で書いた境界条件の実装漏れ**（新規の設計判断ではないので即修正）。修正 `3c43dcd`: download 非対応環境は blob 経路を試さず `unsupported` へ、error/unsupported の両方で「元ファイルを直接開く」リンク。AC-9c 追加・design-spec §5 追記・テスト3本追加。

## R2 — phase=delta / gpt-5.6-terra / effort=medium
- verdict=**pass** / 0/0/0 / tokens 94,340。前回 blocker の解消を確認。

## R3（1回目）— phase=final
- `codex exec` が ChatGPT 側クォータ枯渇（`You have hit your usage limit`）で exit 1。結果 JSON は生成されず削除。tokens 145,401 を消費。約30分後に回復し再実行。

## R3（再実行）— phase=final / gpt-5.6-sol / effort=medium
- verdict=**needs_changes** / blockers 1 / should_fix 0 / nits 0 / tokens 162,050
- blocker: `supportsAnchorDownload()` はプロパティの存在だけを見るため、**`download` を持っているのに無視するブラウザ（LINE アプリ内ブラウザ等）**を「対応済み」と誤判定する。blob クリックが無反応でも成功扱いで idle に戻り、フォールバックリンクが出ない。`download` の実効性は原理的に検出できないため、修正するならリンクを先に出すしかない（PC でも常時1要素増える）。
- → **ユーザー判断で見送り（WONTFIX）**。修正対象として残る blockers 0 件で final を成功として抜けた（`codex-result-pr581-r4.json` に `verdict=cutoff` / `reason=user-wontfix` を記録）。

## WONTFIX（以降のラウンドで再掲禁止）
- `apps/web/src/components/attachment/OpenSaveButton.tsx` — download 属性を無視する環境を対応済みと誤判定する — ユーザー判断で見送り（該当は共有シートが無く かつ download が無視される環境に限られ、常時リンクを出す UI コストに見合わないため）

## 結果
verdict=cutoff（user-wontfix）。累計トークン 393,976 / 500,000（+ クォータ失敗分 145,401）。
**auto-ship は中断** — CI の `Lint / Typecheck / Test` が **15分のジョブ上限で cancelled**（アサーション失敗ではない。Lint ✓ / Typecheck ✓ / Vitest が 13分44秒で切断）。★同ブランチの1つ前のコミット `8d5b62f` では Vitest が **7分01秒で完走**しており、最後の修正コミットが実行時間を倍にした疑いがあるため調査中。

レビュー対象外（既定除外）: docs/ 配下10ファイル。
