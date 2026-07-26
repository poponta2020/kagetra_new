---
status: approved
issue: 335
---
# バグ改修要件: 申込管理ボードの大会表示名で級が重複する（多摩AA・鳳玉CDCD）

## 再現手順
1. 管理者で `/admin/entries`（申込管理ボード）を開く
2. edition 未紐付け（通称が引けない）かつ title に級文字が含まれる大会（例: title「多摩A」対象級 `{A}`、title「鳳玉CD」対象級 `{C,D}`）の行を見る
3. 「多摩AA」「鳳玉CDCD」のように級が二重表示される

## 根本原因
[apps/web/src/app/(app)/admin/entries/entry-board-utils.ts:143-147](../../../apps/web/src/app/(app)/admin/entries/entry-board-utils.ts) の `displayName`:

```ts
const base = item.shortName ?? item.title
const grades = item.eligibleGrades?.join('') ?? ''
return `${base}${grades}`
```

- 表示名は「通称 + 級」の想定で、通称（`tournament_series.short_name`）が引けない大会は title にフォールバックする
- ところが大会イベントの title は運用上すでに「通称+級」形式（メール承認の unit 分割承認が級込みの名前で events を作る。本番実データ: 「多摩A」「鳳玉CD」「益田BD」等）
- title フォールバック時にも級を連結するため二重になる
- 本番の申込管理ボード母集団 29 件中 26 件が edition 未紐付けで、この経路に該当（edition 紐付け済みの「宇都宮」「大阪」「椿」は通称に級が含まれず正常表示）

## 修正方針
`displayName` を「級の連結は通称が引けたときだけ」に変更する:

```ts
if (item.shortName == null) return item.title  // title は運用上すでに級込み。そのまま出す
return `${item.shortName}${item.eligibleGrades?.join('') ?? ''}`
```

- title は管理者が入力・承認した表示名そのものなので、加工せずそのまま出すのが安全（title に級が含まれない大会でも「入力どおり」に表示されるだけで実害なし）
- title から級文字を剥がすヒューリスティックは採らない（「椿杯ABC」のような固有名との衝突リスク）
- 既存テスト 1 件（`displayName > 通称が引けない大会は正式名称にフォールバック` — title フォールバック時にも級を連結する期待値 `'正式名称大会A'`）は今回のバグ仕様そのものなので、期待値を title そのまま（級なし）へ変更する

## Acceptance Criteria
| ID | 条件 | 検証手段 |
|----|------|------|
| AC-1 | 通称が引けない大会は title をそのまま表示し、級を追記しない（title「多摩A」`{A}` →「多摩A」、title「鳳玉CD」`{C,D}` →「鳳玉CD」） | auto-test（回帰テスト） |
| AC-2 | 通称が引ける大会は従来どおり「通称+級」（例「札幌AB」）、対象級なしなら通称のみ | auto-test（既存テスト） |
| AC-3 | 既存テスト・lint・typecheck がすべて成功する（デグレードなし） | auto-test |

## Non-goals
- 本番 events の edition 紐付けデータ整備（別課題。紐付ければ通称表示に自然に戻る）
- title から級文字列を剥がすパース処理の導入
- /events 一覧など他画面の表示変更（/events は title のみ表示で本バグの影響なし）

## 影響範囲
- `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts` — `displayName` のみ（利用箇所は `EntryBoardClient.tsx` の 1 箇所）
- `apps/web/src/app/(app)/admin/entries/entry-board-utils.test.ts` — 既存期待値 1 件変更 + 回帰テスト追加
- 修正規模: **軽微**（実装 1 ファイル + テスト 1 ファイル）
