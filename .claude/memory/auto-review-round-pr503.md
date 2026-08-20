---
name: auto-review-round-pr503
description: auto-review PR #503
type: project
---

PR #503 (entry-group-page) の Codex 自動レビュー記録。

## R1 — initial / gpt-5.6-sol / effort=high
- 差分 6,946行 / 44ファイル（docs 3ファイルは既定除外）
- effort: review-effort.sh は「差分 6946 行 > 400」でサイズ起因の high と判定。sol 較正では
  サイズ起因 high は medium へ落とす規則だが、**変更に LINE 一斉配信パス
  （LineBroadcastSection / GradeBroadcastSection）が含まれる**ため profile の高リスクパス起因として
  high を維持した
- verdict=needs_changes / blockers 3 / should_fix 0 / nits 0
- good_points: (1) /events/[id]/edit で共通8キーを rest 分割で UPDATE 対象から除外し null 上書きを
  防いでいる (2) 一括通知が id 昇順ロック＋同一tx claim＋新規claim分のみ1通集約の構造になっている

## ★blockers 3件 → 全件ユーザー判断で見送り（WONTFIX）
1. admin/entries/[groupId]/page.tsx — 団体戦グループでも名簿の個人情報（選手名・所属）が
   RSC payload へ載る（RosterSection は client component で、team なら null を返すが props は
   直列化済み）。→ 見送り: 団体戦グループに名簿行が存在する運用が現状無いため実害が
   顕在化しない、という判断。★ただし調査した限り **kind='individual' のガードは表示層
   （RosterSection）にあり、取込層（roster-import の materialize）には無い** ——
   団体戦イベントに紐づく名簿メールを承認すれば構造的には行が入りうる。「経路が無い」のは
   運用上の話であって不変条件ではない。同じ構造は日ページ /events/[id] にも前からあり
   （本PRの範囲外）。team に名簿を持たせる改修が入るならここが穴になる
2. admin/entries/[groupId]/actions.ts — 共通項目保存が last-write-wins で、管理者2人が同時に
   別項目を保存すると片方が巻き戻る。→ 見送り: 身内アプリで同時編集が想定しにくく、既存の
   /events/[id]/edit も同じ semantics。CAS はこのコードベースに前例が無く再読み込み UI も要る
3. admin/entries/[groupId]/actions.ts — 保存対象イベントの列挙後に別イベントが合流すると
   その日だけ共通項目が古いまま残る。→ 見送り: 食い違いはグループページが朱で
   「（日により異なる）」と可視化し「編集して揃える」で自己修復できる

## CI（ローカルで vitest を1件も回せなかったため CI が初回検証）
初回 run で 7件失敗 / 3176 passed。すべてテスト側の誤りでプロダクションコードは無変更:
- page.test.tsx ×3: グループページは大会名がパンくず・見出し・日程表の3箇所に出るため
  素の getByText が多重マッチで throw。日程表の行へ within でスコープ。フロー帯の有無は
  「会内締切」では判定不能（進行管理・共通項目の th にも出る）→「開催」をアンカーに変更
- group-entry-flow ×1: 杉並AB の検算フィクスチャが既定の未来日 lotteryDate を使っており
  抽選が未完了＝現在地が payment にならなかった。本番同様 8/16（過去）にした
- group-common-fields ×2: 「今日より前」とコメントした日付が実際は TODAY より後だった
- send-entry-overdue-alert ×1: AC-31 の URL 変更の更新漏れ（src/lib 側は更新済み）

修正コミット 9596136 を push。この修正差分は再レビューしていない（3-d の打ち切り規則。
テスト専用の変更で、確認は CI に委ねる）。

## 結果
- 最終 verdict: cutoff（reason=user-wontfix。r2.json）
- 修正対象として残った blockers 0 / should_fix 0 / nits 0
- ラウンド構成: initial 1 のみ（delta / final は不要）
- reviewed_head=2be0d1b / fixed_head=9596136
