---
name: ship-event-list-sticky-month-default-sort
description: 月見出し sticky＋既定ソート開催日順 出荷
type: project
---

**PR #402** — fix(events): 月見出しをスクロール追従させ、既定ソートを開催日順にする
https://github.com/poponta2020/kagetra_new/pull/402 — **merged**（merge commit 2b7c991・2026-07-28）。対応 Issue なし（PR #401 出荷後のユーザー要望・/quickfix 経由）。

**出荷内容**（[PR #401](project_ship-event-list-month-grouping.md) の直後の追加要望2件）:
1. **月見出しの sticky 追従** — MonthHeading に `sticky top-0 z-[2] bg-canvas pt-2`。スクロールコンテナは MobileShell の `<main>` で**上部バーが無いのでオフセット不要**。sticky は親 `<section>` の範囲で効くため次の月が来ると前月見出しが押し出される。`pt-2`（貼り付き時に月数字が上端へ密着しないための余白）とセットでラッパーの gap を 14px→6px に下げ、セクション間の見た目の間隔 14px を据え置いた（**片方だけ変えない**）
2. **既定ソートを締切日順→開催日順** — 初期表示が月区切りビューになる

**★既定ソート変更でテストが壊れる型（次に既定を触るとき必ず踏む）**:
- 締切日順を前提にしたテスト（AC-10 の上段 DOM 順・月見出しの非表示・大会名の一律太字）は明示的なタブ切り替えが要る
- **より嵌まったのはこちら**: 開催日順では行頭の**日付ブロックの日数字**が描画されるため、`within(row).getByText('1')` が「あと1日」の締切数字や参加人数「1名」と衝突して `Found multiple elements` になる。フィクスチャの eventDate を日数字がかぶらない日（例 2026-08-20）へずらして解消した。**行内で数字を getByText する既存テストは既定ビューを変えると壊れる**

**JSX の落とし穴**: 三項分岐の `) : cond ? (` 直下に `{/* comment */}` を置くと式が2つになり `Expected ")" but found "className"` でトランスフォームが落ちる。コメントは要素の中へ入れる。

**レビュー**: /auto-review-loop 1R で収束（initial・gpt-5.6-sol・effort=low ※rubric medium から sol 較正で一段下げ）。**verdict=pass・指摘ゼロ・修正コミットなし**、71,948 tokens。未確認差分なし。

**残 DoD**: 本番実機確認。特に **sticky の実スクロール挙動は未確認**（jsdom では position:sticky を再現できずテストはクラス付与の検証のみ）。同型の SensekiTimeline 年見出しが本番稼働中で、ancestor に sticky を壊す overflow が無いことはコードで確認済み。

**出荷時の詰まりどころ（PR #401 と同一・再発）**: ship-finalize.sh が `merged=already` を返してリモートブランチを消さない → `git push --delete` が要る。worktree 削除も失敗し `.git` だけ消えた半端な状態になる → 残骸は node_modules の深いパスで Remove-Item が MAX_PATH に当たるため **reparse point 0 件を確認してから robocopy /MIR で空ディレクトリをミラー**して削除。**2回連続で踏んだので、この2つは ship の定型後処理として見込んでおく**。
