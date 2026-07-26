---
name: ship-event-list-redesign
description: 大会申込一覧リデザイン 出荷
type: project
---

# 大会申込一覧リデザイン 出荷（PR #345）

PR: https://github.com/poponta2020/kagetra_new/pull/345
`feat(events): 大会申込一覧のリデザイン（締切済の非表示・参加者表示の刷新・参加可否の色帯）`
実装の詳細・Wave 構成・設計判断は [[impl-event-list-redesign]]。

## 出荷内容
`/events` を「自分が出られる大会を締切順に流し見できる」画面へ。
- 締切済（`internalDeadline < 今日(JST)`）を一覧から除外。**自分が attend=true の行だけ例外的に残す**（申込確認の導線を一覧に維持）。締切当日・締切未設定は従来どおり表示
- 除外はサーバー母集団条件ではなくクライアント表示フィルタ。適用順は 可視判定 → 申込可能フィルタ → ソート
- 参加者: 0名は meta 行ごと非表示。1名以上は人数（藍）＋苗字を「・」区切りで全員表示（CHIP_LIMIT・「他N名」撤廃）
- 行左端に 3px 色帯（`isOpenForEntry` = canApply && 未中止 && 締切内 で藍/砂）
- 上段を 大会名 → 日付 → 締切 に入替え、締切は数字だけ拡大、朱の塗りピルは当日のみ
- ページ余白 16px は `/events` の page.tsx で完結（`mobile-shell.tsx` は不変・回帰テストで固定）

コミット: d2e4bc6 / aeb4900 / 1be76cb / 7a1e082

## クローズした Issue
親 #340、子 #341 #342 #343 #344（PR 本文の closing keyword によりマージ時）

## レビュー・検証
- auto-review-loop: **1R で pass**（effort=high・差分964行で自動判定／blockers 0・should_fix 0・nits 0・累計 143,996 tokens）
- web 全テスト 119 files / 1616 passed / 1 skipped、check-types・lint 全パッケージ green
- CI は最終的に green を確認してマージ（gate-dod 再実行時に全チェック green）

## 残 DoD（出荷後に本番で確認する）
**AC-15 の忠実度チェックリスト10項目目のみ未消化**: 「375px で横スクロールが発生しない・長い大会名が省略記号で切れる」。確定モックに長いタイトルを注入して実測（`.main`/`.row` とも scrollWidth===clientWidth・タイトルは省略）したが、**React ツリーでの実測は未実施**。worktree から dev サーバーを起動すると worktree 削除が Device busy になるため見送った。
→ **消化手順**: 本番 `https://new.hokudaicarta.com/events` を 375px 幅で開き、(1) 横スクロールが出ないこと (2) 長い大会名が「…」で切れること (3) 色帯・締切の当日ピル・参加者の全員表示が意図どおりであること を確認する。

## gate-dod で踏んだこと
初回実行で A1（`pnpm --filter=@kagetra/web test`）が FAIL したが、**同じコマンドを手動で再実行すると green**（119 files / 1590 passed）。profile が記録しているテスト DB 競合系の一過性失敗と判断して再実行で通した。gate-dod の A1 はメイン作業ディレクトリ（＝`main` ブランチ）で走るため、PR の変更を含まない点にも注意。
