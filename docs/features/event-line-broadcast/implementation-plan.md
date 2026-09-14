---
status: completed
---

# event-line-broadcast 実装手順書

> **この手順書は 2026-09-14 の改訂（③「グループの人数確認」を役割別の内訳へ）のタスクで
> 上書きしている。** 初版（スキーマ・Bot プール・webhook・配信パイプライン・cron の7タスク、
> Issue #55 ほか）は完了済みで、内容は git 履歴に残っている。
> 正典の要件は [requirements.md](requirements.md) §3.1.3 / §3.1.3a〜3.1.3c。

## 技術設計の要点

### なぜ pure / DB を分けるか

既存の流儀（`entry-fee.ts`（pure）↔ `entry-fee-tally.ts`（DB）、`line-mention.ts`（pure）↔
`line-mention-targets.ts`（DB）) に合わせ、**排他と分岐のロジックを DB 非依存の pure モジュールへ出す**。
内訳の分岐（排他4段＋副連絡責任者5分岐）はケースが多く、Docker の test DB 無しで網羅したい。

### textV2 へ名字を入れる方法（★中核の設計判断）

`buildMentionMessage` の `MentionValue` は `number | { dateIso }` だけで、**自由記述の文字列を
受け取らない**（textV2 が `{}` をプレースホルダ構文として解釈するため。requirements §3.2.2）。
今回は名字（`土居`）を本文へ入れる必要がある。

- **採用**: `MentionValue` に `{ text: string }` を追加し、差し込み時に中括弧を**除去**する。
  `template` / `label` の `assertNoBraces`（throw）はそのまま残す
- **不採用**: 呼び出し側で名字を `template` に連結する方式。`assertNoBraces` が throw すると
  ③だけでなく①〜④の reply が丸ごと落ちる（AC-H18 に反する）

この結果、**template は静的なリテラルのままでよい**（括弧の中身も `%s` で受ける）:

```
グループの人数が%s名であることを確認してください。

内訳
大会参加者：%s名
管理者：%s名（%s）
会計：%s名（%s）
副連絡責任者：%s名（%s）
Bot：1名
```

### メンション対象と内訳は別物

③のメンションは `role='admin'` の会員へ送る（AC-H16）が、**その人が大会参加者で
内訳の管理者行が `0名（大会参加のため）` になっても、メンションは飛ばす**。
「誰に知らせるか」と「グループに何人いるはずか」は別の問い。
既存の在籍プローブ（`filterToGroupMembers`）と、0人なら素テキストへ倒れる挙動は維持する
（プローブ回数は4→1へ減る）。

### 既存ヘルパーは意味を変えない

`loadAdminLineUserIds` / `resolveAdminMention`（`@管理者` = admin + vice_admin）は
**シグネチャも意味も変えない**。③専用に `role='admin'` だけを返す関数を足す。
現在の呼び出し元は③の1箇所だけだが、汎用の「@管理者」の意味を狭めると
今後の通知が巻き添えになる。

## 実装タスク

### タスク1: `MentionValue` に文字列を差し込めるようにする（pure）
- [ ] 完了
- **目的:** textV2 の本文へ名字などの短い文字列を、`{}` で壊れない形で差し込めるようにする
- **対応AC:** AC-H18
- **主な変更領域:**
  - `apps/web/src/lib/line-mention.ts` — `MentionValue` に `{ text: string }` を追加、
    `formatMentionValue` で `{` `}` を除去して返す
  - `apps/web/src/lib/line-mention.test.ts`
- **依存タスク:** なし
- **必要なテスト:** `{ text: '土居' }` が本文へ入る／`{ text: 'a{b}c' }` でも throw せず
  `substitution` のキーと衝突しない／既存の `number`・`{ dateIso }` の挙動が変わらない
- **完了条件:** `line-mention.test.ts` green・typecheck 通過
- **対応Issue:** #643

### タスク2: 内訳の材料を DB から集める（DB 層）
- [ ] 完了
- **目的:** 参加者の母集団と役割保持者を1回で取り、pure 層へ渡す事実（facts）にする
- **対応AC:** AC-H3, AC-H5, AC-H6, AC-H16, AC-H19, AC-H20, AC-H21
- **主な変更領域:**
  - `apps/web/src/lib/entry-headcount.ts` — `countGroupEntrants` / `formatEntrantCountParts` を
    `loadGroupHeadcountFacts(dbc, entryGroupId)` へ置き換える。返すのは
    ①ゲストを除いた参加者の実人数 ②ゲスト参加者が1人以上か ③サークル所属 ON の参加会員が
    1人以上か ④役割保持者3種（`role='admin'` / `is_treasurer` / `is_travel_report_submitter`）の
    `{ userId, displayName }[]`（`line_user_id IS NOT NULL AND deactivated_at IS NULL`・`id` 昇順・
    `family_name ?? name`）⑤参加者の userId 集合（排他判定用）。
    **中止日除外・級フィルタ・重複排除は現行のまま維持する**。
    ★ファイル冒頭のコメントは「ゲスト: 含む」と書いてあり**今回の変更で逆になる**ので、
    参加費集計との対比表ごと書き直す
  - `apps/web/src/lib/line-mention-targets.ts` — `loadPrimaryAdminLineUserIds`（`role='admin'` のみ）を
    追加。既存の `loadAdminLineUserIds` / `resolveAdminMention` は**触らない**
  - `apps/web/src/lib/entry-headcount.test.ts`, `line-mention-targets.test.ts`
- **依存タスク:** なし（タスク1とは変更ファイルが重ならない）
- **必要なテスト:** ゲストが人数に入らない／中止日を数えない／`eligible_grades` の絞り込み／
  複数日の重複排除／LINE 未紐付け・無効化の役割保持者を除く／`family_name` が NULL なら `name`／
  `loadPrimaryAdminLineUserIds` が `vice_admin` を返さない
- **完了条件:** 上記2テストファイル green・typecheck 通過
- **対応Issue:** #644

### タスク3: 内訳の組み立て（pure・新規）
- [ ] 完了
- **目的:** facts から5行の人数と括弧の中身を決め、`buildMentionMessage` へ渡す
  `{ template, values }` を返す
- **対応AC:** AC-H1, AC-H2, AC-H7, AC-H8, AC-H9, AC-H10, AC-H11, AC-H12, AC-H13, AC-H14, AC-H15
- **主な変更領域:**
  - `apps/web/src/lib/entry-headcount-breakdown.ts`（新規・DB 非依存）
    - 排他: 大会参加者 ＞ 会計 ＞ 副連絡責任者 ＞ 管理者 の順に1人1バケットへ割り当て
    - 外れて0名になった行の注記: `0名（大会参加のため）` / `0名（会計として計上のため）` /
      `0名（副連絡責任者として計上のため）`
    - 副連絡責任者の分岐（上から順）: ①排他で全員が他バケットへ → 移動先の注記
      ②遠征届不要（サークル所属 ON の参加会員もゲスト参加者もいない） → `0名（遠征届不要のため）`
      ③残り0人 → `0名（未設定）` ④ゲスト参加者あり → `N名（名字・他会参加者ありのため）`
      ⑤ → `N名（名字）`
    - 管理者・会計の0人は `0名（未設定）`、複数該当は `N名（酒井・飯塚）`（中黒区切り）
    - 合計 = 大会参加者 + 管理者 + 会計 + 副連絡責任者 + 1（Bot）
    - `template` は静的リテラル、`values` は `number` と `{ text }` のみ
  - `apps/web/src/lib/entry-headcount-breakdown.test.ts`（新規）
- **依存タスク:** タスク1, タスク2（両方の型を使う）
- **必要なテスト:** 合計が各行の和と一致することを全分岐で／排他の優先順位（会計を兼ねる管理者・
  副連絡を兼ねる会計・参加者を兼ねる役割者）／副連絡責任者の5分岐／0人・複数人の表記
- **完了条件:** `entry-headcount-breakdown.test.ts` green・typecheck 通過
- **対応Issue:** #645

### タスク4: webhook の③を差し替える
- [ ] 完了
- **目的:** 紐付け完了の返信③を新しい内訳メッセージにし、メンション対象を `role='admin'` へ絞る
- **対応AC:** AC-H1, AC-H4, AC-H16, AC-H17, AC-H22, AC-H23, AC-H24
- **主な変更領域:**
  - `apps/web/src/lib/line-webhook-handler.ts` — `countGroupEntrants` + `formatEntrantCountParts` の
    呼び出し（838-840行付近）を `loadGroupHeadcountFacts` + 組み立てへ、
    `loadAdminLineUserIds`（850行付近）を `loadPrimaryAdminLineUserIds` へ。
    `buildLinkedMessages` の③だけを差し替え、**①②④・在籍プローブ・reply 失敗時の push
    フォールバック・`bindingStillLinked` の両送信点での再検証は一切触らない**
  - `apps/web/src/lib/line-webhook-handler.test.ts` — ③を見ているテスト
    （528-534 / 571-573 / 1654-1730 行付近）を新文面へ。「内他会」を期待するテストは削除
- **依存タスク:** タスク3
- **必要なテスト:** ③の本文が合計＋5行になる／メンションが `role='admin'` だけ／
  admin が LINE 未紐付け・未在籍なら素テキストの `@管理者` へ倒れる／
  push フォールバックでも③がメンション無しへ降格して送られる（既存テストの維持）
- **完了条件:** `line-webhook-handler.test.ts` green・lint・typecheck 通過
- **対応Issue:** #646

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1, タスク2** — 互いに依存なし。変更ファイルが完全に別
  （`line-mention.ts` ↔ `entry-headcount.ts` / `line-mention-targets.ts`）
- **Wave 2: タスク3** — タスク1・2 の型を使う
- **Wave 3: タスク4** — タスク3 に依存。唯一の呼び出し元を差し替える

## 出荷後に残る作業（コードではなく運用）

本番の `is_circle_member` は全会員 OFF、`is_travel_report_submitter` は0人。
このままだと副連絡責任者の行は常に `0名（遠征届不要のため）` になる。
会員編集（`/admin/members/[id]/edit`）とサークル一括編集（`/admin/members/circle`）から
フラグを設定する（requirements §3.1.3c の Non-goals）。
