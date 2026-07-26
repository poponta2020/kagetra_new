---
name: feature-def-event-detail-redesign
description: 大会申込詳細リデザイン 要件定義(2026-07-26)
type: project
---

**機能:** event-detail-redesign（/events/[id] 大会申込詳細のリデザイン・改修モード）
**親Issue:** #352 https://github.com/poponta2020/kagetra_new/issues/352
**子Issue:** #353(Task1) #354(Task2) #355(Task3) #356(Task4) #357(Task5) #358(Task6)

## ★最重要の制約: 実装順序
**nav-settings-hub（親Issue #346）の出荷が先。** #346 が /events/[id] のルート要素に p-4 を入れ、
上部バー44pxを廃止しボトムナビを再構成する（会員4/管理者6タブ）。同じ行を触るため衝突する。
散文だけでは /implement が読まずに走るので、**親Issueタイトルに「（#346 出荷後に着手）」を入れ、
implementation-plan の Task1 の依存タスクにも #346 を明記**した（advisor 指摘）。

## 主要な設計判断
- **申込フローの判定＝ハイブリッド**: ステップの性質が混在（大会申込=entryStatus・支払=paymentStatus は
  状態を持つ／会内締切・抽選・開催は日付しかない）。どちらか一方に倒すと実態を表現できない
- **「中立(neutral)」という第3状態を新設**: 現地払い/支払未設定の支払ステップと、not_applying 時の
  大会申込〜支払。完了でも警告でもなく**現在地の候補にもならない**。not_applying では現在地を出さない
  （advisor 指摘で AC-7 と AC-9 の衝突を解消）
- **警告(朱)は「期限超過かつ未完了」のみ**。単なる未払を警告にすると朱が意味を失う
- **級タブの初期選択は「全体」固定**（管理者と会員で初期状態を変えない）
- **対象級を級別定員セクションへ統合**: 対象級の行を消したため、定員未設定の大会で
  「どの級が出られるか」が欠落する。同じ並びで級だけ出して埋める
- **参加費を会員から隠す**: 周知は要綱の LINE 配信に委ねるというユーザー判断
- **団体戦ガードは移植しない**（ユーザー判断）。uploadRoster にしか無かった kind!=='individual'
  チェックはメール経路に無いが、団体戦に名簿を取り込む運用が無いため許容

## 調査で判明した事実（実装時に効く）
- **session.user.role は role-preview-switch 出荷後「実効ロール」**。この画面は既にプレビュー追随済みで追加対応不要
- **<main> に padding を足さない回帰ガードが存在**（PR #345・mobile-shell.test.tsx）。余白は各ページ根要素の p-4
- **formatEventDate は /events 専用**（events/event-list-utils.ts）。lib/event-grade-broadcast.ts が
  lib→app の逆向き import をしている。Task1 の共通化で解消する
- **materializeRoster / parseRosterGrid / readExcel は共有ライブラリ**（メール取込も使う）。削除禁止。
  消すのは uploadRoster 関数と RosterUploadForm のみ
- **メール経由で applicant/confirmed 両方取り込める**（承認UIの「原本用途」3択）。publishedAt 手入力・
  訂正版指定もメール側が上位互換 → 「メールからしか取り込まない」は成立する
- not_applying/締切超過の大会も URL 直打ちで /events/[id] に到達できる（塞がれていない）

## AC
**34件（auto-test 33 / verify 1 / manual 0）**。verify 1件は design-spec §8 忠実度チェックリストの確認。
回帰AC 8件で「変えない挙動」を固定（出欠判定・集計・once-ever通知・会員へのRSC payload遮断・
級別配信のadmin限定・名簿の個人戦限定・ロールプレビュー追随・CI green）。

## タスクと Wave
6タスク・3 Wave（+ Wave 0 = #346 待ち）
- Wave 1（並行3）: Task1 日付整形共通化 / Task2 フロー判定純関数 / Task3 表示プリミティブ新設
- Wave 2（並行2）: Task4 名簿パネル+Excel取込廃止（events/[id]/配下）/ Task5 進行管理・LINE配信再構成（components/events/直下）
- Wave 3: Task6 page.tsx 組み替え（全依存）

## スコープ外
オープンチャット欄（DBに該当データ無し・migration必要。別feature。モックに SCOPE-OUT マーカー2箇所）／
上部バー廃止・ナビ再構成（#346）／名簿のメール取込フロー自体／団体戦ガード移植／
/admin/entries への「申し込まない」導線新設
