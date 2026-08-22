---
name: feature-def-confirmed-roster-signal
description: confirmed-roster-signal 要件定義(2026-08-21)
type: project
---

## confirmed-roster-signal 要件定義（2026-08-21）

杉並AB（entry_group_id=13 / events 28,29）が「申込完了・抽選待ち」から動かない件の改修。本番DBで原因を確定させてから定義した。

### 原因（本番データで確認済み）
- events 28/29: entry_status=applied / payment_type=advance / payment_status=unpaid / payment_deadline=NULL(kind=unspecified)
- tournament_entry_rosters・tournament_entry_roster_files ともに 0 件
- mail_messages 340/341「杉並大会(AB級)確定連絡」: mail_kind=confirmed_roster / triage_status=processed / linked_event_id=28 / **添付0件**
- ★採用し忘れではない。**確定名簿が本文に書かれていて添付が無く、確定を記録する手段が存在しなかった**。本番の confirmed_roster メール5件のうち添付ありの3件は全て採用済みで、添付0件の1件だけが落ちていた

### 決定した設計
判定材料を 2→4 に増やす（classify / buildEntryFlow の内部ロジックは不変。hasConfirmedRoster という入力の作り方だけ変える）:
1. パース済み確定名簿（既存）2. 採用済み原本ファイル（既存）
3. **確定名簿メール**（mail_kind=confirmed_roster ∧ triage_status=processed ∧ linked_event_id がグループの日）— 添付の有無・採用の有無を問わない
4. **手動フラグ** entry_groups.confirmed_roster_override（boolean 1つ・監査情報なし・名簿セクションに管理者だけ見えるトグル・会員向けフロー帯にも反映）

### 判断の根拠（再訪時に効くもの）
- mail_kind を採用できるのは undoTriage が mail_kind と採用ファイルを同時に戻すから（取り消し整合が既にある）
- override を entry_groups に置くのは判定材料が全てグループスコープだから。events に置くと entry-management AC-17「グループ内のどの日から見ても同じ」が壊れる。entry_groups は「意図的に列を持たない」設計なので schema コメントを同時更新する
- ★**hasConfirmedRoster は名前が同じで意味が2種類ある**。フェーズ判定用（classify/buildEntryFlow、3箇所で個別に組み立て）と出場者解決用（upcoming-entrants.ts = パース済み rosters のみ。ホーム /dashboard と外部API PR#495 が消費）。**広げるのはフェーズ判定用だけ**。出場者解決を広げると名前データが無いので確定パスが空リストになる
- 帰結として「ボードは名簿確定・要振込なのにホームは希望（点線）」という非対称が出る。正しい挙動なので要件 §3.2.5 に明記し AC-14 で回帰固定した
- 杉並は payment_deadline=NULL なので payment_due に入っても並びは末尾・区画強調なし（AC-10 で「区画には入る」を固定）
- entry_status の自動 applied 化は Non-goal（申込完了 LINE 通知2通の発火条件と絡むため）
- ★**override が効くのは applied のグループだけ**。classify は not_applied / not_applying の分岐で hasConfirmedRoster を参照しないので、未申込で ON にしても区画は動かない（buildEntryFlow も大会申込の完了条件は entryStatus==='applied'）。「任意のフェーズへ進める汎用の逃げ道」ではない＝AC-18 で境界を固定
- シグナル3の帰属は間接（linked_event_id → events.entry_group_id）。イベントを別グループへ移すとシグナルもイベントに付いて移動する
- トグルの現在値は判定ローダーが settled と一緒に返す（UI が4つ目の場当たりクエリを足さないため）

### 成果物
- docs/features/confirmed-roster-signal/{requirements.md, implementation-plan.md}
- AC 18件（auto-test 17 / manual 1）・Non-goals 8件・design_required=false（既存 DisclosureSection パターン踏襲）
- 親 #509 / 子 #510（判定拡張＋migration 0058）・#511（トグル UI）。Wave1=#510 → Wave2=#511 の直列（同じ列とページを触る）
- 実装済み・出荷済み（PR #513）。判定の正典は apps/web/src/lib/events/confirmed-roster.ts、手動フラグは entry_groups.confirmed_roster_override（migration 0058）
