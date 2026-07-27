---
name: impl-entry-board-round13
description: entry-management round 13 実装
type: project
---

entry-management round 13（区画名の改称・1グループ1行化・ビジュアル移植）を実装。worktree=C:/tmp/impl-entry-board-round13、ブランチ=feature/entry-board-round13（既存 feature/entry-management は main にマージ済みで古かったため main から切り直した）。

タスク1(#394, main直): AREAS.label を3件改称（AreaId・判定条件・並び順キーは不変）。dayStatusLabel / commonDeadlineBadge を削除。pickRepresentativeDay / groupDeadlineBadge / groupAttendCount を追加し、groupSortKey も pickRepresentativeDay 経由へ統一（並び順キーと表示日付が同じ日から出ることを構造で保証=AC-37）。EntryBoardItem.groupDisplayName を追加。displayName の引数型を NameSource へ広げ、page.tsx が同じ関数で通称ベース名を作れるようにした（AC-16b を構造で保証）。
★sortGroupsInArea の副キーは minEventDate のまま維持（代表日の開催日へ寄せると AC-15 の並び順が静かに変わる。回帰テストで固定）。

タスク2(#395, task-implementer/sonnet): groupMemberRows クエリに short_name(edition→series の leftJoin 2段)と eligible_grades を追加し、通称ベース名→deriveEntryGroupName→groupName フォールバックの3段で groupDisplayName を導出。受け入れ確認OK（コメントの母集団表記だけ main が修正）。

タスク3(#396, task-implementer/sonnet): EntryGroupCard/EntryGroupDayRow/EntryRow を EntryGroupRow へ統合。見出し明朝15px bold/藍/字間.03em、面を常時 bg-surface、玉を見出し行内へ(-ml-[22px]・常に13px)、レールを1本のflex線+先頭 pt-[13.5px]、divide-y 撤去、0件は行動フェーズでもグレー。受け入れ確認OK。

タスク4(#397, main): 忠実度11項目をコード照合。grep 3種OK。

★Wave編成: Wave1=タスク1単独(共有ホットスポット)、Wave2=タスク2+3並行(page.tsx系とEntryBoardClient系で完全直交)、Wave3=タスク4。排他宣言のミスは無し。
★計画の漏れ: 実装手順書の申し送りは「赤くなる既存テスト」に entry-board-utils.test.ts と EntryBoardClient.test.tsx しか挙げていなかったが、実際は page.test.tsx も旧区画名を4テストで参照しており赤くなった（main がバリアで修正）。改称タスクでは同一ディレクトリの全テストを対象に数えるべき。
★ローカル実測は断念: in-app Browser は file:// を CSP付きスナップショット化して JS 実行不可、localhost の任意ポートも policy でブロック。launch.json 未登録のポートは navigate できない。ユーザー判断で実画面確認は本番でまとめて行う方針にした。

検証: entries 3ファイル 136 tests green / pnpm check-types green / pnpm lint green。
