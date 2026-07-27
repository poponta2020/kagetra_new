---
name: fix-pr377
description: fix PR #377
type: project
---

PR #377 の Codex r2/r3 指摘と advisor 指摘の修正（r1 は [[fix-pr377]] に記録済み。同一ファイルに追記）。

## r2 (needs_changes: blocker 1 / should_fix 1)
- **blocker** `releaseChannel` の競合検出トークンが代表イベント id だった。イベント0件のグループ
  （付け替えで空になったが紐付けは残る仕様）では代表イベントが無くトークンが null に落ち、
  競合検出のない broad release 経路に化けていた。→ トークンを `entry_group_id` に変更。
  ★自分の r1 修正が新しく到達可能にした状態が、既存の競合対策の前提を壊した例。
- should_fix `line-webhook-handler` の紐付け完了 reply で表示名導出不能時のフォールバックが
  id 昇順先頭 → **代表イベント**のタイトルへ。

## advisor 指摘（Codex が見落とした2件）
- `entry-overdue-alert` の日別ラベルを「超過対象日の件数」で判定していたため、表示名と URL を
  グループ全体基準に変えた結果、対象日1件のとき本文から「どの日が超過か」が消え、代表 URL が
  非対象日を指すだけになっていた。→ グループ全体の件数で判定。
- `propagateFieldsToGroup` も同じ一括 UPDATE のロック順問題。→ `lockEventRowsAscending` を
  entry-groups.ts へ一本化し両経路で使う（tx は DbLike に代入可能で typecheck 通過）。

## r3 (needs_changes: blocker 2 / should_fix 1)
- **blocker** `loadActiveBinding` / `loadLinkedBinding` の「グループ解決 → binding 取得」2文を
  1文の JOIN に統合。2文の間に付け替えが commit されると旧グループの LINE へ誤配信し得た。
- should_fix 申込管理ボードのグループ名・代表イベントを表示対象（今日以降・非cancelled・
  individual）ではなくグループ全体から導出。
- **blocker(誤検出)** 「_journal.json が 0044 までで新 migration が本番で実行されない」→ 実際は
  0045〜0049 まで登録済み・snapshot もコミット済み（b763105）。**レビュー差分から
  `packages/shared/drizzle/meta` を除外していたため**の誤認。★入力上限 1,048,576 文字を
  超えると codex exec が `input_too_large` で即死するので、40k行級の差分では meta の
  snapshot（836KB）を除外する必要がある。ただし `_journal.json` 自体は小さいので**次回は
  snapshot だけ除外**して journal はレビュー対象に残す。

## CI 赤（自分の修正が起因）
line-broadcast.test.ts の手書き `resetDb` が `entry_groups` を消す前に名簿を消していないため、
CI で13テストが FK 違反で全滅（ローカルは実行順の違いで露出せず）。名簿の帰属が
events(cascade) → entry_groups(**RESTRICT**) に変わったので、events を消してもグループに
追従しない。→ `tournament_entry_roster_entries` → `tournament_entry_rosters` を先に削除。
検証: テスト DB に名簿行を1件残して当該ファイルを実行し、修正前 fail・修正後 13 passed。

## migration journal 経路のリハーサル（新規実施）
空 DB に `apply-migrations.sh` と同じ journal 順で全50件を適用 → 全件成功。
entry_group_id が3表で NOT NULL / FK は RESTRICT×3・SET NULL×1 / UNIQUE×3 /
旧 event_id 列は0件を確認（kagetra_migjournal on kagetra-db-test）。
※ 従来の kagetra_migtest は psql 直実行だったので journal 経路は未検証だった。

## 既知の受容事項
イベント0件のまま残ったグループの名簿は、下流集計の
`EXISTS (events e WHERE e.entry_group_id = ... AND e.edition_id = ...)` に現れない
（グループにイベントが無いため）。本番の名簿は0件、かつ §3.2.6 が「名簿は移動元に残る」と
定めているので**この挙動を受容**する。将来バグとして再発見しないための記録。

commits: 5bd8533(r1) / eb40662(docs) / a5465a9(r2+advisor) / 77fb7c6(CI) / 6be1725(r3)
