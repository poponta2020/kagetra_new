---
name: impl-home-tournament-timeline
description: ホーム「会の出場予定」実装
type: project
---

ホーム `/dashboard` を「会の出場予定」へ全面置き換え（design-spec が要件成果物・/define-feature は回していない）。worktree = `C:/tmp/impl-home-tournament-timeline`、ブランチ `feature/home-tournament-timeline`。GitHub Issue は無い（design-screen 経路のため。commit に Refs 無し）。

## タスクと commit
- 4691284 タスク1: design-prototype.patch 適用（DTO/純関数/表示コンポーネント）+ home-timeline-utils.test.ts。未使用の `isSameMonth` は取り込み時に削除
- 8137694 タスク2: page.tsx を実クエリ化（クエリ6本固定）+ page.test.tsx（20件）。proto-data.ts 削除もここで前倒し
- ffadd98 タスク3: HomeTimeline.test.tsx（14件）+ 忠実度チェック + docs/spec/events-attendance.md 更新

## 設計判断（実装中に固めたもの）
- **出欠クエリを `attend=true` で絞ってはいけない**。希望パスの出場者と、未回答アラートの「自分の行が無い」判定の両方が同じ1クエリを使う。attend=true で絞ると **「不参加」と回答済みの人にアラートが鳴り続ける**（advisor 指摘。設計時に踏みかけた罠）
- 未回答アラートの母集団は①母集団そのもの＝**出場者0名の大会も対象**（誰も答えていない大会こそ自分の回答が要る）。タイムラインの「0名は載せない」を継承しない
- `eligible_grades` が空/null は「全員が対象」。イベント詳細の `isEligible` と同じ規約（spec の「自分の級が含まれる」は略記）
- `entryStatus='not_applying'` によるアラート除外は**入れない**（spec に無い・7日窓は通常その判断より前）
- 出場者の並びは級昇順→姓（ja ロケール）。イベント詳細の参加者一覧と同じ語彙

## 波及（dashboard/ 外に触れた唯一の変更）
`admin/entries/entry-board-utils.ts` の `displayName` に **doc コメント3行を追加しただけ**。
当初は引数を `Pick<EntryBoardItem,...>` へ広げる必要があったが、**PR 作成直前のリベースで取り込んだ
PR #398 が同じ `NameSource` 型を独立に導入済み**だったため不要になった（コンフリクト解決で upstream 側を採用）。
→ **教訓: worktree を local main から切った場合、origin/main が進んでいないか PR 作成前に必ず確認する。**
今回は `git log --oneline origin/feature/..origin/main` で10コミット遅れ・同一ファイル変更ありを検知して
リベースした。`e73212d` のコミットメッセージには「Pick<> へ広げた」の一行が残っている（差分には無い・PR 本文で明示済み）

## ★未決の申し送り（ユーザー判断が要る）
確定名簿は **entry_group 単位**なので、複数日/複数級を1グループに束ねた大会では**全日が同じ出場者リストを共有する**。「多摩A」の行に B 級チップが出る形になり、design-spec §6 が名簿行 `grade` ルールで防ごうとしたのと同じ失敗形。手順書・design-spec が「絞りは3条件だけ」と明記しており、直前2コミット（5fe02ba/02d6acb）がまさにこの領域の訂正だったため**plain reading のまま実装**した。切り替えが要るなら page.tsx の `confirmedEntrantsOf()` 1関数だけの変更で済むよう分離してある。
影響規模は**未計測** — ローカル dev DB がテーブル14個の旧スキーマで `tournament_entry_rosters` が存在せず、実データは本番にしかない

## 検証
- dashboard 43件 / admin/entries 120件 green・`pnpm check-types`（全4pkg）通過・dashboard 配下 eslint クリーン
- `git grep DESIGN-PROTO` は apps/ packages/ で 0件
- 375px の実測はプロトタイプ時の計測を継承（HomeTimeline.tsx は patch から `git diff` 0行）
