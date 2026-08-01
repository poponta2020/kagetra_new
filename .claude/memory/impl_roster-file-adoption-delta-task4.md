---
name: impl-roster-file-adoption-delta-task4
description: roster-file-adoption 改修 タスク4
type: project
---

roster-file-adoption 2026-08-01 改修（親 #433）の Wave 3 = タスク4（#437・main 直実装）。worktree=C:/tmp/impl-roster-file-adoption。

**やったこと**: メール詳細 `mail/[id]/page.tsx` の `loadRosterAdoptableEvents`（イベント列挙）を `loadRosterAdoptableGroups`（申込グループの平ら DTO）に置換。RosterFileAdoptSheet に取込単位ラジオ・「すべて表示」トグル・級チェックボックスを実装。「大会名簿の取込」セクション（RosterParseButton・名簿ドラフトカード・roster-drafts リンク）と、それに伴い不要になった `isRosterSourceFilename` / `rosterSources` / findFirst の `rosterImportDrafts` サブクエリを削除（AC-20）。パーサ・Server Action・roster-drafts ページ・テーブル・既存テストは無改修＝AC-21 は roster 系 13 ファイル 198 テスト green で確認。

**要件と手順書の食い違い（要件を採用）**: 手順書は候補表示名を「`listMergeCandidateGroups` と同型」（= title ベース）と書いていたが、requirements §3.2.7 は「申込管理ボードと同じ通称ベース」と明記。**要件を正**とし、/admin/entries の手順1〜3（全イベントを displayName(通称+級) に変換 → deriveEntryGroupName で畳む → title 由来名へフォールバック）をそのまま採った。edition→series の 2 段 leftJoin が必要。

**設計の要点**:
- 候補母集団の日リストは「個人戦 ∧ 非cancelled」の**全日**（cutoff を掛けない）。cutoff を掛けると純関数側の級集合 G(g) が Server Action の検証（cutoff 非適用）とずれ、「選べる級」と「受け付ける級」が食い違う。**この DTO 契約はワーカーに渡す前に main が確定させておく必要がある**（advisor 指摘）。
- 種別・取込単位・トグルの切替では**選択を必ず捨てる**。候補の母集団が変わるため、残すと画面に出ていない対象へ採用できてしまう。テストもこの順序（種別 → 対象）で書く必要がある。
- 表示名の導出母集団はグループの**全イベント**（cancelled・過去日・団体戦も含む）。表示対象で絞ると他画面と表示名が食い違う（/admin/entries の r3 review と同じ理由）。

**検証（main が直列実行）**: mail-inbox 13ファイル325テスト / roster 13ファイル198テスト / events 12ファイル212テスト / admin/entries 3ファイル145テスト / shared schema 8テスト すべて green。`pnpm check-types` `pnpm lint` も green。

残: AC-23（本番実機での候補絞り込み・級ラベル確認）は出荷後。
