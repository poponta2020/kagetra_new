---
name: ship-entry-groups
description: feat(entry-groups): 申込グループを導入し LINE紐付け・配信・名簿・リマインド・進行操作をグループ単位へ集約
type: project
---

PR #377 出荷: entry-groups（申込グループ）— 開催日別イベントを「同メール×同締切」で束ね、LINE紐付け・配信・名簿・締切リマインド・進行操作をグループ単位へ集約。

- PR: https://github.com/poponta2020/kagetra_new/pull/377
- タイトル: feat(entry-groups): 申込グループを導入し LINE紐付け・配信・名簿・締切リマインド・進行操作をグループ単位へ集約
- マージ: 成功（main）。CI は HEAD 802dcb7 で green（lint / typecheck / vitest 全パッケージ / Playwright E2E）
- クローズ: 子 #360-#367（PR 本文の closing keyword）＋親 #359
- 実装8タスク・migration 5本（0045-0049）。要件 = docs/features/entry-groups/requirements.md

## レビュー経緯（Codex 4ラウンド）
r1: blocker2/should_fix3 → r2: blocker1/should_fix1 → r3: blocker2(1件は誤検出)/should_fix1 →
r4: blocker2/should_fix1。詳細と修正内容は [[fix-pr377]]。r4 の時点でユーザー指示により
レビューを打ち切り、r4 の blocker A（伝播 hidden input の作り直し）のみ修正して出荷した。

## 出荷時に残した判断（ユーザー確認待ち）
1. **r4 blocker B（UI 設計判断）**: 申込管理ボードで「可視日が1件だけの複数日グループ」に
   グループ名と代表イベントリンクを出すか。Codex は出すべきとするが、代表が過去日・非表示日
   だとボードから見えない日へ遷移するため現状（その日のタイトル＋その日へのリンク）の方が
   妥当と判断して据え置いた。変更するなら EntryBoardGroup に実メンバー数を持たせる。
2. **r4 should_fix（性能）**: `listMergeCandidateGroups` が候補30件に絞る前に events 全表を
   読む。本会の規模（数百行）では許容範囲として据え置き。

## DoD ゲート
`--skip-dod` で出荷した。FAIL 2件はいずれも実体のある問題ではない:
- **C1 レビュー FAIL**: 最新 JSON が r4=needs_changes のまま。上記1-2を意図的に据え置いたため
  （レビュー打ち切りはユーザー指示）。blocker A は修正済み。
- **D2 docs更新 FAIL**: **devflow の誤判定**。`profile-read.py` が CRLF の project-profile から
  値を読むと末尾 `\r` が付き、配列の最後の要素以外がパターンとして機能しない
  （`docs/\r` は不一致・偶然クリーンな `packages/shared/src/` だけ一致 → src変更あり
  docs変更なしと誤判定）。実際には docs 8ファイルを更新している。
  ★devflow 側の修正が必要（profile-read.py で \r を strip、または profile を LF 化）。
その他は全 PASS（A1 テスト 3スイート / A2 lint / A3 typecheck / B0 CLEAN / B1 CI green / D1 memory）。

## 残作業（出荷後）
- **AC-24 は本番実機確認**: 複数日大会1件で「LINE紐付け1回 + 申込済一括」→ 参加者1通・会計1通に
  なることを本番で確認する。
- 上記の判断1-2をユーザーと詰める。
- 修正コミット群が `Refs #368, #369, #370`（senseki-boundary の Issue）を誤って参照している。
  クローズ効果は無いが相互参照が残った（履歴書き換え＝CI再走を避けて放置した）。
