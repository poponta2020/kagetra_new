---
status: completed
design_required: false
completed_sections: [背景調査, 変更の動機と内容, 変更後の挙動, 変わらないもの, Acceptance Criteria]
---

# 確定名簿シグナルの拡張 要件定義書

改修モード（delta）。対象は「確定名簿が出た」ことをシステムが認識する経路
——`entry-management`（申込管理ボードの区画分類）と `event-detail-redesign`
（申込フロー帯）にまたがる横断的な判定。

## 1. 概要

### 目的

「確定名簿が出た」ことをシステムが認識する経路を、**名簿レコードの有無に依存しない
形へ広げる**。確定連絡が届いているのに申込フローが「抽選待ち」で滞留する状態をなくす。

### 背景（2026-08-21 に本番データで確認）

杉並AB（`entry_group_id=13` / `events` 28=杉並B 9/5, 29=杉並A 9/6）が
「申込完了・抽選待ち」から動かない状態で発見された。

```
events 28/29   entry_status=applied  payment_type=advance  payment_status=unpaid
               payment_deadline=NULL  payment_deadline_kind=unspecified
tournament_entry_rosters       (group 13) → 0 件
tournament_entry_roster_files  (group 13) → 0 件
mail_messages 340/341「第三回全国競技かるた杉並大会(AB級)確定連絡」
               mail_kind=confirmed_roster  triage_status=processed  linked_event_id=28
               添付 → 0 件
```

`classify`（entry-board-utils.ts）は `applied` → `advance` ∧ `unpaid` →
`hasConfirmedRoster=false` で **`applied_waiting` を確定的に返す**。フロー帯も
抽選ステップが現在地のまま止まる。

**原因は採用し忘れではない。** このメールには添付が1件も無く、確定名簿は本文に
書かれていた。現行の判定材料は「パース済み名簿 ∪ 採用済み原本ファイル」の2つだけで、
管理者が**種別「確定名簿」として処理した事実（`mail_messages.mail_kind`）は判定に
使われていない**。添付のないメールでは確定を記録する手段が存在しなかった。

本番の確定名簿メール5件を並べると構図がはっきりする:

| mail | グループ | 添付 | 確定採用ファイル | 現状の判定 |
|---|---|---|---|---|
| 256 法人化30周年 | 18 | 4 | 1 | ✅ 確定名簿あり |
| 272 大阪なにわ 抽選結果 | 2 | 1 | 3 | ✅ |
| 318 大阪なにわ クラス分け | 2 | 2 | 3 | ✅ |
| **340/341 杉並AB 確定連絡** | **13** | **0** | **0** | ❌ **滞留** |

添付があった3件は全て採用済み。**添付が無い1件だけが落ちている。**
同じ症状で現在滞留している大会は杉並A/Bの2件（1グループ）のみ。

## 2. ユーザーストーリー

- **対象**: 管理者・副管理者（申込管理の実務）。間接的に一般会員（大会詳細のフロー帯）
- **目的**: 確定連絡が届いたら、名簿の形式（添付／本文／別経路）に関わらず申込フローを
  次（振込）へ進めたい
- **シナリオ1（メール連動）**: 確定連絡メールを受信 → メール詳細で種別「確定名簿」を
  選び対象グループを指定して実行 → 添付があれば採用され、無くてもそのまま
  → ボードが「名簿確定・要振込」へ移る
- **シナリオ2（手動）**: メールが来ない・別経路（会場掲示、口頭、他会からの連絡）で
  確定を知った → グループの名簿セクションで「確定名簿ありとして扱う」を ON
  → 同じくフェーズが進む

## 3. 機能要件

### 3.1 画面と遷移

新規画面・新規遷移なし。既存3画面が影響を受ける。

| 画面 | 変化 |
|---|---|
| `/admin/entries`（申込管理ボード） | 区画分類が変わる（`applied_waiting` → `payment_due`）。UI 自体の変更なし |
| `/admin/entries/[groupId]`（申込グループページ） | フロー帯の抽選が完了になる。**名簿セクションに管理者向けトグルを追加** |
| `/events/[id]`（大会詳細） | 同上（名簿セクションは同一コンポーネント `RosterSection`） |

見た目は既存パターン（`DisclosureSection` 内の行）を踏襲するため design-spec は作らない
（`design_required: false`）。

### 3.2 ビジネスルール

#### 3.2.1 「確定名簿あり」の判定（フェーズ判定用）

グループ `g` について、次の**いずれか**が成り立てば「確定名簿あり」とする。

1. **パース済み確定名簿**（既存）: `tournament_entry_rosters` に
   `roster_type='confirmed'` ∧ `superseded_at IS NULL` の行がある
2. **採用済み原本ファイル**（既存）: `tournament_entry_roster_files` に
   `roster_type='confirmed'` の行がある
3. **確定名簿メール**（新規）: `mail_messages` に
   `mail_kind='confirmed_roster'` ∧ `triage_status='processed'` ∧
   `linked_event_id` が `g` に属する `events` のいずれか、である行がある
4. **手動フラグ**（新規）: `entry_groups.confirmed_roster_override = true`

- 3 は**添付の有無・採用の有無を問わない**（ユーザー確定。§7-2）
- 4 は 1〜3 が全て無くても単独で成立する
- 判定は**グループ単位**。グループ内のどの日から見ても同じ結果になる
  （entry-management AC-17 の不変条件を維持する）

#### 3.2.2 手動フラグの操作

- **置き場所**: 名簿セクション（`RosterSection`）の中。**管理者・副管理者にのみ表示**
- ON / OFF のトグル。既定 `false`。いつでも戻せる
- **誰がいつ設定したかは記録しない**（列は boolean 1つ。ユーザー確定）
- 個人戦のグループのみ（`RosterSection` は団体戦では描画されない＝名簿は個人戦専用の仕様）
- 権限: `admin` / `vice_admin` のみ実行可。一般会員・ゲストには UI を出さず、
  Server Action も拒否する

**★効く範囲は「申込済み（`applied`）のグループ」に限られる。** `classify` は
`not_applied` / `not_applying` の分岐で `hasConfirmedRoster` を参照しないため、
未申込のグループで ON にしても**区画は動かない**（`before_deadline` / `action_required`
のまま）。`buildEntryFlow` も大会申込ステップの完了条件は `entryStatus === 'applied'`
なので、未申込のまま ON にすると「大会申込＝現在地なのに抽選＝完了」という表示になる。
これは 2026-08-02 の quickfix 以降すでに起こりうる状態だが、このトグルはそれを
1クリックで作れてしまう。**任意のフェーズへ進める汎用の逃げ道ではない**
（フェーズを自由に選ぶ案は不採用。§5 Non-goals）。未申込の大会を先へ進めたいときは
申込済みトグルを使う。

#### 3.2.3 取り消しとの整合

- 「未処理に戻す」（`undoTriage`）は `mail_kind` を `null` に戻し、そのメール由来の
  採用ファイルも削除する。したがって**シグナル3は取り消しで自動的に消える**
  （追加実装は不要）
- 手動フラグは `undoTriage` の対象外。人が明示的に立てたものなので残す

#### 3.2.4 フェーズへの反映

- **申込管理ボード**: `applied` ∧ `advance` ∧ `unpaid` のグループが
  `applied_waiting`（申込完了・抽選待ち）→ `payment_due`（名簿確定・要振込）へ移る
- **フロー帯**（大会詳細・グループページ）: 抽選ステップが完了になり、現在地が支払へ移る。
  **会員向けの大会詳細にも反映する**（ユーザー確定。ボードと会員画面でフェーズがずれない）
- **振込締切が未設定でも `payment_due` に入る**。杉並がこれ（`payment_deadline=NULL` /
  `kind='unspecified'`）。区画内の並び順は末尾になり `isDue` / `isAreaHot` も発火しない
  ——つまり**区画には入るが強調はされない**。これは既存の並び順仕様どおりで変更しない

#### 3.2.5 出場者解決には影響しない ★意図した非対称

ホーム（`/dashboard`）と外部API（`/api/external/tournament-entrants`）の出場者一覧は
`upcoming-entrants.ts` が**パース済み名簿の中身**（`rosterIdsByGroup`）だけで判定する。
今回追加する2経路は**名簿の中身を持たない**ので、これらは従来どおり出欠（希望）ベースのまま。

→ **メール連動／手動フラグだけのグループは、ボードで「名簿確定・要振込」なのに
ホームでは「希望」（`confidence: 'hoped'`）表示になる。これは意図した挙動。**
名前のデータが無いものを確定として出すことはできないため。将来これをバグと誤認しないよう
ここに明記し、AC-14 で固定する。

## 4. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-1 | `mail_kind='confirmed_roster'` ∧ `triage_status='processed'` のメールが紐づくグループは、名簿レコードが0件でも「確定名簿あり」と判定される | auto-test |
| AC-2 | 杉並AB相当の条件（`applied` / `advance` / `unpaid` / 名簿0件 / 確定名簿メールあり）で `classify` が `payment_due` を返す | auto-test |
| AC-3 | シグナル3の判定は添付の有無・採用の有無を問わない（添付ありで未採用でも成立する） | auto-test |
| AC-4 | `mail_kind` が `null`（未処理に戻した後）のメールはシグナルにならない | auto-test |
| AC-5 | `mail_kind='applicant_roster'` / `'tournament_notice'` はシグナルにならない | auto-test |
| AC-6 | `entry_groups.confirmed_roster_override=true` なら他の材料が無くても「確定名簿あり」 | auto-test |
| AC-7 | `override` を `false` に戻すと判定も戻る | auto-test |
| AC-8 | 判定はグループ単位（グループ内の全日で同じ結果になる） | auto-test |
| AC-9 | 大会詳細・グループページのフロー帯で抽選ステップが完了になり、現在地が支払へ移る | auto-test |
| AC-10 | 振込締切が未設定（`payment_deadline=NULL`）でも `payment_due` 区画に入る | auto-test |
| AC-11 | トグルは admin / vice_admin にのみ表示され、一般会員・ゲストの RSC payload に操作 UI も Server Action も現れない | auto-test |
| AC-12 | Server Action は admin / vice_admin 以外を拒否する | auto-test |
| AC-13 | 名簿が1件も無いグループでも名簿セクションが描画され、トグルへ到達できる | auto-test |
| AC-14 | **回帰**: `upcoming-entrants` の出場者判定は不変（パース済み名簿のみ。メール連動・override では confirmed パスへ切り替わらない） | auto-test |
| AC-15 | **回帰**: 既に採用ファイルがあるグループの判定は変わらない（本番の group 2 / 18 相当） | auto-test |
| AC-16 | **回帰**: 既存テスト・lint・typecheck が CI で green | auto-test |
| AC-18 | `entry_status='not_applied'` のグループで `override=true` にしても区画は変わらない（判定の入口が `applied` 限定であること＝§3.2.2 の境界） | auto-test |
| AC-17 | 本番の杉並AB（group 13）がボードで「名簿確定・要振込」に表示される | manual |

内訳: auto-test 17件 / manual 1件。

## 5. Non-goals

- **`entry_status` を自動で `applied` にすること**（杉並は既に `applied`。名簿と申込は別軸で、
  自動化すると申込完了 LINE 通知2通の発火条件と絡んで事故になる）
- 名簿の中身（`tournament_entry_roster_entries`）をメール本文から作ること
- **フェーズを任意に選べるようにすること**（「現在のフェーズを管理者が自由に指定する」案は
  不採用。日付・支払状況から導出している現在の設計と二重管理になるため。今回のトグルは
  あくまで「確定名簿ありとして扱う」であり、効くのは申込済みグループの抽選→支払だけ＝§3.2.2）
- 級別のオーバーライド（グループ単位のみ）
- 誰がいつ override を立てたかの監査記録
- `applicant`（申込名簿）メールでのフェーズ連動
- 団体戦グループへのトグル提供
- 振込締切の自動補完（杉並の `payment_deadline` は運用で入力する）
- `classify` / `buildEntryFlow` のロジック変更（入力の作り方だけを変える）

## 6. 技術的制約・契約

- **変更禁止**: `upcoming-entrants.ts` の判定と外部API（PR #495）の出力契約
- **変更禁止**: `classify` / `buildEntryFlow` の内部ロジック。両者は `hasConfirmedRoster`
  を受け取るだけなので、**入力の組み立て方だけを変える**
- **マイグレーション 0058**（次番号）: `entry_groups` へ
  `confirmed_roster_override boolean NOT NULL DEFAULT false` を追加。
  `entry_groups` は「意図的に列を持たない」と schema コメントに明記されているため、
  **同じコミットでそのコメントを更新する**（この列がグループに属する理由＝判定材料が
  すべてグループスコープであること、`events` に置くと AC-17 の不変条件が壊れること）
- **RSC payload**: `RosterSection` は `'use client'` で全ロールに描画される。`isAdmin` を
  props で受け、**非管理者には Server Action を bind しない**。`{cond && <JSX>}` だけで
  隠すと payload には載る（PR #376 の教訓。同ファイル群の既存コメント参照）
- 判定は現在3箇所で個別に組まれている（`admin/entries/page.tsx` /
  `admin/entries/[groupId]/page.tsx` / `events/[id]/page.tsx`）。材料が2→4に増えるので
  **共通の純関数へ寄せる**（3箇所で条件がずれると再発する）
- `mail_kind='confirmed_roster'` を書くのは `processMail` のみ
  （`triggerExtractDraft` は `'tournament_notice'` のみ）。`triage_status='processed'` は
  同一トランザクションで立つので、条件に併記しても偽陰性は生まれない
- 既存データへの影響: 追加列は default false、シグナル3は本番の既存3グループで
  判定結果を変えない（§1 の表）。**移行スクリプト不要**
- **シグナル3の帰属は間接**: シグナル2（採用ファイル）は `entry_group_id` を直接持つが、
  シグナル3は `linked_event_id → events.entry_group_id` で辿る。そのイベントが後から
  別グループへ移されると**シグナルはイベントに付いて移動し、元のグループからは消える**。
  どの瞬間を取ってもグループ内の全日で判定は一致する（AC-8 は保たれる）ので不変条件の
  破れではないが、挙動として記録しておく
- **トグルの現在値の取得経路**: 判定結果（boolean）と `confirmed_roster_override` の
  生値は**同じローダーから返す**。UI がフラグを読むために4つ目の場当たりクエリを足すと、
  「判定の正典は1つ」という本改修の目的が崩れる

## 7. 設計判断の根拠

1. **`mail_kind` をシグナルに採用した**: `undoTriage` が `mail_kind` と採用ファイルを
   同時に戻すので、取り消し時の整合が既に取れている。新たな不整合経路を作らずに済む
2. **添付の有無で条件分岐しない**（ユーザー確定）: 判定が単純になり、「本文だけの確定連絡」
   という実運用パターン（杉並）を素直に拾える。採用し忘れの検知力は落ちるが、
   確定名簿メール5件中3件は既に採用済みで実害が観測されていない
3. **override を `entry_groups` に置く**: 既存の判定材料がすべてグループ単位で、
   `events` に置くと「グループ内のどの日から見ても同じ」という不変条件
   （entry-management AC-17）が壊れる
4. **監査情報を持たない**（ユーザー確定）: 運用は1人で、いつ誰が立てたかを追う必要がない
5. **会員向けにも反映する**（ユーザー確定）: 確定連絡は実際に届いているので、会員が見る
   フローも進むのが正しい。ボードと会員画面でフェーズがずれない
6. **出場者解決は広げない**: 名前のデータが無い。confirmed パスへ切り替えると
   出場者が空リストになり、ホームと外部APIが壊れる（§3.2.5）
7. **トグルを名簿セクションに置く**（ユーザー確定）: 名簿の話なので意味的に最も近く、
   名簿0件のときも `RosterSection` はセクションを描画する（`kind !== 'individual'` の
   ときだけ `null` を返す設計。既存コメントに明記あり）ので、必要な状況で必ず到達できる。
   グループページの「進行管理」は design-spec で表示専用と決めてあり、そちらは避ける

## 変更履歴

- 2026-08-21: 新規作成（杉並AB の滞留を起点に、確定名簿シグナルを `mail_kind` と
  手動フラグへ拡張する改修として定義。理由: 添付のない確定連絡メールでは確定を
  記録する手段が存在せず、フェーズが構造的に進めなくなっていたため）
