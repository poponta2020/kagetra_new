---
name: feature-def-mail-screen-payment-notice
description: メール処理画面からの振込連絡 要件定義(2026-09-04)
type: project
---

確定名簿メールを処理するメール画面（`/admin/mail-inbox/mail/[id]` の統合処理フォーム）に、会計への
振込連絡を送る**第2導線**を追加する改修。**改修モード（delta）で `line-bot-message-revamp` の
§3.3 を正典のまま更新**し、新 slug を切って仕様を分裂させなかった（振込連絡の canon は既にそこにある）。

## 非自明な設計判断（実装で外すと壊れる）

- ★**メール画面の露出条件から `settled` を外す**。`processMail` が `mail_kind='confirmed_roster'` ∧
  `triage_status='processed'` を書く＝confirmed-roster.ts のシグナル③が成立するので、処理**前**に
  `settled` を見ると必ず false でセクションが永久に出ない。条件は「処理後にどうなるか」で組む。
  **添付0件の確定連絡メール（Issue #509 の杉並AB型）でも出る**のが正しい
- ★**`payment-notice-context.ts` を共有する（別ローダー禁止）**。あちらには「母集団は dueDays
  （未振込の日）だけ。`tallyEntryFeesForGroup` を使うと支払済みの日まで載って**二重請求**」という
  レビューで得た規律が埋まっており、書き直すと静かに再発してテストも捕まえない
- **振込期限・振込先をその場で入力**（ユーザー選択）。メール処理はグループページより**フローの早い
  位置**にあり、この時点で共通項目が未設定のことがある（杉並AB は payment_deadline=NULL）。空だと
  1通目の日付行も2通目の振込先も消えて連絡が成立しない。**振込先は必須・支払締切は任意**
  （later_notice / unspecified が実在するため）。保存は `propagateFieldsToGroup` でグループ内の
  **全イベント（cancelled 含む）**＝既存 `saveGroupCommonFields` と同じ対象。伝播規則を2種類にしない
- ★**順序（配信 → 振込連絡）を、送信エラーの即時表示より優先**（ユーザー判断）。既存配信は本文の
  画像化で数十秒かかりうるため `after()` から動かせない → 順序を守るなら振込連絡も `after()` へ載せる
  しかない。さらに **`processMail` は実行成功後にメール一覧へ戻る**ので、そもそも実行画面にエラーを
  出す場所が無い。失敗は `entry_group_payment_notices` の `last_attempted_at` / `last_error`（新設）に
  記録し、グループページ＋メール詳細の「処理済み」カードに出す（オープンチャット配信の `lastAttempt`
  と同じ規律）
- **送信チェックの既定 = 未送信 ON / 送信済 OFF**。訂正名簿・級別分割で確定名簿メールが2通目3通目と
  届くのは日常なので、送信済みへ既定 ON のままだと意図しない再送になる
- 対象日が無いとき（未申込／現地払い／支払済／紐付けなし／単価解決不可）は**黙って消さず理由を1行**
  出す。判定は非中止日だけを見て上から順の優先順位（要件 §3.3.5.2）
- `entry_status` の自動 applied 化はしない（confirmed-roster-signal の Non-goal を維持）

- ★**共通項目（支払締切・振込先）の保存は送信可否と切り離す**（要件レビューで是正）。チェックを
  外したら入力が黙って消える＝この機能が無くそうとしている状態を作ってしまうため、
  `paymentNotice: { send: boolean, ... }` として **send:false でも保存だけする**。
  `paymentNotice` 自体を渡さないのはセクションが出ていないときだけ。振込先が必須なのは send:true のみ
- **ロック順は確認済み**: `adoptRosterFileTx` は events を素の SELECT でしか読まず、`processMail` の tx は
  mail_messages → tournament_drafts しか行ロックしない。そこへ `propagateFieldsToGroup` の
  `lockEventRowsAscending`（id 昇順）を足しても `saveGroupCommonFields` と巡回待ちにならない。
  ★この昇順を崩さないこと（過去に 40P01 deadlock を踏んでいる）
- 送信成功時は `last_error` を NULL へ戻す（残すと「送信済」と「失敗」が同時に出る）

## Acceptance Criteria

**AC-31〜51（＋AC-42b / AC-45b）の23件を追加**（auto-test 22 / manual 1）。既存 AC-1〜30 は維持。
回帰 AC は AC-48（グループページの既存導線が同じ露出条件で出て再送できる）・AC-49（採用の原子性）・
AC-50（確定名簿以外のメール処理経路が不変）。

## Issue と Wave

親 #567 https://github.com/poponta2020/kagetra_new/issues/567
子 #568（migration: last_attempted_at / last_error）→ #569（露出判定と理由の共有ロジック・pure な
payment-notice-availability.ts は client から import されるので server-only/schema/drizzle 禁止）→
#570（sendPaymentNoticeCore へ送信を共通化）→ #571 + #572（Wave 4 並行: ドラフト取得 Server Action /
processMail 拡張）→ #573（UI）→ #574（失敗表示2画面）。

依存は「スキーマ → 判定 → 送信 → 入口 → 画面」の一本道で、並行できるのは Wave 4 だけ。

正典: docs/features/line-bot-message-revamp/{requirements.md §3.3.5・§4.1, implementation-plan.md}
相互参照: docs/features/mail-inbox-mailer/requirements.md §3.1.3 のフォーム表に1行追加（仕様は複製しない）

関連: [[project_confirmed_roster_signal_def]] [[project_entry_group_page_def]] [[project_result_import_reality_audit]]
