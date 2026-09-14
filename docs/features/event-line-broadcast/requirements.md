---
status: completed
---

# event-line-broadcast 要件定義書

## 1. 概要

### 目的
承認済み大会案内メール（本文・添付）を、参加者の LINE グループに自動配信する。管理者の手動転送を不要にする。

### 背景・動機
- 現状: 管理者が大会参加確定者を集めた LINE グループを毎大会立ち上げ、運営から届くメールを **手動で要約・転送** している
- 訂正版・補足連絡が来るたびに転送オペが発生し、見落としリスクもある
- `mail-tournament-import` (P3-A) で「メール取り込み → AI 抽出 → 管理者承認 → events 登録」までは整備済み。その下流の "参加者への配信" を自動化することで運用負荷を完全に消す

### 位置付け
P2「大会運営」と P3「AI+メール」のクロスオーバー。`mail-tournament-import` 完了後の延長線上として実装する。AI 抽出フェーズ（PR3 までの extracted_payload）には依存せず、配信内容には **メール本文と添付の生データを使う**。

---

## 2. ユーザーストーリー

### 対象ユーザー
- **管理者 / 副管理者** (`admin` / `vice_admin`): 招待コード発行・配信操作・Bot プール管理を行う実質 1 名
- **大会参加者**: LINE グループに居て配信を受け取る、Bot に話しかけることはほぼ無い（招待コード入力時のみ）

### 利用シナリオ

**シナリオ A: 通常配信**
1. AJKA ML 等から大会案内メールが届く → 既存 mail-worker が取り込み → AI 抽出 → 管理者通知
2. 管理者が `/admin/mail-inbox/[id]` で承認 → events 登録
3. 管理者が `/events/[id]` の「LINE 配信」セクションを開く → 「招待コード生成」ボタンで 6 桁コード発行 + Bot 友だち追加 URL 表示
4. LINE で管理者が大会参加者グループを作成、表示されている `kagetra-event-bot-N` を友だち追加 → グループに招待
5. グループで管理者が「123456」と発言 → Bot が認識して紐付け完了。案内メッセージ①〜④（§3.1.3）を返信し、続けて選択済みの要綱ファイルを送る
6. 以降、この大会宛の追加メール（補足連絡・訂正版）が承認されるたびに、自動でこのグループに配信される

**シナリオ B: 訂正版メール**
1. 訂正版メールが届く → 既存 AI が `is_correction: true` で判定
2. 管理者が `/admin/mail-inbox/[id]` で承認時に「既存 draft の訂正版として紐付け」モードで承認（既存 events の `id` を引き継ぐ）
3. 自動配信が走り、LINE には先頭に「【訂正】」プレフィックス付きで本文・添付が配信される

**シナリオ C: 紐付け前に承認したメール**
1. 大会案内を承認 → events 登録、まだ LINE グループは作っていない
2. 紐付けより前の承認メールは **バックフィルしない**（仕様）。口頭か LINE 内で別途共有する
3. 紐付け後の追加メールから自動配信開始

**シナリオ D: 大会終了 → Bot 解放**
1. `events.event_date + 30 day` を超えた `linked` 状態の broadcast は、日次バッチで `released` 状態 → `line_channels.status='available'` に戻る
2. 大会後の打ち上げ・反省連絡を吸収するため 30 日バッファを取る
3. 管理者が手動で「もう少し延ばす」「今すぐ解放」も可能

**シナリオ E: Bot プール枯渇**
1. 30 Bot が全て `assigned` / `active` 状態で、新規大会の招待コード生成不可
2. `/events/[id]` で「Bot プール枯渇、過去大会の解放待ちです」エラー
3. `/admin/line-channels` で `active` な行を確認、用済みなら手動解放

**シナリオ F: 自動紐付け失敗時のフォールバック**
1. Bot 招待後にグループでコード発言 → 何らかの理由で webhook が届かない / 認識失敗
2. 管理者が `/admin/line-channels/[id]` で「手動紐付け」モーダルを開き、グループ ID を直接入力（LINE 側で確認した groupId をペースト）

---

## 3. 機能要件

### 3.1 画面仕様

#### 3.1.1 `/events/[id]` 「LINE 配信」セクション (既存画面に追加)

`MobileShell` レイアウト内、出欠セクションの下に新規セクション。
**未紐付け状態**:
- 「LINE 配信を有効化」ボタン
- クリック → 招待コード生成モーダル
  - 招待コード: `123456` (大きく表示、コピー可)
  - 有効期限: `30 分以内 (2026-05-25 12:34 まで)`
  - Bot 友だち追加 QR / `https://line.me/R/ti/p/@xxxxx`
  - 操作手順 (1) 友だち追加 (2) グループ作成 (3) Bot 招待 (4) コード発言

**紐付け済み状態**:
- 「連携中: kagetra-event-bot-15 (グループ ID: `Cxxx...` 末尾 8 文字のみ表示)」
- 「最終配信日時: 2026-05-20 10:30」
- 配信履歴テーブル (この event に紐づく `mail_messages` を時系列):
  - 受信日時 / 件名 / 配信ステータス (`未配信` / `配信済み` / `部分失敗` / `失敗`) / 「再配信」ボタン
- 「連携解除」ボタン (確認モーダル付き)

#### 3.1.2 `/admin/line-channels` 一覧画面 (新規)

`admin` / `vice_admin` のみアクセス可。30 Bot の状態管理画面。
- フィルタ: ステータス (available / assigned / active / disabled)
- 一覧テーブル: id, botId (`@kagetra-event-bot-N`), status, purpose, 紐付け中 event, 紐付け日時, 残り日数 (event_date + 30 - now)
- 各行アクション: 「強制解放」「無効化 / 有効化」「手動紐付け」
- ヘッダー警告: `active` が 25/30 を超えたら「Bot プール枯渇間近、過去大会の解放を確認してください」

#### 3.1.3 招待コード入力 (LINE グループ内 Bot 対話)

Bot が処理する Webhook イベント:
- `join` (Bot がグループに招待された):
  - **返信しない**（2026-08-22 改訂。従来の「30 分以内に招待コードを発言してください」案内を廃止）。
    replyToken は消費せず、状態の記録だけを行う
  - `event_line_broadcasts.status` を該当行 (channel_id 一致) に対して `joined_waiting_code` に遷移、`line_group_id` を記録
- `message` (type=text, `^\d{6}$` パターン):
  - 該当 invite_code を持つ `event_line_broadcasts` 行を検索
  - 期限内 + status='joined_waiting_code' + line_channel_id == destination → `linked` に遷移し、
    **下記①〜④を4通の別メッセージとして返信**（reply は1回5通までなので4通は1リクエストに収まる）。
    続けて選択済みの要綱ファイルを Flex カードで push する（§3.4 の既存挙動・⑤以降にあたる）
  - 不一致 / 期限切れ → 「❌ 招待コードが無効です。管理者に最新のコードを確認してください。」返信
- `leave` (Bot がグループから外された) / `memberLeft` (Bot 自身):
  - `event_line_broadcasts.status='revoked'`、`line_channels.status='available'` に戻す
- 上記以外のメッセージ (type=text で 6 桁数字パターン外、image, sticker など): **完全無視・無応答**

**紐付け完了時の案内（①〜④）** — 2026-08-22 新設。番号ごとに吹き出しを分ける。

| # | 文面 | 情報源 |
|---|---|---|
| ① | `〇〇大会案内用LINEグループです！`<br>`以下確認をお願いします。` | `〇〇` = `deriveEntryGroupName`（複数日は `大阪AB` 形式） |
| ② | `@All`<br>`大会の申し込み締め切りはM/D(曜)です。当日までにこのLINE BOTから申込をした旨のアナウンスが届かない場合は申込を忘れているので、管理者を急かしてください。` | `events.entry_deadline`（**主催者締切**。会内締切ではない）。書式は `formatEventDate` |
| ③ | `@管理者`<br>`グループの人数が〇名であることを確認してください。`<br>（空行）<br>`内訳`<br>`大会参加者：〇名`<br>`管理者：〇名（名字 or 理由）`<br>`会計：〇名（名字 or 理由）`<br>`副連絡責任者：〇名（名字 or 理由）`<br>`Bot：1名` | §3.1.3a（下記）。**2026-09-14 改訂**：単一の人数から役割別の内訳へ |
| ④ | `以下大会要項になります、適宜ご確認ください` | 固定文 |

- **②③のメンション**は `textV2` で送る。②は `@All`、③は **`role='admin'` の会員のみ**
  （2026-09-14 改訂。従来は `role IN ('admin','vice_admin')` 全員）。
  規則の正典は [line-bot-message-revamp/requirements.md](../line-bot-message-revamp/requirements.md) §3.1.3 / §3.2
- **締切はグループ単位で必ず同一**という運用前提に立ち、日別に出し分けない（万一ずれたら運用で吸収する）
- `entry_deadline` が NULL のときは②の日付部分を「未定」とする

#### 3.1.3a ③「グループの人数確認」の内訳（2026-09-14 改訂）

③は「LINE グループに**いるはずの人数**」を役割ごとに分解して提示し、管理者が LINE アプリの
メンバー数と突き合わせられるようにする。**5つの行は互いに排他で、その単純和が先頭の合計**になる。

##### 母集団の共通条件

- 対象イベント: そのグループの全イベントのうち `status != 'cancelled'`
- 出欠: `event_attendances.attend = true`（「参加」回答）
- 級フィルタ（現行維持）: `eligible_grades` が非空 → `is_invited = true AND grade IN (eligible_grades)`、
  NULL/空配列 → `is_invited = true` だけ
- **実人数**（グループ全体で重複排除。複数日に出ていても1人）
- 役割行に数えるのは `line_user_id IS NOT NULL AND deactivated_at IS NULL` の会員だけ
  （LINE を紐付けていない人はグループに入れないため）

##### 各行の定義

| 行 | 母集団 | 表示 |
|---|---|---|
| 大会参加者 | 上記の共通条件を満たす会員。**`role='guest'` は除外** | `〇名` |
| 管理者 | `role='admin'` | `〇名（名字）` |
| 会計 | `is_treasurer = true` | `〇名（名字）` |
| 副連絡責任者 | `is_travel_report_submitter = true` | `〇名（名字）`。§3.1.3b の特則あり |
| Bot | 紐付け先グループに在籍する Bot 自身 | 常に `1名` |

- **ゲストはどの行にも数えない。** ゲストは大会別 LINE グループに招待しない運用のため
  （2026-09-14 に前提を反転。それまでは「グループには他会の参加者も入る」前提でゲストを含め、
  「内他会〇名」を併記していた）。**「内他会〇名」の併記は廃止する**。
  ゲストの存在は §3.1.3b の副連絡責任者の判定にだけ使う
- 名字は `users.family_name`。NULL のときは `users.name` をそのまま出す（本番は全会員が `family_name` 済み）
- 複数該当は全員を中黒で並べる（`users.id` 昇順）: `2名（酒井・飯塚）`
- 該当者が0人（フラグ未設定・LINE 未紐付けで全滅）なら `0名（未設定）`

##### 排他の規則（1人1バケット）

同じ人が複数の役割に該当することがある（会計は運用上 `role='vice_admin'`、副連絡責任者が
管理者を兼ねる等）。**先頭の合計を正しく保つため、1人はどこか1行にだけ数える。**

優先順位: **大会参加者 ＞ 会計 ＞ 副連絡責任者 ＞ 管理者**

先に確定した行へ寄せ、後の行からは外す。外れて0名になった行には理由を注記する。

| 外れた理由 | 注記 |
|---|---|
| その人が大会参加者だった | `0名（大会参加のため）` |
| 会計の行へ寄せた | `0名（会計として計上のため）` |
| 副連絡責任者の行へ寄せた | `0名（副連絡責任者として計上のため）` |

複数該当者の一部だけが外れた場合は、残った人数と名字をそのまま出す。
**この表の注記が付くのは「その行が0名になった」ときだけ**で、1名以上残る行には付かない。
副連絡責任者の行だけは、これとは別に §3.1.3b の注記（`遠征届不要のため` / `他会参加者ありのため`）を
**外れた人数に関係なく**評価する — `2名（飯塚・酒井・他会参加者ありのため）` のような形もありうる。

また `0名（未設定）` は「フラグが立っていない」だけでなく、**該当者はいるが全員 LINE 未紐付け・
無効化されている**場合も含む。どちらもその人はグループに入れないので合計に数えない。

#### 3.1.3b 副連絡責任者の行の特則

副連絡責任者は**遠征届が要るときだけ**グループに入る。上の排他を適用したうえで、次の順に判定する。

1. 該当者（1人以上）が**全員 大会参加者** → `0名（大会参加のため）`
2. **遠征届が不要** → `0名（遠征届不要のため）`
3. **該当者が0人**（フラグ未設定・LINE 未紐付けで全滅） → `0名（未設定）`
4. **ゲスト参加者がいる** → `1名（名字・他会参加者ありのため）`
5. それ以外 → `1名（名字）`

> 2を3より先に見るのは、遠征届が要らない大会で「副連絡責任者が未設定です」という
> 無用な警告を出さないため。逆に**遠征届が要るのに該当者が0人**のときだけ `0名（未設定）` が出て、
> フラグの設定漏れに気づける。

★**2に該当したとき、この行は該当者を1人も抱えない**（＝排他の「副連絡責任者」バケットが空になり、
残った該当者は管理者の行へ落ちる）。遠征届が不要ならその人は副連絡責任者としてはグループに
入らないが、管理者ならグループにはいるため — ここで抱え込むと**副連絡責任者を兼ねる管理者が
どの行にも計上されず**、先頭の合計が実人数より少なくなる（AC-H2 違反）。
一方で**注記の判定（1と2の順序）は排他を適用した結果で決める**ので、
「全員が大会参加者」なら遠征届が不要でも1が勝つ。

**遠征届が必要**＝次のいずれかが1人以上いること（母集団の共通条件を満たす参加者のうち）:

- `is_circle_member = true` の会員
- **ゲスト参加者**（`role='guest'`）。ゲストは北大かるた会サークル員なので、
  `is_circle_member` フラグの ON/OFF に関係なく**無条件で遠征届の対象**とする

> ★[travel-report](../travel-report/requirements.md) R5 の正式な対象者判定は
> 「サークル所属 ON ∧ 参加 ∧ 有効な確定状況が『確定』」だが、**確定状況は紐付け時点では存在しない**
> （名簿確定は紐付けの数週間後）。③はあくまで紐付け直後の目安なので、**確定状況は参照しない**。
> 抽選で落選して後から対象ゼロになることは許容する。

3の注記は「グループに見えているサークル員がいないのに副連絡責任者がいる」理由を管理者へ示すためのもの。


#### 3.1.3c ③改訂の Acceptance Criteria（2026-09-14）

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-H1 | ③の本文が「合計1行＋空行＋`内訳`＋5行（大会参加者・管理者・会計・副連絡責任者・Bot）」の形で送られる | auto-test |
| AC-H2 | 先頭の合計＝5行の人数の和（Bot の1名を含む）。**役割保持者が大会参加者や別の役割を兼ねるケースでも、合計がテスト側で独立に数えた「グループにいるはずの実人数」と一致する**（合計を行の和として出すだけでは通らないテストにすること） | auto-test |
| AC-H3 | `role='guest'` の参加者は大会参加者の人数に含まれない | auto-test |
| AC-H4 | 「内他会〇名」の併記がどのケースでも出ない | auto-test |
| AC-H5 | 管理者の行は `role='admin'`、会計は `is_treasurer`、副連絡責任者は `is_travel_report_submitter` を母集団とする | auto-test |
| AC-H6 | 役割行に数えるのは `line_user_id IS NOT NULL AND deactivated_at IS NULL` の人だけ | auto-test |
| AC-H7 | 役割行は `1名（土居）` のように `family_name` を出す。`family_name` が NULL なら `users.name` を出す | auto-test |
| AC-H8 | 複数該当は `2名（酒井・飯塚）` のように `users.id` 昇順の中黒区切りで全員並ぶ | auto-test |
| AC-H9 | 該当者0人の役割行は `0名（未設定）` | auto-test |
| AC-H10 | 役割該当者が大会参加者でもあるとき、その役割行は `0名（大会参加のため）` になり、合計に二重計上されない | auto-test |
| AC-H11 | 排他の優先順位は 大会参加者 ＞ 会計 ＞ 副連絡責任者 ＞ 管理者。会計を兼ねる管理者は `0名（会計として計上のため）` | auto-test |
| AC-H12 | 副連絡責任者: サークル所属 ON の参加会員もゲスト参加者もいなければ `0名（遠征届不要のため）` | auto-test |
| AC-H13 | 副連絡責任者: ゲスト参加者が1人以上なら遠征届必要と判定し `1名（飯塚・他会参加者ありのため）` | auto-test |
| AC-H14 | 副連絡責任者: サークル所属 ON の参加会員がいてゲストがいなければ `1名（飯塚）` | auto-test |
| AC-H15 | 副連絡責任者の判定で確定状況（travel-report の `確定`）を一切参照しない | auto-test |
| AC-H16 | ③の `@管理者` メンション対象が `role='admin'` の会員だけになる（`vice_admin` は呼ばれない） | auto-test |
| AC-H17 | メンション対象が0人でも③は素テキストの `@管理者` 行で送信される（既存挙動の維持） | auto-test |
| AC-H18 | 名字に `{` `}` が含まれても例外を投げず、textV2 を壊さない形で送信できる。**`{m0}` のように substitution のキーそのものに見える文字列でもメンションが壊れない** | auto-test |
| AC-H19 | 中止（`status='cancelled'`）の日の参加回答は数えない | auto-test |
| AC-H20 | 級フィルタが維持される（`eligible_grades` 非空 → `is_invited AND grade IN (...)`、NULL/空 → `is_invited` のみ） | auto-test |
| AC-H21 | 複数日に参加している人は1人として数える（実人数・重複排除の維持） | auto-test |
| AC-H22 | ①②④の文面と `deriveEntryGroupName` / `entry_deadline` の導出が変わらない | auto-test |
| AC-H23 | reply 失敗時の push フォールバックと `bindingStillLinked` の両送信点での再検証が変わらない | auto-test |
| AC-H24 | 既存テスト・lint・typecheck が CI で green | auto-test |
| AC-H25 | 本番で実際に Bot を大会グループへ紐付けたとき、新しい③が届き、内訳の合計が LINE のメンバー数と一致する | manual |

##### この改訂の範囲外（Non-goals）

- LINE の `GET /v2/bot/group/{groupId}/members/count` による**実在籍人数の自動照合**。
  ③はあくまで「いるはずの人数」を出し、突き合わせは管理者が目視で行う
- 参加費集計（`tallyEntryFeesForGroup`）の母集団変更。あちらは延べ・ゲスト除外のまま
- [travel-report](../travel-report/requirements.md) R5 の正式な対象者判定（確定状況込み）の変更
- 役割フラグの本番投入（`is_circle_member` / `is_travel_report_submitter` の設定）。
  これはコード変更ではなく**運用**。現在の本番は両方とも未設定で、
  そのままだと副連絡責任者の行は常に `0名（遠征届不要のため）` になる
- ①②④および他の通知（E-1〜・F-1〜・振込連絡）の文面変更
- `loadAdminLineUserIds` / `resolveAdminMention` の既存シグネチャの意味変更
  （`@管理者` を admin+vice_admin と解釈する汎用ヘルパーはそのまま残す）

### 3.2 ビジネスルール

#### 3.2.1 配信トリガー
- mail-inbox の `approveDraft` server action 内で、events 登録 commit 後に **非同期で** 配信処理を呼ぶ
  - 同じ大会 (`tournament_drafts.event_id`) に紐付く `event_line_broadcasts.status='linked'` な行があれば配信
  - 訂正版 (`is_correction=true`) の場合は先頭に「【訂正】」プレフィックス付与
- 配信失敗は events 登録に影響しない (best-effort)、`event_broadcast_messages` に `failed` で記録

#### 3.2.2 紐付けルール
- **1 大会 1 グループ縛り** (`event_line_broadcasts.event_id` UNIQUE)
- 招待コード: 6 桁数字、30 分有効、1 回限り
- 期限切れ後は同じ event で再生成可能 (status='invite_pending' に戻る)
- Bot 招待 (join 受信) → status='joined_waiting_code'、`line_group_id` 記録
- コード認識 → status='linked'、`linked_at` 記録
- Bot kick (leave) → status='revoked'、`line_channels.status='available'`

#### 3.2.3 Bot プール管理
- `line_channels.purpose='event_broadcast'` の行が初期 30 個
- 状態遷移:
  - `available` → 招待コード発行で `assigned` (line_channels には event との紐付けを示す `assigned_event_id` 列を追加)
  - `assigned` → コード期限切れで `available` に自動復帰 (日次 cron)
  - `assigned` → コード入力成功で `active`
  - `active` → 大会終了 +30 日経過で日次 cron が `available` へ
  - 手動解放ボタン: いつでも `available` へ
- Bot 個別の `disabled` (LINE 側無効化等): 手動切替

#### 3.2.4 メッセージ作成ルール
- メール本文:
  - `mail_messages.body_text` (HTML→text 変換済み) をそのまま送信
  - 5000 文字超: 段落 / 改行境界で複数 text メッセージに分割
  - 訂正版: 最初の text メッセージ先頭に「【訂正】」プレフィックス + 元 draft の件名 (`references_subject`) 添え
- 添付:
  - **PDF**: `pdfjs-dist` で各ページを JPEG 化 (150 DPI, quality 85)、ページ順に image メッセージ送信
  - **Word (.docx)**: `libreoffice --headless --convert-to pdf` で一時 PDF 化 → 同じく pdfjs-dist で画像化
  - **Excel (.xlsx)**: 画像化せず、`attachment_share_tokens` から期限付き署名 URL を生成、Flex Message のダウンロードボタンとして送信
  - **30 ページ超**: 画像化を打ち切り、「📎 多ページ PDF / Word です → Web で見る https://new.hokudaicarta.com/api/line-broadcast/attachments/[token]」のテキスト + リンクに切り替え
  - **画像化失敗** (libreoffice / pdfjs エラー): 該当添付のみスキップ、署名 URL リンクで代替

#### 3.2.5 LINE 送信制御
- LINE Messaging API の `pushMessage` 1 push = max 5 message、batch push を使って順次配信
- LINE 無料枠 200 通 / 月 / Bot を勘案: 1 大会 1 Bot で月数十通配信、年 10 大会 × 30 Bot で十分余裕
- rate limit 配慮で push 間に 1.5 秒間隔 (sleep)
- 429 (rate limit) は SDK が `Retry-After` 尊重して自動 retry
- 401 (token expired): 該当 Bot を `disabled` 化 + 管理者通知

#### 3.2.6 添付ダウンロード URL (期限付き署名 URL)
- `GET /api/line-broadcast/attachments/[token]`
- `attachment_share_tokens` テーブルで管理、token は 32 文字 URL セーフ (`crypto.randomBytes(24).toString('base64url')`)
- 有効期限 60 日、超過後は 404
- 認証不要 (LINE グループの非ログインゲストも DL 可能)
- レスポンス: bytea を `Content-Type: <元の MIME>` + `Content-Disposition: inline; filename="..."` で返却

#### 3.2.7 画像配信用 URL (LINE が画像取得に来る短期 URL)
- `GET /api/line-broadcast/images/[token]`
- LINE Messaging API の `image` message は `originalContentUrl` / `previewImageUrl` を要求する仕組み → 公開アクセス可能な HTTPS URL が必要
- 画像生成済みバイナリを一時メモリ / 短期キャッシュ (24 時間)、token で照会
- 別途 DB テーブルは不要、Redis / in-memory cache で十分（apps/web のメモリで OK、再起動時は失われるが LINE はその時点で配信済みなので問題なし）

#### 3.2.8 大会終了後の自動解放
- 日次 systemd timer で `apps/web/scripts/release-expired-broadcasts.ts` を実行
- 条件: `events.event_date + 30 < today AND event_line_broadcasts.status='linked'`
- 処理: status='released'、line_channels.status='available'、 `released_at` 記録

#### 3.2.9 エラー処理
| 失敗種別 | 対応 |
|---|---|
| LINE API 429 (rate limit) | SDK が Retry-After 尊重、自動 retry |
| LINE API 401 (token expired / invalid) | 該当 Bot を `disabled` 化 + system 通知 Bot 経由で管理者通知 |
| LINE API 4xx (groupId 不正、Bot kick 済み) | event_line_broadcasts.status='revoked'、line_channels.status='available' に戻す、管理者通知 |
| Bot プール枯渇 (available 行ゼロ) | 招待コード生成 UI でエラー表示「Bot プール枯渇、`/admin/line-channels` で解放を確認」 |
| libreoffice 変換失敗 | 該当 docx をスキップ、署名 URL リンクで代替送信 |
| pdfjs 画像化失敗 | 該当 PDF をスキップ、署名 URL リンクで代替送信 |
| webhook 署名検証失敗 | 401 返却、ログ記録 (LINE 以外からのアクセス試行) |

### 3.3 権限
- 招待コード生成: admin / vice_admin
- 配信トリガー (承認時自動): admin / vice_admin が承認操作した時のみ起動
- 手動再配信ボタン: admin / vice_admin
- `/admin/line-channels`: admin / vice_admin
- 一般会員 (member): events 詳細画面で「この大会は LINE 配信連携中です」程度の参照のみ。Bot 名・グループ ID は表示しない

---

## 4. 技術設計

### 4.1 API 設計

#### Server Actions (apps/web)
- `generateInviteCode(eventId)` → `{ inviteCode, botId, expiresAt, addFriendUrl }` を返却。`line_channels.purpose='event_broadcast' AND status='available'` から 1 行を `assigned` に遷移、`assigned_event_id` セット、`event_line_broadcasts` 行 INSERT (status='invite_pending')
- `regenerateInviteCode(eventId)` → 期限切れコードの再発行 (同じ channel 維持)
- `releaseChannel(eventId)` → 手動解放、status='active' → 'available'、`line_channels.assigned_event_id` クリア
- `extendBroadcastLifetime(eventId, days)` → events.event_date 起点の 30 日カウンタを延長 (event_line_broadcasts.extended_until 列)
- `manualBroadcast(eventId, mailMessageId)` → 配信履歴に再 INSERT もしくは status='pending' へ戻して配信処理キック
- `manualLinkGroup(eventId, channelId, lineGroupId)` → 自動紐付け失敗時のフォールバック、`event_line_broadcasts.status='linked'` 直接設定
- `revokeBroadcast(eventId)` → 連携解除、status='revoked'、line_channels.status='available'

#### HTTP API
- `POST /api/webhook/line` (公開):
  - LINE Messaging API webhook 受信。`X-Line-Signature` ヘッダー検証 (HMAC-SHA256 with channelSecret)
  - 各 Bot の channelSecret は `line_channels.channel_secret` から `destination` で引く
  - event types: `join`, `leave`, `memberJoined`, `memberLeft`, `message` (type=text の 6 桁数字のみ処理)
  - その他は 200 OK のみ返す (LINE 仕様)
- `GET /api/line-broadcast/attachments/[token]` (公開):
  - attachment_share_tokens で照会、期限切れは 404
  - bytea を `Content-Type` + `Content-Disposition: inline` で返却
- `GET /api/line-broadcast/images/[token]` (公開、短期):
  - in-memory cache 経由で画像バイナリ返却、TTL 24h

### 4.2 DB 設計

#### 既存テーブル変更

**`line_channels`** (PR5-r2 既存):
- `purpose` 列追加 (新規 enum `line_channel_purpose`: `'system_notify' | 'event_broadcast'`)
- 既存 system 行: migration で `purpose='system_notify'` セット
- `assigned_event_id` 列追加 (integer, nullable, fk → events.id ON DELETE SET NULL) — event_broadcast 用
  - 既存 `assigned_user_id` は system_notify / 将来の user 通知用、broadcast 行では NULL
- 同一 channel が同時に 2 大会に紐付かないよう UNIQUE 制約: `assigned_event_id` UNIQUE (NULL は重複可)
- `note` 列でユーザー側表示名「kagetra-event-bot-N (N=1..30)」を保持

#### 新規テーブル

**`event_line_broadcasts`** — 1 大会 1 連携:

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | integer | pk identity | |
| event_id | integer | UNIQUE not null fk → events.id ON DELETE CASCADE | 1 大会 1 連携 |
| line_channel_id | integer | not null fk → line_channels.id ON DELETE RESTRICT | |
| invite_code | text | nullable | 6 桁数字 |
| invite_code_expires_at | timestamp tz | nullable | |
| line_group_id | text | nullable | Bot join 時に webhook が記録 |
| status | event_line_broadcast_status | not null default 'invite_pending' | |
| linked_at | timestamp tz | nullable | |
| extended_until | date | nullable | 30 日デフォルトを延長したい場合の上書き |
| released_at | timestamp tz | nullable | |
| revoked_at | timestamp tz | nullable | |
| revoke_reason | text | nullable | "manual" / "bot_kicked" / "channel_disabled" |
| created_at | timestamp tz | not null default now() | |
| updated_at | timestamp tz | not null default now() | |

UNIQUE partial index: `(invite_code) WHERE invite_code IS NOT NULL AND invite_code_expires_at > now()` — 期限内のコード一意性

`event_line_broadcast_status` enum: `'invite_pending' | 'joined_waiting_code' | 'linked' | 'revoked' | 'released'`

**`event_broadcast_messages`** — 配信履歴 (1 メール = 1 配信):

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | integer | pk identity | |
| event_line_broadcast_id | integer | not null fk → event_line_broadcasts.id ON DELETE CASCADE | |
| mail_message_id | integer | not null fk → mail_messages.id ON DELETE RESTRICT | |
| status | event_broadcast_message_status | not null default 'pending' | |
| is_correction | boolean | not null default false | 送信時 prefix 付与の根拠 |
| sent_text_count | integer | not null default 0 | |
| sent_image_count | integer | not null default 0 | |
| fallback_link_count | integer | not null default 0 | 画像化失敗で署名 URL に切替えた添付数 |
| error_message | text | nullable | |
| sent_at | timestamp tz | nullable | 最終的に配信完了した時刻 |
| created_at | timestamp tz | not null default now() | |
| updated_at | timestamp tz | not null default now() | |

UNIQUE `(event_line_broadcast_id, mail_message_id)` — 重複配信防止

`event_broadcast_message_status` enum: `'pending' | 'sending' | 'sent' | 'partial' | 'failed'`

**`attachment_share_tokens`** — 60 日有効署名 URL:

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | integer | pk identity | |
| mail_attachment_id | integer | not null fk → mail_attachments.id ON DELETE CASCADE | |
| token | text | UNIQUE not null | URL セーフ 32 文字 |
| expires_at | timestamp tz | not null | created_at + 60 day |
| access_count | integer | not null default 0 | アクセス計測用 (DL 履歴の参考値) |
| created_at | timestamp tz | not null default now() | |

INDEX `(mail_attachment_id)`、INDEX `(expires_at)` (期限切れトークン削除バッチ用)

#### 新規 Enum
- `line_channel_purpose`: `'system_notify' | 'event_broadcast'`
- `event_line_broadcast_status`: `'invite_pending' | 'joined_waiting_code' | 'linked' | 'revoked' | 'released'`
- `event_broadcast_message_status`: `'pending' | 'sending' | 'sent' | 'partial' | 'failed'`

### 4.3 フロントエンド設計

```
apps/web/src/app/(app)/
  events/[id]/page.tsx                          # 既存。LineBroadcastSection を追加
  admin/line-channels/
    page.tsx                                    # 新規 (30 Bot 管理)
    [id]/page.tsx                               # 新規 (個別 Bot 詳細・手動紐付け)

apps/web/src/components/events/
  LineBroadcastSection.tsx                      # 新規 (events 詳細用)
  InviteCodeModal.tsx                           # 新規 (招待コード表示)
  BroadcastHistoryTable.tsx                     # 新規 (配信履歴)

apps/web/src/components/admin/
  LineChannelTable.tsx                          # 新規
  ManualLinkModal.tsx                           # 新規

apps/web/src/app/api/
  webhook/line/route.ts                         # 新規
  line-broadcast/attachments/[token]/route.ts   # 新規
  line-broadcast/images/[token]/route.ts        # 新規
```

ナビゲーション: `/admin` メニューに「LINE 配信 Bot 管理」を追加 (admin / vice_admin のみ表示)。

### 4.4 バックエンド設計

#### 新規モジュール

```
apps/web/src/lib/
  line-broadcast.ts                # 配信処理本体
  attachment-image-render.ts       # PDF / Word の画像化
  invite-code.ts                   # 6 桁コード生成・検証

apps/web/scripts/
  seed-broadcast-channels.ts       # 初期 30 Bot 投入
  release-expired-broadcasts.ts    # 日次 cron (30 日経過解放)
  cleanup-expired-tokens.ts        # 日次 cron (60 日超 token 削除)
```

#### 配信処理 (apps/web/src/lib/line-broadcast.ts)

```typescript
async function broadcastMailToEvent(
  db: Db,
  eventId: number,
  mailMessageId: number,
  isCorrection: boolean,
): Promise<BroadcastResult> {
  // 1. event_line_broadcasts.status='linked' な行を取得
  // 2. mail_messages + mail_attachments を取得
  // 3. event_broadcast_messages を INSERT (status='sending')
  // 4. text 本文を 5000 字で分割、prefix「【訂正】」付与（is_correction）
  // 5. 添付ごとに:
  //    - PDF: pdfjs-dist で画像化 → image messages
  //    - Word: libreoffice → pdfjs-dist で画像化
  //    - Excel: 署名 URL 生成 → flex message
  //    - 30 ページ超: 署名 URL 生成 → text + link
  // 6. LINE pushMessage を 5 message/batch で順次送信、1.5 秒間隔
  // 7. event_broadcast_messages を status='sent' / 'partial' / 'failed' に更新
}
```

#### 画像化処理 (apps/web/src/lib/attachment-image-render.ts)

```typescript
async function renderPdfToJpegs(pdfBuffer: Buffer): Promise<Buffer[]>
async function renderDocxToJpegs(docxBuffer: Buffer): Promise<Buffer[]>  // libreoffice + pdfjs
async function getOrCreateShareToken(db: Db, attachmentId: number): Promise<string>
```

- pdfjs-dist: PDF を canvas に描画、`canvas.toBuffer('image/jpeg', { quality: 0.85 })`
- 150 DPI で A4 → 約 1240x1754 px、JPEG ~150-300 KB / page
- LINE image 制限: 10 MB / image、preview は 240x240 まで
- 30 ページ超は画像化打ち切り

#### LINE 配信ライブラリ (line-broadcast.ts)

`@line/bot-sdk` v11 の `MessagingApiClient.pushMessage` を使用。
- 既存 `apps/mail-worker/src/notify/line.ts` の `pushSystemNotification` がパターン
- 違い: token を `line_channels` の `event_broadcast` 用行から引く、グループ ID 宛 push
- batch push: 5 message ずつ、1.5 秒間隔
- `LINE_NOTIFY_DRY_RUN=1` で実 API 呼び出し回避（既存と同じフラグ流用）

#### Webhook 処理 (apps/web/src/app/api/webhook/line/route.ts)

```typescript
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-line-signature')
  const destination = JSON.parse(body).destination

  // 1. destination から line_channels 行を取得 (purpose='event_broadcast' に限定)
  // 2. channelSecret で X-Line-Signature を HMAC-SHA256 検証
  // 3. events[] を iterate
  //    - type=='join': line_channels.status='active' (まだ assigned だった行)、event_line_broadcasts.line_group_id = source.groupId、status='joined_waiting_code'
  //    - type=='leave': status='revoked', line_channels.status='available'
  //    - type=='message' && message.type=='text' && /^\d{6}$/.test(text):
  //        - 該当 invite_code を持つ event_line_broadcasts を検索
  //        - 期限内 + channel 一致 → status='linked', linked_at=now
  //        - 不一致/期限切れ → 「❌ 招待コードが無効です」reply
  // 4. 200 OK 返却
}
```

webhook routing は **1 URL で全 Bot 受け** (`destination` で振り分け)。LINE Developers Console では各 Bot の Webhook URL に同じ `https://new.hokudaicarta.com/api/webhook/line` を設定する。

#### 日次バッチ

```bash
# systemd timer
# /etc/systemd/system/kagetra-broadcast-cleanup.timer (daily)
ExecStart=/usr/bin/pnpm --filter=@kagetra/web exec tsx scripts/release-expired-broadcasts.ts
ExecStart=/usr/bin/pnpm --filter=@kagetra/web exec tsx scripts/cleanup-expired-tokens.ts
```

- `release-expired-broadcasts.ts`:
  - WHERE `event_line_broadcasts.status='linked' AND COALESCE(extended_until, events.event_date + 30) < CURRENT_DATE`
  - UPDATE status='released', line_channels.status='available'
- `cleanup-expired-tokens.ts`:
  - DELETE FROM attachment_share_tokens WHERE expires_at < now() - interval '7 days'
  - 7 日のグレース期間を持って削除

#### Bot プール初期投入

```bash
# scripts/seed-broadcast-channels.ts
# LINE Developers Console で手動作成した 30 Bot の channel_id / secret / access_token を JSON で受け取り
# line_channels に purpose='event_broadcast', status='available' で 30 行 INSERT
# note='kagetra-event-bot-1' .. 'kagetra-event-bot-30'
pnpm tsx apps/web/scripts/seed-broadcast-channels.ts --file=/etc/kagetra/broadcast-channels.json
```

### 4.5 LINE Developers セットアップ
- Provider: 既存 `kagetra` Provider 配下に 30 Bot を **手動作成**
  - Bot 名: `kagetra-event-bot-1` 〜 `kagetra-event-bot-30`
  - 各 Bot に Webhook URL: `https://new.hokudaicarta.com/api/webhook/line` (共通)
  - 各 Bot に `Allow bot to join group chats`: ON
  - 各 Bot で `Auto-reply messages` / `Greeting messages`: OFF (アプリ側で制御)
- channel_id / channel_secret / channel_access_token を取得 → `seed-broadcast-channels.ts` で DB 投入
- LINE Developers の手動作業は 30 Bot × ~5 分 = 約 2.5 時間（一度きり）

### 4.6 環境変数 / 設定
- 新規追加なし（既存の `DATABASE_URL`, `LINE_NOTIFY_DRY_RUN` を流用）
- Bot ごとの token は `line_channels` テーブル管理

---

## 5. 影響範囲

### 5.1 変更が必要な既存ファイル

#### `packages/shared/`
- `src/schema/enums.ts`: `lineChannelPurposeEnum`, `eventLineBroadcastStatusEnum`, `eventBroadcastMessageStatusEnum` 追加
- `src/schema/line-channels.ts`: `purpose`, `assigned_event_id` カラム追加 + UNIQUE
- `src/schema/event-line-broadcasts.ts`: 新規
- `src/schema/event-broadcast-messages.ts`: 新規
- `src/schema/attachment-share-tokens.ts`: 新規
- `src/schema/relations.ts`: 拡張
- `src/schema/index.ts`: re-export

#### `apps/web/`
- `src/app/(app)/admin/mail-inbox/[id]/actions.ts`: `approveDraft` の events 登録後に `broadcastMailToEvent` 呼び出し追加（非同期、fire-and-forget でエラーログ）
- `src/app/(app)/events/[id]/page.tsx`: `LineBroadcastSection` 追加
- `src/app/(app)/admin/line-channels/page.tsx`: 新規
- `src/app/(app)/admin/line-channels/[id]/page.tsx`: 新規
- `src/app/api/webhook/line/route.ts`: 新規
- `src/app/api/line-broadcast/attachments/[token]/route.ts`: 新規
- `src/app/api/line-broadcast/images/[token]/route.ts`: 新規
- `src/components/events/LineBroadcastSection.tsx`: 新規
- `src/components/events/InviteCodeModal.tsx`: 新規
- `src/components/events/BroadcastHistoryTable.tsx`: 新規
- `src/components/admin/LineChannelTable.tsx`: 新規
- `src/components/admin/ManualLinkModal.tsx`: 新規
- `src/lib/line-broadcast.ts`: 新規
- `src/lib/attachment-image-render.ts`: 新規
- `src/lib/invite-code.ts`: 新規
- `scripts/seed-broadcast-channels.ts`: 新規
- `scripts/release-expired-broadcasts.ts`: 新規
- `scripts/cleanup-expired-tokens.ts`: 新規
- `package.json`: `pdfjs-dist`, `canvas` (画像書き出し) 依存追加。`@line/bot-sdk` は既存
- `src/components/layout/`: admin ナビ追加（「LINE 配信 Bot 管理」）
- `src/middleware.ts`: `/admin/line-channels/*` の admin/vice_admin ガード追加

#### `docker/`
- `Dockerfile` (apps/web): libreoffice インストール (`RUN apt-get install -y libreoffice-core libreoffice-writer libreoffice-calc`)、~200 MB イメージサイズ増
- `docker-compose.yml`: 変更なし (webhook は既存 nginx 経由)
- `nginx/`: `/api/webhook/line` の POST を許可 (既存設定で動くはずだが要確認)

#### `.github/workflows/`
- CI に新規 vitest テスト追加 (line-broadcast, attachment-image-render, webhook signature 検証)
- libreoffice テスト用に CI runner に `sudo apt-get install -y libreoffice-core` を追加 or 一部テストは fixture+モックで回避

#### systemd
- `kagetra-broadcast-cleanup.service` / `.timer` 新規 (日次)

#### Drizzle migration
- 単一 migration:
  1. 3 つの新規 enum 作成
  2. `line_channels` に `purpose`, `assigned_event_id` 追加 (default で既存 system 行は purpose='system_notify')
  3. 3 つの新規テーブル作成
  4. 新規 indexes / partial unique 作成

### 5.2 既存機能への影響
- **mail-tournament-import**: `approveDraft` server action に配信トリガー追加。配信失敗は承認処理を巻き戻さない (best-effort)
- **`pushSystemNotification`** (apps/mail-worker): 変更なし、引き続き system 通知用
- **events 詳細画面**: LINE 配信セクションが追加されるだけ、既存出欠・スケジュール表示は不変
- **権限ガード**: 既存 middleware に `/admin/line-channels/*` 行を追加
- **Docker イメージ**: +200 MB (libreoffice)、Lightsail のストレージ・転送には許容範囲
- **公開 HTTP エンドポイント**: `/api/webhook/line` と `/api/line-broadcast/*` の 2 系統が新規公開、認証は signature 検証 + token 期限
- **依存ライブラリ追加**: `pdfjs-dist` (Node 互換ビルド), `canvas` (PNG/JPEG 出力)。`@line/bot-sdk` は既存

---

## 6. 設計判断の根拠

### 6.1 なぜ AI 整形を挟まず生メール本文を流すか
- ユーザー要望: AI コストを乗せたくない、生データで OK
- mail-tournament-import の `extracted_payload` は events への登録用、配信は別経路で本文を直接使う
- AI 整形を将来オプションとして追加することは可能（`event_line_broadcasts.message_format` enum で 'raw' / 'ai_summarized' を持たせる余地）

### 6.2 なぜ line_channels に `purpose` 列を追加するか (別テーブルを作らない)
- 既存テーブル構造の再利用、channel_id / secret / access_token の管理が同じ
- system 用 1 行 + broadcast 用 30 行で物理的にも近い (同テーブル)
- `purpose` 列で論理的に分離、status enum と既存運用ロジックはそのまま共有

### 6.3 なぜ 1 大会 1 グループ縛りか
- スキーマがシンプル (`event_id` UNIQUE)
- Bot プール消費が予測可能 (年 10 件 × 1 Bot ≪ 30 Bot)
- A/B 級分離などは将来 N:1 化で対応可能 (ユニーク制約を外せばよい)

### 6.4 なぜ大会終了 +30 日で自動解放するか
- 大会後の打ち上げ・反省連絡を吸収するバッファ
- 年 10 件 × 30 日 = 同時 active ~1-2 件、30 Bot プールは十二分
- 管理者が忘れても自動で枠が戻る (運用負荷低)

### 6.5 なぜ招待コードを 6 桁数字 + 30 分 + 1 回限りにしたか
- スマホでの手入力しやすさ最優先 (英数混在は誤入力多い)
- 30 分: 「LINE グループ作って Bot 招待してコード入力」までを余裕で収める
- 1 回限り: 同じコードの再利用での誤連携を防ぐ
- 衝突確率: 10^6 通り、同時アクティブ ~30 件、誕生日問題でも衝突 ~0.05% (UNIQUE partial で再生成)

### 6.6 なぜ Bot 対話は招待コード認識以外完全無視か
- 「Bot にコマンド送る」体験は今フェーズで不要 (一方向の配信専用)
- メンバーが Bot に質問してきたら、管理者に直接連絡してもらう前提
- 将来コマンド化したくなったら拡張可能だが、今は完全無視がシンプル

### 6.7 なぜ Word も libreoffice で画像化するか (200 MB のイメージ増を許容)
- Word 添付は大会案内では少数派だが、来た時に「読めない」は体験悪い
- pdfjs-dist が既存依存、libreoffice 経由で PDF 化すれば変換コードが一本化
- Lightsail Always Free 枠でディスクは 30 GB、200 MB 増は許容範囲

### 6.8 なぜ Excel は画像化せず Web リンクで割り切るか
- Excel は表が広く、画像化しても LINE 上で読めない (横スクロール不可)
- LINE の Flex Message でダウンロードボタンを送る方が UX 良
- libreoffice 経路から外せるので失敗パスが減る

### 6.9 なぜ添付 DL URL を期限 60 日 + 認証不要にしたか
- LINE グループには非ログインゲスト (連れの応援者など) も居る想定
- 期限切れで 404 になることでセキュリティ・容量バランスを取る
- token 32 文字 (URL セーフ, ~190 bit) で総当たり実質不可能
- 大会案内の機微度: 中（個人連絡先含む）、60 日後には大会が終わり関心も薄れる

### 6.10 なぜ webhook を 1 URL で全 Bot 受けるか
- 30 Bot 別 URL は LINE Console 設定とアプリ側 routing が煩雑
- `destination` フィールドで Bot 識別できるので 1 URL で十分
- signature 検証は `channel_secret` を destination から DB 引きで取得

### 6.11 なぜ配信処理を mail-worker でなく apps/web 側に置くか
- 承認は web 側の server action、配信トリガーが同じ場所だと一貫性高い
- libreoffice / pdfjs などのヘビー依存は mail-worker と分離した方が責務明確
- 将来 worker 化したくなったら同モジュールを切り出し可能

### 6.12 なぜ 30 ページ超で画像化打ち切りか
- 多ページ大会要項は LINE 上でスクロールがしんどい
- 1 push 5 message × max push count を考えると、30 ページ = 6 push (一括) もしくは 30 image 個別
- 配信時間 60 秒以上かかると LINE 側で「遅延しすぎ」表示
- 31 ページ目以降は「Web で見る」リンクに切り替える方がユーザー体験良

---

## 7. 範囲外

以下は本機能の範囲外、別フェーズで対応:

- **LINE Login ベースのグループメンバー認証**: アプリログインを LINE グループメンバーシップで判定する仕組み (Phase 外)
- **メンバーからの Bot コマンド** (`!出欠` `!次の試合` 等): 一方向の配信専用、要望が出てから検討
- **配信内容のテンプレ編集 UI**: 生メールそのまま転送、編集機能は v2
- **複数大会の集約配信**: 1 大会 1 グループ
- **画像化済み添付の永続キャッシュ**: オンザフライ + リトライ時再生成。永続化は容量と頻度のバランス見てから
- **AI 整形配信モード**: メッセージ format オプション (`raw` / `summarized`) は将来拡張点
- **配信時間スケジューリング**: 「○○時に配信」のような時刻指定。承認 = 即配信
- **既読確認 / 既配信メンバー一覧**: LINE Messaging API では取得不可

---

## 8. 開発・テスト戦略

### 8.1 テスト方針

- **ユニットテスト** (Vitest):
  - `invite-code.ts`: 6 桁生成、検証、重複チェック
  - `attachment-image-render.ts`: fixture PDF / DOCX → 画像サイズ・枚数の期待値検証 (libreoffice はテスト環境にインストール必須 or Mock)
  - `line-broadcast.ts`: LINE SDK モック、本文分割ロジック、batch push 制御、エラーハンドリング
  - webhook signature 検証: HMAC-SHA256 計算の正確性

- **統合テスト** (Vitest + 実 DB):
  - 招待コード生成 → Bot join 模擬 webhook → コード認識 → status='linked' の遷移
  - 大会終了 +31 日経過のシナリオで `release-expired-broadcasts.ts` がプール返却すること
  - 配信失敗時の `event_broadcast_messages.status='failed'` 記録

- **E2E** (Playwright):
  - `/events/[id]` で招待コード生成 → モーダル表示確認
  - `/admin/line-channels` で 30 Bot 一覧表示、フィルタ動作
  - 実 LINE 配信は `LINE_NOTIFY_DRY_RUN=1` でモック

### 8.2 ローカル開発

- `LINE_NOTIFY_DRY_RUN=1` で LINE API 呼び出し回避
- libreoffice はローカル必須 (`brew install libreoffice` / `apt install libreoffice-core libreoffice-writer`)
- 30 Bot のうち 1 個だけ実環境用 channel を作成、残り 29 個は fixture
- webhook 動作確認: ngrok で `localhost:3000/api/webhook/line` を公開、LINE Console から疎通

### 8.3 デプロイ手順

1. **Drizzle migration** を本番 DB に適用 (`pnpm --filter=@kagetra/shared db:push`)
2. **apps/web Docker イメージ rebuild** (libreoffice 追加)
3. **LINE Developers Console** で 30 Bot 手動作成、Webhook URL 設定
4. **`scripts/seed-broadcast-channels.ts`** で 30 Bot を line_channels に投入
5. **systemd timer** 配置・enable (`kagetra-broadcast-cleanup.timer`)
6. **nginx 設定確認**: `/api/webhook/line` の POST 通過確認
7. **1 大会で動作確認** → 招待コード生成 → Bot 招待 → 紐付け → メール承認自動配信 → 検証
8. **本番運用開始**

### 8.4 PR 分割案 (実装フェーズ用)

- **PR1**: スキーマ拡張 (enums + 4 新規テーブル + line_channels 拡張) + migration
- **PR2**: `seed-broadcast-channels.ts` + `/admin/line-channels` 一覧・詳細画面 (Bot プール管理 UI)
- **PR3**: 招待コード生成 server action + `LineBroadcastSection` + `InviteCodeModal` (紐付け UI 一式)
- **PR4**: `/api/webhook/line` 実装 + LINE Bot 対話 (join/leave/code 認識)
- **PR5**: `attachment-image-render.ts` (libreoffice + pdfjs) + `attachment_share_tokens` + 署名 URL API
- **PR6**: `line-broadcast.ts` 配信ロジック + `approveDraft` 連動 + 配信履歴 UI
- **PR7**: 日次 cron (`release-expired-broadcasts.ts`, `cleanup-expired-tokens.ts`) + systemd + 本番デプロイ

## 変更履歴

- 2026-08-22: join 時の案内返信を廃止。紐付け完了の返信を①〜④の4通へ分割し、②③にメンションを導入（理由: 案内文が運用上不要になり、紐付け直後に確認事項を渡したいため。親 Issue は line-bot-message-revamp を参照）
- 2026-09-14: ③「申込人数の確認」を役割別の内訳へ改訂（合計＋大会参加者・管理者・会計・副連絡責任者・Bot の5行、名字つき、1人1バケットの排他）。あわせてゲストを人数から除外し「内他会〇名」の併記を廃止、③のメンション対象を `role='admin'` の会員のみへ変更（理由: グループの実在籍と突き合わせやすくするため。ゲストは大会別グループに招待しない運用が実態だったため前提を反転した。§3.1.3a〜3.1.3c）
