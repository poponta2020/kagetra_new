---
name: impl-event-detail-redesign-wave1
description: event-detail-redesign Wave1(タスク1-3)
type: project
---

event-detail-redesign（親Issue #352）の Wave 1（タスク1-3）を並行実装して commit/push した。worktree=`C:/tmp/impl-event-detail-redesign`・ブランチ `feature/event-detail-redesign`。

## Wave 構成と委譲
task-implementer(sonnet) 3並列。変更領域が重ならないことを main が事前確認（タスク1=`lib/event-date`+`/events`一覧側、タスク2=`lib/events/entry-flow`新規のみ、タスク3=`components/events/detail/`新規のみ）。排他宣言ミス・統合時の不整合はゼロ。

## 各タスク
- **タスク1 (#353・5fc81c6)** `apps/web/src/lib/event-date.ts` 新設。`formatEventDate` を `/events` 一覧から移設＋`formatFlowDate`/`formatDateTimeFull`/`formatDateTimeShort` を追加。`event-grade-broadcast.ts` の lib→app 逆向き import も解消
- **タスク2 (#354・1d1bb37)** `apps/web/src/lib/events/entry-flow.ts`。`buildEntryFlow` 純関数
- **タスク3 (#355・f664f6a)** `apps/web/src/components/events/detail/` に SectionRule / FlatTable / DisclosureRow+DisclosureSection+DisclosureActions / LinkAction+LinkActionLink+linkActionClass

## ★設計判断（委譲前に main が確定させた2点。どちらも後から効く）
1. **申込フローの出力を排他 status enum にしない。** requirements は「warn は now と併存しうる」、design-spec は「開催は完了していても goal スタイルを保つ」と定めており、モックの `.fs` も `done`/`now`/`warn`/`goal` が合成可能な独立クラス。単一 enum にすると片方が無言で落ちる → `done`/`isNow`/`isWarn`/`isGoal`/`neutral` の独立フラグにした
2. **日付欄を `kind: 'date' | 'text'` の判別共用体にした。** 忠実度チェックリストが「数値でない『未定』は sans」を要求しており、プレースホルダ（未定/申込なし/現地払い）と実日付を描画側が文字列マッチなしで区別する必要があるため

## 注意点・ハマりどころ
- **worktree に `node_modules` が無い**（ensure-worktree.sh は install しない）。ワーカー2名が eslint を実行できず正しく停止して報告してきた。`.env`(root) / `apps/web/.env.local` / `packages/shared/.env` の3ファイルをコピーし `corepack pnpm install` が必要。**次回の実装セッションは worktree 作成直後にこれをやる**
- **`--kg-text-sm`(13px) と Tailwind `text-sm`(14px) は不一致**。`--kg-text-base`(15px) vs `text-base`(16px) も同様。既存コードの慣例どおり `text-[13px]`/`text-[15px]` の arbitrary value で書く必要がある（Tailwind v4 は誤りを警告しないので気付けない）
- **タップ領域 44px は実際は約42px**。`text-xs` の行高16px＋上下13px。design-spec の指定値を変えず、ワーカーが報告で過大表記を避けたのは正しい。jsdom では実寸を検証できないのでテストはクラス契約のみ
- `noUncheckedIndexedAccess` により `arr[0].key` が型エラー。main が `?.` で修正（3箇所）
- **`page-padding.test.ts` は `events/[id]/page.tsx` に `  return (` がちょうど1本でその次行に padding utility があることを機械的に要求する**（AC-23 の実体）。タスク6でヘルパーを page.tsx 内に置くとこのガードが壊れる → `EventDetailHeader`/`EntryFlow` は別ファイル必須
- **名簿の並び順はモックが 申込者→確定**（現行実装は確定が上）。requirements に明記が無くレイアウトの正はモックなのでモックに従う判断をした

## 検証
タスク1-3 のテスト 123件 green（entry-flow 34 / event-list-utils 36 / event-date 21 / detail プリミティブ 32）。`pnpm check-types` clean・eslint clean・`components/ui/` 無差分を確認済み。
