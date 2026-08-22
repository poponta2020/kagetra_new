---
status: completed
---

# 大会別LINE Bot メッセージ改訂 実装手順書

この計画が**今回の変更の全タスクを持つ**。文面の正典は既存3機能の requirements.md に置いたが、
実装タスクは相互に依存するのでここへ集約する（`/implement line-bot-message-revamp` で回す）。

## 前提となる調査結果

- push / reply の実装は6モジュールに分散し、重依存を避けるため**意図的に共通化されていない**
  （`line-broadcast.ts` / `line-broadcast-guidelines.ts` / `event-lifecycle-notify.ts` /
  `event-grade-broadcast.ts` / `entry-overdue-alert.ts` / `line-webhook-handler.ts`）。
  メンション基盤も同じ流儀で **pure モジュール**として作り、既存を統合しない
- `'vice_admin'` の権限判定は 43ファイル・58箇所にインライン展開されている →
  ロールを増やさず `users.is_treasurer` の boolean で解く（requirements §7-1）
- `formatEventDate`（`M/D(曜)`）は [event-date.ts](../../../apps/web/src/lib/event-date.ts) に既存。新規に作らない
- `GradeHeadcount { grade, count, unitJpy }` は [entry-fee.ts](../../../apps/web/src/lib/entry-fee.ts) に既存。
  振込連絡の明細はこれをそのまま使う
- 「確定名簿あり」は [confirmed-roster.ts](../../../apps/web/src/lib/events/confirmed-roster.ts) が正典（4材料の OR・出荷済み）

## 実装タスク

### タスク1: メンション基盤（textV2 ビルダー）
- [x] 完了
- **対応Issue:** #520
- **目的:** `@All` と個人メンションを含む LINE メッセージを組み立てる純関数を用意する
- **対応AC:** AC-7, AC-8
- **主な変更領域:** `apps/web/src/lib/line-mention.ts`（新規）＋ 同 `.test.ts`
- **依存タスク:** なし
- **必要なテスト:** `mentionee.type='all'` の substitution 生成／個人 userId 複数の生成／
  プレースホルダ名が本文と一致すること／メンション0件のとき素の `type:'text'` を返すこと
- **完了条件:** ユニットテスト green・型チェック通過
- **メモ:** `node:` import と `@kagetra/shared` を持ち込まない（pure 制約）。
  **自由記述を受け取る API にしない** — 引数は「行の配列」ではなく、メンション種別と
  数値由来の文字列だけを受け取る形にして、中括弧混入を型で防ぐ

### タスク2: 会計フラグ（`users.is_treasurer`）
- [x] 完了
- **対応Issue:** #521
- **目的:** 「誰が会計か」をデータで持ち、会員編集から設定できるようにする
- **対応AC:** AC-1, AC-2, AC-3
- **主な変更領域:** `packages/shared/src/schema/auth.ts`・`packages/shared/drizzle/`（migration 新規）・
  `apps/web/src/app/(app)/admin/members/[id]/edit/`（actions + page）・`apps/web/src/app/(app)/admin/members/page.tsx`
- **依存タスク:** なし
- **必要なテスト:** 既定値 false／トグル更新／`admin`・`vice_admin` 以外は拒否
- **完了条件:** テスト green・migration が `db:migrate` で流れる
- **メモ:** **認可判断にこの列を使わない**（requirements §6）。migration 番号は着手時に最新を再確認する

### タスク3: メンション対象の解決
- [x] 完了
- **対応Issue:** #522
- **目的:** `@会計` / `@管理者` が誰を指すかを1箇所で決める
- **対応AC:** AC-4, AC-5, AC-6
- **主な変更領域:** `apps/web/src/lib/line-mention-targets.ts`（新規・DB クエリ）＋ 同 `.test.ts`
- **依存タスク:** タスク1, タスク2
- **必要なテスト:** id 昇順で全員返す／`line_user_id` NULL を除外／`deactivated_at` 非 NULL を除外／
  0件のとき空配列（呼び出し側が素テキストへ倒せること）
- **完了条件:** DB 統合テスト green
- **メモ:** タスク1（pure）と分けるのは、こちらが `@/lib/db` に依存するため

### タスク4: A-1 廃止・A-3 を①〜④へ分割
- [ ] 完了
- **対応Issue:** #523
- **目的:** 紐付け直後の案内を、確認事項が伝わる4通へ置き換える
- **対応AC:** AC-22, AC-23, AC-24, AC-25（文面の正典は event-line-broadcast §3.1.3）
- **主な変更領域:** `apps/web/src/lib/line-webhook-handler.ts`（**`LineReplyClient` の契約変更を含む** — 後述）＋ 同 `.test.ts`、
  申込人数集計のヘルパー（`apps/web/src/lib/entry-headcount.ts` 新規想定）
- **依存タスク:** タスク1, タスク3
- **必要なテスト:** `join` で reply を呼ばず状態だけ書くこと／コード一致で4通を1リクエストに積むこと／
  ③の人数がゲストを含み「内他会」を併記すること／ゲスト0名で括弧が消えること／
  `entry_deadline` NULL で②が「未定」になること
- **完了条件:** テスト green
- **メモ:**
  - ③の母集団は**実人数（グループ全体で重複排除）・ゲスト込み**。参加費集計（延べ・ゲスト除外）とは
    別物なので、`entry-fee-tally.ts` を流用しない
  - ★**`LineReplyClient` の契約を変える必要がある。** 現行は
    `reply({ replyToken, text, channelAccessToken })` で**テキスト1本＝1通しか送れない**
    （[line-webhook-handler.ts:70](../../../apps/web/src/lib/line-webhook-handler.ts) の interface と
    同 182 の `defaultLineReplyClient` が `messages: [{ type:'text', text }]` を組んでいる）。
    ①〜④は**4通の配列**で、しかも②③は `textV2` + `substitution` なので、
    引数を「メッセージオブジェクトの配列」へ広げる。既存の呼び出し3箇所
    （招待コード無効の2箇所・級別グループ紐付け）も新シグネチャに合わせる
  - 実装クラスは同ファイル内に閉じており、`app/api/webhook/line/route.ts` は
    `handleLineWebhook` を呼ぶだけなので**ルート側の変更は不要**
  - **既存の join 応答テストは削除・置換になる**

### タスク5: E-1 / E-3 / F-1〜F-6 の文面差し替えと複数日ラベル撤去
- [ ] 完了
- **対応Issue:** #524
- **目的:** ライフサイクル通知8種の文面を新仕様へ置き換え、不要になった日別ラベル生成を削る
- **対応AC:** AC-26, AC-27, AC-30 ＋ **回帰 AC-28**（文面の正典は event-lifecycle-notify §3.2.1）
- **主な変更領域:** `apps/web/src/lib/event-lifecycle-notify.ts`・
  `apps/web/scripts/send-lifecycle-reminders.ts`・
  `apps/web/src/app/(app)/events/[id]/actions.ts`（`days` を渡す箇所）＋ 各 `.test.ts`
- **依存タスク:** なし（タスク1・3に依存しない。この8種にメンションは無い）
- **必要なテスト:**
  - 8種それぞれの文面（`formatEventDate` の曜日つき・`⚠️` が絵文字であること）
  - `lottery_date` NULL で「抽選日は未定です」が出ること
  - **回帰: 締切が同一の3日グループで F-1 が1通だけ送られること**（束ね処理の維持）
  - 金額（`totalJpy` / `unitPricesLabel` / `breakdownLabel` / 級未設定注記）が
    どの文面にも現れないこと
- **完了条件:** テスト green
- **メモ:** `days` / `formatDaysLabel` / `sortDays` / `buildBucketMessage` の複数日分岐は
  **呼び出し元が消えるので撤去する**。ただし **(entryGroupId, type, dateIso) の束ね自体は残す**。
  現行文面をバイト単位で固定している既存テストが複数あり、**設計通り落ちるので期待値を更新する**
  （放置すると「原因不明の赤」に見える）

### タスク6: E-2 を @会計 の予告文へ差し替え
- [ ] 完了
- **対応Issue:** #525
- **目的:** 申込完了2通目から振込情報を外し、メンション付きの予告文にする
- **対応AC:** AC-29（文面の正典は entry-notify-lottery-treasurer §3.2.3）
- **主な変更領域:** `apps/web/src/lib/event-lifecycle-notify.ts`（`entry_applied_treasurer` 分岐）・
  `apps/web/src/app/(app)/events/[id]/actions.ts`（`buildTreasurerAppliedMessage`）＋ 各 `.test.ts`
- **依存タスク:** タスク1, タスク3, タスク5
- **必要なテスト:** `payment_deadline` / `payment_method` / `payment_info` を参照しないこと／
  会計0人で素テキストになること／複数日でも文面が単一日と同じであること
- **メモ:** `LifecycleMessageContext` の `paymentDeadlineIso` / `paymentMethod` / `paymentInfo` /
  `days` は、この種別では未使用になる。他種別で使われていなければ型ごと削る

### タスク7: 振込連絡の保存領域と文面ビルダー
- [x] 完了
- **対応Issue:** #526
- **目的:** 編集後の級別人数を保存し、2通の文面を組み立てる
- **対応AC:** AC-12, AC-14, AC-15, AC-16, AC-17, AC-18
- **主な変更領域:** `packages/shared/src/schema/`（`entry_group_payment_notices` 新規テーブル＋migration）・
  `apps/web/src/lib/payment-notice.ts`（新規）＋ 同 `.test.ts`
- **依存タスク:** タスク1, タスク2
- **必要なテスト:** 初期値が `tallyEntryFeesForGroup` と一致すること／級ごと1行・A→E順・人数0の級を出さない／
  空行の位置／`payment_deadline` NULL で日付行が消える／`payment_info` 空で2通目を作らない／
  全級0で組み立てを拒否する／保存した人数で再構築すると同じ文面になる
- **完了条件:** テスト green・migration が流れる
- **メモ:** テーブルは `entry_group_id` UNIQUE の1行 upsert（履歴は持たない）。
  列は級別人数（jsonb）・総額・最終送信日時・送信者。**単価は保存しない**
  （`resolveEntryFee` から都度導出する。協会規定額が変わったら次回から新しい額になるのが正しい）

### タスク8: 振込連絡の画面と送信
- [ ] 完了
- **対応Issue:** #527
- **目的:** 名簿確定フェーズのグループに導線を出し、プレビュー→送信までつなぐ
- **対応AC:** AC-9, AC-10, AC-11, AC-13, AC-19
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/[groupId]/`（page + actions + components）
- **依存タスク:** タスク3, タスク7
- **必要なテスト:** 出現条件（settled ∧ advance ∧ unpaid）の真理値表／手動トグル経由でも出ること／
  現地払い・支払済で出ないこと／単価入力欄が存在しないこと／push 失敗で送信済みにならないこと
- **完了条件:** テスト green
- **メモ:** UI は同ページの既存セクション（`CommonFieldsSection` / `GroupProgressSection` /
  `LineBroadcastSection`）の作りに揃える。**新しいデザイン言語を持ち込まない**ので design-spec は作らない

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1**: タスク1 #520（メンション基盤）, タスク2 #521（会計フラグ）, タスク5 #524（ライフサイクル文面）
  — 互いに変更領域が重ならない。タスク5 は `event-lifecycle-notify.ts` と reminders スクリプト、
  タスク1 は新規ファイル、タスク2 はスキーマと members 画面
- **Wave 2**: タスク3 #522（メンション対象解決）, タスク7 #526（振込連絡の保存・ビルダー）
  — ともに Wave 1 に依存し、互いに独立
- **Wave 3**: タスク4 #523（webhook ①〜④）, タスク6 #525（E-2）, タスク8 #527（振込連絡の画面）
  — タスク6 は `event-lifecycle-notify.ts` を触るのでタスク5 の後に置く

> migration が2本（タスク2・タスク7）出る。**同じ Wave に置かない**ことで番号衝突を避けている。

## 親 Issue

#519 https://github.com/poponta2020/kagetra_new/issues/519
