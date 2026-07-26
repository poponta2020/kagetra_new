---
name: auto-review-round-pr376
description: auto-review PR #376
type: project
---

PR #376（event-detail-redesign）の Codex 自動レビュー。**3ラウンドで pass**。effort は全ラウンド high（差分 5519→6280 行 > 400 で自動判定）。累計トークンは stderr がバイナリ化していて抽出できず未計測（上限 5,000,000 指定・実運用上は無関係）。

## R1 verdict=needs_changes（blocker 0 / should_fix 4）
1. **DisclosureRow の `group-open:` が入れ子で誤表示** — Tailwind の `group-open:` は「開いている**任意の** `.group` 祖先」に一致する。外側 DisclosureSection を開くと中の**閉じた** DisclosureRow・名簿行のマーカーまで ▾ になっていた → 直接子セレクタ `[&[open]>summary]:before:content-['▾']` を details 側に付ける方式へ変更（group クラス自体を撤去）
2. **完全失敗が「部分失敗」と表示** — 配信履歴 aux で failed と partial を合算していた → 分けて出し分け
3. **RSC payload 検査ヘルパーが浅かった** — React 要素の `props` しか再帰せず、`binding`/`history` 等のネストした素オブジェクトを見ていなかった（AC-28 の偽陰性）→ プレーンオブジェクトも循環防止つきで再帰
4. **★テストファイルに実バイトの NUL が 2 箇所混入** — `git diff --numstat` が `- -`（Binary files differ）になり GitHub 差分で権限テストが読めない状態だった。`propValues.join(' ')` の空白が NUL になっていた

## R2 verdict=needs_changes（blocker 3件・すべて実バグ）
1. **★名簿の内部列が一般会員の RSC payload へ載っていた（情報漏洩）** — `RosterSection` を client component 化したので `event.rosters` がブラウザへ直列化されるが、relational query に `columns` 指定が無く `note`(管理メモ)/`approvedByUserId`/`source_*`(取込元メール・添付)/`rawKana`/`rawDan`/`selectionOutcome`(抽選結果) まで含まれていた。**TypeScript の型（RosterView）は実行時に余剰プロパティを落とさないので型では防げない**
2. **大会側が未連携だと級別グループ配信が消える（機能回帰）** — `GradeBroadcastSection` を `status === 'linked'` 分岐の中に置いていた。級別配信は「会員全体への周知」の別系統で紐付けは**常設**なので、大会参加者グループの連携状態とは独立に描画すべき
3. **名簿ゼロ件で AC-21 の指定文言に到達できない** — `rosters.length === 0` で早期 return していた（自分が task4 のプロンプトで指示した仕様が AC と衝突していた）

## R3 verdict=**pass**（blocker 0 / should_fix 0 / nit 1）
nit = 名簿ゼロ件の挙動変更でコメントが古くなっていた点。修正のみ行い**確認ラウンドは追加しない**（v0.8.0 の収束規約）。

## 学び
- **client component 化は「型で絞った」だけでは payload を絞れない。** DB クエリの `columns` か明示 DTO で落とす必要がある。Server Component から client component へ変える差分では毎回この観点を確認する
- **Tailwind の `group-open:` は入れ子で破綻する。** `<details>` を入れ子にする UI では直接子セレクタを使う
- **既存機能を別セクションへ「移設」するときは、移設先の条件分岐に巻き込まれていないかを見る**（級別配信が linked 分岐に入ってしまった）
- Codex high は UI リデザインでも実バグを拾う。特に「型では防げない実行時の情報漏洩」の検出は価値が高かった

## 検証
最終 HEAD 3123bd7 で **Vitest 129 files / 1776 passed / 1 skipped**・check-types clean・eslint clean。

## R4 verdict=pass（blocker 0 / should_fix 0 / nit 0）— クリーンパス
R3 pass 後に**E2E の更新をコミットした**ため、最終 HEAD で1ラウンド追加した。

### ★R3 pass 後に自力で見つけた CI 破壊（Codex は差分にE2Eが無かったので指摘不可能）
`gh pr checks` が pending だったので出荷前に E2E の対象範囲を確認したところ、
**event-lifecycle.spec.ts / event-line-broadcast.spec.ts が確実に赤になる**状態だった:
- 運営操作が `<details>` 既定=閉になり、`申込済にする` / `LINE 配信を有効化` が not visible → click がタイムアウト
- 廃止した表示に対する assertion が残存（`通知は送られません` / `進行状況` バッジ / 詳細表の `抽選日` 行 / 生ISO `2026-01-20`）

→ E2E を新 UI へ更新（summary を開くヘルパー追加・検証を summary の現在値へ・
廃止表示は「出ないこと」へ反転）。ローカルで event-lifecycle 5件 +
event-line-broadcast 2件 + grade-update 1件 = **8件 pass** を確認してから push。

**教訓: レビューループの差分から docs を除外しているのと同様、E2E は「変更していない」
から差分に出ないだけで、UI を作り替えたら壊れる。Codex pass ≠ CI green。
UI の構造変更（特に既定=閉のトグル化）では、出荷前に E2E の対象範囲を必ず自分で見る。**
前回 PR #351 も同じ形（Codex pass 後に E2E で CI 赤）で踏んでおり、再発。
