---
name: feature-def-grade-entry-fee-derivation
description: grade-entry-fee 表示・通知配線 要件定義（改修）
type: project
---

# grade-entry-fee 要件定義（改修・2026-07-30）

正典 = docs/features/grade-entry-fee/{requirements.md, implementation-plan.md}。親Issue #423 / 子 #424-#430。
AC 28件（**全て auto-test**）。design_required: false。実装未着手。

第1回（PR #392・定数の保持／#390・#391）が意図的に持ち越した「表示側」。grill-me で全分岐を確定させた。

## 起点になった発見（本番実測 2026-07-30）

- `fee_jpy` に値がある26件のうち **24件が AI ドラフト由来**。#411 でその抽出が廃止される（列は残す）
  → **今 `fee_jpy` を読んでいる箇所は放置すると金額が無言で消える**。本改修は「金額を足す」と
  「金額が消えるのを防ぐ」の裏表
- **多級イベントが常態**（37件中14件・料金帯またぎ12件）。スカラー1本では表現できず実際に誤っている
  （id=1 {A,B,C}=2500 / id=3 {A,B,C,D}=2500 → C・D級は本来2000。どちらも過去日で実害なし）
- **`fee_jpy=10,000` の4件は全て kind='team'**（1チーム単価）。id=24 は team かつ eligible_grades={E} で、
  級で導出すると1,500円の大外し → 団体戦除外は必須
- **payment_type は AI が触らない**。設定箇所は EventLifecycleSection の select 1箇所だけでフォームに項目が無く、
  既定 NULL のため支払締切リマインドが構造的に黙る（NULL 31件・うち締切あり6件）

## 主要な設計判断

- **`feeJpy ?? derived` を却下し「official×個人戦は常に導出」** — 格納値は legacy ノイズで多級では誤り。
  常に導出なら #410 との**出荷順序に依存しない**。規定外を手入力で表現する手段は失うが公認大会に規定外は無い
- **総額を載せるのは支払締切リマインドだけ** — `entry_applied_treasurer` は抽選前で額が確定せず once-ever で
  訂正もできない。2026-06 の「金額は載せない」決定はそのまま**維持**（逆転しない）
- **内訳を併記** — once-ever で訂正できない以上、数字の出どころが見えることが唯一の救済。落選が出ても会計が引き算できる
- **母集団を参加者一覧と同一に**（attend=true ∩ is_invited ∩ 対象級）— 画面と通知で人数がずれない
- **級未設定は 0円で足さず除外＋注記** — 総額が静かに過少になるのを防ぐ
- **複数日はグループ全日を合算**（日別に割らない）— 会計はグループ単位で一括請求される。
  文面の日付と範囲が違うので必ず「振込総額」ラベルで示す
- **payment_paid を1人あたり額から総額へ** — 現行文面は会が振り込んだ額と読み違えられる
- **「規定額」ラベルは付けない** — 初版方向性メモから変更。公認大会に規定額以外が無く会員に区別の意味がない
- **導出はページ側で行い EventLifecycleSection の props 契約を保つ** — 総額・内訳は任意の新規 props。
  これで既存 component テストが**壊れない**（AC-25 として固定）

## バイト互換の担保（レビュー時の要点）

`LifecycleMessageContext` に**任意フィールドだけ**足し既存 `feeJpy` を残す設計。未指定なら現行分岐に落ちる。
**既存アサーションを触ってよいのは payment_paid の2件だけ** — 他を書き換えると AC-14/15/19/20 の担保が崩れる。

## 破壊的変更（ユーザー承認済み）

1. events.payment_type の NULL 31件を 'advance' へ backfill（列の既定値も advance へ。onsite 2件は据え置き）。
   **今日の通知影響はゼロ**（該当6件は全て過去日 or LINE未紐付け）。買うのは今後の挙動
2. event-lifecycle-notify.test.ts の payment_paid 2件のみ更新
3. backfill した31件で支払状態表示が「未設定」→「未払」に変わり「支払済にする」ボタンが出る

## Wave 構成

W1: #424(純関数 lib/entry-fee.ts) #425(migration 0052) /
W2: #426(集計 lib/entry-fee-tally.ts) #427(文面 event-lifecycle-notify.ts) /
W3: #428(リマインド配線) #429(payment_paid 総額) #430(イベント詳細画面)

純関数と DB クエリを別ファイルに分けたのは、buildLifecycleMessage のユニットテストを DB 非依存に保つため。
