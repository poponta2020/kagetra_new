---
name: fix-pr409
description: fix PR #409
type: project
---

PR #409 (roster-file-adoption) の Codex 指摘修正記録。

## R1 blocker の修正（コミット f0c4de5）
指摘: 団体戦（kind=team）の大会へ名簿ファイルを採用すると、採用は成功扱いなのに RosterSection（団体戦は常に非表示）にも申込管理ボード（母集団は individual のみ）にも現れない行き止まりの経路になる。

ユーザー判断: **個人戦のみに制限する**（既存の名簿仕様＝個人戦のみ・AC-30 に揃える。団体戦への表示実装は影響範囲が本PRを大きく超えるため採らない）。

修正:
- `mail/[id]/page.tsx` に `loadRosterAdoptableEvents()` を新設し、採用シートの候補を `kind=individual` に絞った。**既存の `loadLinkableEvents`（「既存イベントに紐付ける」導線）は変更していない** — メールの紐付け自体を個人戦に限る理由はない
- `adoptRosterFile` の事前検証に `kind !== individual` の拒否を追加（候補クエリと同じ条件を Server Action 側でも再検証＝UI 表示後の変化・直接叩き対策）
- 回帰テスト2件（アクション: 団体戦は拒否＋採用レコードも作られない／UI: 候補に団体戦が出ない）
- docs/spec/tournaments-results.md の該当行を更新

副次的に、ワーカー実装で無条件実行になっていた `loadLinkableEvents()` が元のゲート（draft なし＋unprocessed）へ戻った（採用候補は別クエリになったため）。

検証: check-types 全4パッケージ green / 対象3ファイル40件 green。
