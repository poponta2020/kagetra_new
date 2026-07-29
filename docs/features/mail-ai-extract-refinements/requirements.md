---
status: completed
design_required: false
mode: change
base_feature: mail-tournament-import
---

# mail-ai-extract-refinements 要件定義書（改修）

> **改修対象**: [mail-tournament-import](../mail-tournament-import/requirements.md)（§3.2.2 AI 抽出ルール / §3.1.1 受信箱一覧）、
> [tournament-title-grade-split](../tournament-title-grade-split/requirements.md)（§4.1 ExtractionPayloadSchema）、
> [mail-inbox-mailer](../mail-inbox-mailer/requirements.md)（`triggerExtractDraft` / AI 抽出確認ダイアログ）。
> 本書が**変更後の挙動の唯一の正**であり、上記3書の当該箇所は本書で上書きされる。

---

## 1. 概要

### 目的
運用変更（AI の役割が「分類＋抽出」から「抽出のみ」へ縮小）に、プロンプト・スキーマ・UI を追従させる。あわせて抽出項目を実運用で必要なものへ絞り込み、モデルを Claude Sonnet 5 へ移行し、管理者が **どの添付を AI に読ませるかを選べる** ようにする。

### 背景・動機

**運用は既に変わっており、コードの一部だけが取り残されている。**

- かつては cron が新着メールを自動で AI にかけ、AI が「大会案内かどうか」を判定してから抽出していた
- 現在は [index.ts:122-131](../../../apps/mail-worker/src/index.ts) のとおり **cron は AI を呼ばない**（`--mode=fetch` は `llmExtractor: undefined`）。AI が走るのは管理者が受信箱で「会で流す（AI 抽出）」を押した経路（`--mode=extract`）だけ
- つまり **AI に届く時点で「これは大会案内だ」という人間の判断が済んでいる**。にもかかわらずシステムプロンプトの約3割が分類のための記述に費やされ、出力スキーマも `is_tournament_announcement` を要求し続けている
- 抽出項目にも、運用で使われていないもの・他の手段で導出できるものが残っている（通称・参加費・訂正版判定・原文メモ3種）
- 添付は**全 PDF が無条件に AI へ送られる**。会場地図・申込書 Excel・別大会の要綱まで一緒に送られ、トークン代と誤抽出の両方を悪化させている
- 抽出モデルは Sonnet 4.6 のまま。Sonnet 5 は定価同一（2026-08-31 まで導入価格で3割安）で上位互換

### 変更の骨子（6点）

| # | 変更 | 主な効果 |
|---|---|---|
| 1 | モデルを `claude-sonnet-5` へ移行し `thinking: disabled` を明示 | 上位互換・導入価格中は割安 |
| 2 | 分類ロジックをプロンプト・スキーマから撤去 | プロンプト約3割減、誤抽出の余地を削減 |
| 3 | **抽出項目を実運用に合わせて整理**（5項目削除・2項目追加・4項目の意味変更） | 使わない値を取りに行かせない・null の曖昧さを解消 |
| 4 | 添付を選択して AI に渡す UI を新設 | 無関係添付の除外、トークン代削減 |
| 5 | `MAIL_WORKER_PDF_SIZE_LIMIT_KB` を 800 → 8000 へ引き上げ | 実サイズの要綱 PDF が通る |
| 6 | 「本文は常に AI へ渡る」を回帰 AC として固定 | 本文にしかない情報の欠落を防ぐ |

---

## 2. ユーザーストーリー（差分）

対象ユーザーは従来どおり **管理者（`admin` / `vice_admin`）実質1名**。変わるのは以下のシナリオ。

**シナリオ A': 大会案内を取り込む（変更後）**
1. 管理者が `/admin/mail-inbox` でメールを開き、これは大会案内だと判断する
2. 「会で流す（AI 抽出）」を押す → **添付一覧が出る。既定では全て未チェック**
3. 要綱 PDF にチェックを入れる（会場地図や申込書 Excel は入れない）
4. 「はい」で AI 抽出が走る。**本文は選択によらず必ず AI に渡る**
5. 抽出完了後、ドラフト詳細で内容を確認する。**通称欄に「大阪」と入力**すると、各単位の大会名が「大阪B」「大阪C」と自動合成される
6. 承認して events を作成

**シナリオ B': 渡す資料を間違えた**
1. 管理者が要綱ではなく名簿 PDF にチェックを入れて実行してしまう
2. AI は `source_mismatch: true` を返し、`reason` に「渡された PDF は出場者名簿に見える」と書く
3. ドラフトは通常どおり `pending_review` で作られるが、詳細画面に警告が出る
4. 管理者は「再 AI 抽出」から**添付を選び直して**やり直す

**シナリオ C': 大きな要綱 PDF**
1. 要綱 PDF が 12MB あり、上限 8MB を超えている
2. 選択ダイアログでその添付は**チェックできず**、「サイズ上限超過のため送信できません」と表示される
3. 管理者は本文と他の添付だけで実行するか、諦めて手入力する

**シナリオ D': 訂正版が届いた（AI は関与しない）**
1. 訂正版メールが届く。管理者が本文を読んで訂正版だと気づく
2. 該当する既存 events を**手動で**編集する。AI に訂正版判定はさせない

---

## 3. 機能要件

### 3.1 画面と遷移

新規ルートは増えない。ダイアログはいずれも既存画面内のモーダル。

| 画面 | 変更内容 |
|---|---|
| `/admin/mail-inbox`（一覧） | ①**tier 分けを廃止**（`ConfidenceBadge` 削除、`confidence >= 0.9` による「要対応 / 要確認」の2段振り分けをやめ、`pending_review` を受信日降順の一本に）②カードの表示名を **`formal_name`** に変更（`composeTitle(stem, grades)` は AI が stem を出さなくなるため使えない。`formal_name` も無い単位は「開催日＋級」で代替） |
| `/admin/mail-inbox/mail/[id]`（メール詳細） | 「会で流す（AI 抽出）」ダイアログを**添付選択ダイアログに拡張**（3.2.4） |
| `/admin/mail-inbox/[id]`（ドラフト詳細） | ①`ConfidenceBadge` 削除 ②**通称入力欄を新設**（3.2.3）③`source_mismatch: true` のとき警告バナーを表示 ④**訂正版ヒント（関連ドラフト検索）を撤去** ⑤「再 AI 抽出」から添付選択ダイアログを再度開けるようにする |

### 3.2 ビジネスルール

#### 3.2.1 AI 抽出ルール（mail-tournament-import §3.2.2 を置き換え）

- **モデル**: `claude-sonnet-5`（プロバイダ抽象化レイヤ経由は従来どおり）
- **`thinking`**: `{ type: 'disabled' }` を**明示的に指定する**。Sonnet 5 は省略時 adaptive thinking が ON になり、`max_tokens` が思考と出力を合算して上限をかけるため、明示しないと `record_extraction` の引数が途中で切れる
- **プロンプトキャッシュ**: **撤去する**。手動起動＝メール1件ごとの散発的な呼び出しになったため、どの TTL でもキャッシュヒットせず書込プレミアム（1h で 2.0×）を払うだけになる
- **structured output**: 従来どおり forced tool use（`record_extraction`）
- **入力**: メール本文（**選択内容によらず常に渡す**）＋ **管理者が選択した添付だけ**。PDF はネイティブ document ブロック、DOCX 等は抽出テキスト。XLSX は従来どおり抽出無効
- **分類は行わない**。渡された資料が大会要綱である前提で抽出に専念する
- **`PROMPT_VERSION` は `3.0.0`**（出力スキーマの破壊的変更＝major）

#### 3.2.2 出力スキーマ（変更後の全項目）

**案内全体に1つ持つ項目**

| フィールド | 型 | 意味 | 変更 |
|---|---|---|---|
| `events` | `EventUnit[]` | 開催日ごとに1要素。**1件以上必須** | 維持 |
| `reason` | `string` | **レビュー画面向けの抽出メモ**（「級別の定員が読み取れなかった」「開催日が期間表記のため null」等）。`source_mismatch: true` のときはその理由を書く | 意味変更 |
| `source_mismatch` | `boolean \| null` | 渡された資料が明らかに別種の文書に見える場合に `true` | **追加** |
| `extras` | object（任意） | `eligible_grades_raw`（出場資格の原文）/ `target_grades_raw`（対象階級の原文）のみ | 3項目削除 |

**削除する全体項目**

| フィールド | 削除理由 |
|---|---|
| `is_tournament_announcement` | 分類は人間が済ませている |
| `confidence` | 「分類が正しい確率」として定義されており意味を失う。校正不能な自己申告スコアを別定義で残さない |
| `short_name_stem` | 通称は承認フォームで人間が入力する（3.2.3） |
| `is_correction` / `references_subject` | 訂正版はほぼ届かず、届いても軽微。人力確認で運用可能 |
| `extras.fee_raw_text` | `fee_jpy` を廃止するため不要 |
| `extras.local_rules_summary` / `extras.timetable_summary` | 運用で参照していない |

> **`source_mismatch` は分類機能の復活ではない。** プロンプトに「これは大会案内か判定せよ」と書いてはならない。指示するのは「**渡された資料が明らかに別種の文書だったときだけ申告せよ**」という一点に限る。前者を書くと、今回撤去した判断をそのまま別名で呼び戻すことになる。

**開催日ごとに1組持つ項目（`EventUnit`・20項目）**

分割ルールは従来どおり。同日複数級は1単位にまとめ、級で開催日が違えば単位を分ける。

| フィールド | 型 | 意味 | 変更 |
|---|---|---|---|
| `unit_key` | `string` | `"u1"` `"u2"`…（`^u[1-9]\d*$`）。承認フォームのフィールド名前空間に使うため一意必須 | 維持 |
| `event_date` | `"YYYY-MM-DD" \| null` | 開催日（JST）。和暦→西暦・全角→半角。**期間表記は `null`** | 維持 |
| `eligible_grades` | `("A".."E")[] \| null` | その日に行われる級 | 維持 |
| `formal_name` | `string \| null` | 正式名称（「第5回大阪大会B級」）。**edition 名寄せの種であり一覧カードの表示名でもある** | 維持（重要度上昇） |
| `venue` | `string \| null` | 会場名＋住所 | 維持 |
| `entry_deadline` | `"YYYY-MM-DD" \| null` | 申込締切。期間表記は**終了日**を採用 | 維持 |
| `payment_deadline` | `"YYYY-MM-DD" \| null` | 振込締切。`payment_deadline_kind` が「日付あり」のときだけ値が入る | 維持 |
| `payment_deadline_kind` | `"日付あり" \| "後日連絡" \| "記載なし"` | 振込締切の**状態**。案内に「振込先は抽選後に別途連絡」等があれば「後日連絡」。**承認時に events へも持ち回す**（3.2.7） | **追加** |
| `payment_info_text` | `string \| null` | 振込先の生テキスト（「ゆうちょ 12340-12345-1 …」） | 維持 |
| `payment_method` | `"口座振込" \| "現地支払い" \| "その他" \| null` | 支払い方法 | **enum 化・日本語化** |
| `entry_method` | `"Excel申込書" \| "Googleフォーム" \| "メール" \| "その他" \| null` | 申込方法 | **enum 化・日本語化** |
| `organizer_text` | `string \| null` | 主催団体 | 維持 |
| `kind` | `"individual" \| "team" \| null` | 個人戦／団体戦。混合は `null` | 維持 |
| `capacity_total` | `int \| null` | **全体定員**（「定員100名」）。明示があるときだけ | **追加** |
| `capacity_a` 〜 `capacity_e` | `int \| null` | 級別定員。明示があるときだけ | 維持 |
| `official` | `boolean \| null` | 公認大会（協会公認・連盟主催の段位戦）なら `true` | 維持 |

**削除する単位項目**

| フィールド | 削除理由 |
|---|---|
| `fee_jpy` | 級から導出可能（A/B 2,500・C/D 2,000・E 1,500。公認料は全級 300）。`packages/shared` に定数として実装済み |

**定員の扱い**: 全体定員と級別定員が両方書かれていれば**両方抽出する**。片方からの逆算・均等割りは従来どおり**禁止**（推定値を入れさせない）。

**バリデーション**: `superRefine` のノイズ2分岐（`true` かつ空配列 / `false` かつ非空配列）を削除し、**無条件に `events.length >= 1` を要求**する。`unit_key` の一意性チェックは維持する。`payment_deadline_kind` が「日付あり」なのに `payment_deadline` が `null` の組み合わせは矛盾として弾く。

#### 3.2.3 大会名の決定方法（`short_name_stem` 廃止に伴う変更）

- 承認フォーム上部に**「通称」欄を1つ新設**する。管理者が「大阪」「札幌」のような地名だけを入力する
- 各単位の大会名は `composeTitle(通称, eligible_grades)` で**自動合成**する（「大阪」＋`["B"]` → 「大阪B」）。合成ロジック自体は現行の `composeTitle()` をそのまま使い、**stem の供給元が AI から人間に変わるだけ**
- 単位ごとに合成結果を**個別に上書きできる**（現行フォームの挙動を維持）
- 通称が未入力のあいだ、合成結果は空にする（級だけの「B」のような無意味な値を出さない）

#### 3.2.4 添付選択ルール（新規）

- 選択ダイアログは**「会で流す（AI 抽出）」と「再 AI 抽出」の両方**で使う
- 各添付について**ファイル名・種別・サイズ**を表示する
- **既定は全て未チェック**
- **サイズ上限（`MAIL_WORKER_PDF_SIZE_LIMIT_KB`）を超える添付はチェックできない**。無効化したうえで超過である旨を表示する
- **添付が1つ以上あるのに全て未チェックのまま実行**しようとした場合、「本文だけで実行しますか？」の確認を1段挟む
- **添付が0件のメール**では確認を挟まず実行できる
- 選択内容は永続化し、**「再 AI 抽出」時に前回の選択を初期値として復元**する。そのうえで選び直せる
- Server Action は UI を経由しない不正な選択（サイズ超過の添付 ID・当該メールに属さない添付 ID）を**サーバー側で拒否する**

#### 3.2.5 サイズ上限とスキップ挙動

- `MAIL_WORKER_PDF_SIZE_LIMIT_KB` の既定値を **800 → 8000** に変更する
- 上限超過の添付は**選択ダイアログの時点でブロック**されるため、正常系では classifier に上限超過の添付が届かない
- classifier 側の `oversize_skipped` ガードは**多重タブ・Server Action 直叩きに対する防御として残す**（挙動は現行どおり）

#### 3.2.6 `source_mismatch` の扱い

- ドラフトは通常どおり `pending_review` で作成する。新しいステータスは作らない
- ドラフト詳細画面に警告バナーを表示し、`reason` の内容を併記する
- **承認をブロックしない**。人間の判断が AI より上位である

#### 3.2.7 振込締切の状態を events へ持ち回す

**動機**: 支払いを追いかけるのはドラフトを見た人ではなく、後から申込管理ボードを見る人である。状態をドラフト payload の中だけに持つと、承認した瞬間に「後日連絡だから空」という情報が消え、[entry-board-utils.ts:624](../../../apps/web/src/app/(app)/admin/entries/entry-board-utils.ts) が一律「締切未設定」と表示する現状に戻ってしまう。

- `events.payment_deadline_kind` を追加する。値は `fixed` / `later_notice` / `unspecified`（**DB は英語値**。既存の `eventPaymentTypeEnum` が `advance` / `onsite` である慣行に合わせる。UI は日本語で表示する）
- 承認時に payload の日本語値をマッピングする（「日付あり」→`fixed` /「後日連絡」→`later_notice` /「記載なし」→`unspecified`）
- **`payment_deadline` の有無と `payment_deadline_kind` を CHECK 制約で双条件に縛る**: `(payment_deadline IS NOT NULL) = (payment_deadline_kind = 'fixed')`
- 既存行の backfill: `payment_deadline IS NOT NULL` → `fixed`、それ以外 → `unspecified`（この規則で全既存行が CHECK を満たす）
- 編集フォームで**日付を入力したらサーバー側で `fixed` に正規化**する（人間が「後日連絡」のまま日付を入れても矛盾状態にならない）

**表示する3面**

| 画面 | 変更内容 |
|---|---|
| `/admin/entries`（申込管理ボード） | `payment_deadline` が `null` のとき、`later_notice` なら「**後日連絡**」、`unspecified` なら従来どおり「締切未設定」と出し分ける |
| `/events/[id]`（イベント詳細） | 支払い関連の表示に状態を反映する |
| `/events/[id]/edit`（イベント編集） | 状態を手動変更できる。**後日連絡だったものに連絡が来たとき、人間が日付へ書き換えられる**ことがこの機能の実用上の要 |

#### 3.2.8 一覧の優先度分け廃止

- `confidence >= 0.9` → tier0「要対応」／`< 0.9` or `null` → tier1「要確認」の振り分けを**廃止**する
- `pending_review` のドラフトを受信日降順で一本に並べる
- `ConfidenceBadge` コンポーネントを削除する
- `tournament_drafts.confidence` **列は DROP しない**。書き込みを止め、表示をやめるだけにする

---

## 4. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| **プロンプト・スキーマ（分類撤去）** | | |
| AC-1 | `record_extraction` の input_schema に `is_tournament_announcement` / `confidence` / `short_name_stem` / `is_correction` / `references_subject` / `fee_jpy` が存在しない | auto-test |
| AC-2 | `extras` に `fee_raw_text` / `local_rules_summary` / `timetable_summary` が存在しない | auto-test |
| AC-3 | `events` が空配列のペイロードは Zod validate に失敗し、classifier の 1 回リトライ経路に入る | auto-test |
| AC-4 | `unit_key` 重複のペイロードは従来どおり validate に失敗する | auto-test |
| AC-5 | システムプロンプトに「大会案内でない」「confidence」「メーリングリストのダイジェスト」「訂正」の文字列が含まれない | auto-test |
| AC-6 | `PROMPT_VERSION` が `3.0.0` で、生成される `tournament_drafts` 行に記録される | auto-test |
| AC-7 | `source_mismatch: true` のドラフトは `pending_review` になり、詳細画面に警告バナーが表示され、**承認ボタンは押せる**（ブロックされない） | auto-test |
| **新規・変更項目** | | |
| AC-8 | `payment_deadline_kind` が「日付あり」「後日連絡」「記載なし」の3値のみを取る。「日付あり」なのに `payment_deadline` が `null` の組み合わせは validate に失敗する | auto-test |
| AC-9 | 案内本文に「振込先は抽選後に別途ご連絡します」がある fixture で `payment_deadline_kind: "後日連絡"` が返る | auto-test |
| AC-10 | `payment_method` が「口座振込」「現地支払い」「その他」`null` 以外の値を取らない | auto-test |
| AC-11 | `entry_method` が「Excel申込書」「Googleフォーム」「メール」「その他」`null` 以外の値を取らない | auto-test |
| AC-12 | 「定員100名」のように全体定員のみが書かれた fixture で `capacity_total` に値が入り、`capacity_a`〜`e` は `null` のままである | auto-test |
| AC-13 | 全体定員と級別定員が併記された fixture で**両方**が抽出される | auto-test |
| AC-14 | 全体定員から級別定員を按分した推定値が入らない（級別の明示がない fixture で `capacity_a`〜`e` が全て `null`） | auto-test |
| **大会名（通称の人力入力）** | | |
| AC-15 | 承認フォームに通称欄があり、「大阪」を入力すると各単位の大会名が `composeTitle` で「大阪B」「大阪C」と合成される | auto-test |
| AC-16 | 合成された大会名を単位ごとに個別上書きできる | auto-test |
| AC-17 | 通称が未入力のあいだ、合成結果が空になる（級だけの値が出ない） | auto-test |
| AC-18 | 一覧カードの表示名が `formal_name` になり、`formal_name` が無い単位は「開催日＋級」で表示される | auto-test |
| AC-19 | ドラフト詳細から訂正版ヒント（関連ドラフト検索）が消える | auto-test |
| **回帰（抽出精度）** | | |
| AC-20 | **`messages.create` に渡るリクエストボディ**に `mail.bodyText` を含む text ブロックが必ず存在する。次の4ケースで検証する: ①添付ありのメールで添付ゼロ選択 ②添付0件のメール ③text 種別の添付のみを選択 ④選択を復元した再 AI 抽出 | auto-test |
| AC-21 | 既存の抽出 fixture において、開催日ごとの `events` 分割・和暦→西暦変換・全角数字の半角化・申込期間の終了日採用・級別定員が従来どおり抽出される。**fixture の移行手順は以下に限定する**（回帰ベースラインを壊さないため、再生成は禁止）:<br>①`event_date` / `eligible_grades` / `formal_name` / `venue` / `entry_deadline` / `payment_deadline` / `payment_info_text` / `organizer_text` / `kind` / `capacity_a`〜`e` / `official` は**既存の値をそのまま**（1バイトも変えない）<br>②`fee_jpy` と削除対象の全体項目を除去<br>③`payment_deadline_kind` を追加（`payment_deadline` に日付があれば「日付あり」、無ければ「記載なし」。元案内が「後日連絡」を含む場合のみ「後日連絡」）<br>④`capacity_total` を追加（元案内に全体定員の記載がなければ `null`）<br>⑤`payment_method` / `entry_method` は既存値を新 enum へ読み替える（`bank_transfer`→「口座振込」等）<br>⑥`newsletter.expected.json` はノイズ陰性ケースのため削除し、`FixtureLLMExtractor` の既定応答の扱いを合わせて見直す | auto-test |
| **モデル移行** | | |
| AC-22 | `messages.create` に `model: 'claude-sonnet-5'` と `thinking: { type: 'disabled' }` が渡る | auto-test |
| AC-23 | system ブロックに `cache_control` が付かない | auto-test |
| AC-24 | 代表的な大会案内 PDF 1件について `claude-sonnet-4-6` / `claude-sonnet-5` の `count_tokens` を実測し、結果を `docs/features/mail-ai-extract-refinements/token-baseline.md` に記録する。**実測でトークン数が 1.5 倍を超えた場合は移行の可否をユーザーに再確認する** | manual |
| AC-25 | 実際の抽出 1 件で `record_extraction` が `stop_reason: max_tokens` にならず完走する | verify |
| **添付選択 UI** | | |
| AC-26 | AI 抽出ダイアログに添付一覧（ファイル名・種別・サイズ）が表示され、既定で全て未チェックである | auto-test |
| AC-27 | サイズ上限超過の添付はチェックできず、超過である旨が表示される | auto-test |
| AC-28 | 添付が1つ以上あるのに全て未チェックで実行しようとすると確認が1段入る | auto-test |
| AC-29 | 添付が0件のメールでは確認なしで実行できる | auto-test |
| AC-30 | 選択した添付だけが AI に渡る（未選択の PDF が document ブロックに含まれない） | auto-test |
| AC-31 | 選択内容が永続化され、「再 AI 抽出」時に前回の選択が初期値として復元される。そのうえで選び直せる | auto-test |
| AC-32 | Server Action がサイズ超過の添付 ID・当該メールに属さない添付 ID を含む選択を拒否する | auto-test |
| **一覧・サイズ上限・全体回帰** | | |
| AC-33 | 受信箱一覧から `ConfidenceBadge` と tier 分けが消え、`pending_review` が受信日降順の一本の並びになる | auto-test |
| AC-34 | `confidence` や旧フィールドを持つ既存ドラフトを開いても画面が壊れない（後方互換） | auto-test |
| AC-35 | `MAIL_WORKER_PDF_SIZE_LIMIT_KB` の既定値が `8000` である | auto-test |
| AC-36 | 選択された添付がすべて上限内なら `oversize_skipped` にならない。ガード自体は残っており、上限超過の添付が直接渡された場合は従来どおりスキップする | auto-test |
| AC-37 | cron（`--mode=fetch`）は従来どおり AI を呼ばない | auto-test |
| AC-38 | 既存テスト・lint・typecheck が CI で green | auto-test |
| **振込締切の状態を events へ持ち回す** | | |
| AC-39 | 承認時に payload の `payment_deadline_kind` が `events.payment_deadline_kind` へマッピングされる（「日付あり」→`fixed` /「後日連絡」→`later_notice` /「記載なし」→`unspecified`） | auto-test |
| AC-40 | CHECK 制約 `(payment_deadline IS NOT NULL) = (payment_deadline_kind = 'fixed')` が効いており、矛盾する組み合わせを INSERT / UPDATE できない | auto-test |
| AC-41 | 既存行の backfill 後、`payment_deadline` を持つ行が `fixed`、持たない行が `unspecified` になり、全行が CHECK を満たす | auto-test |
| AC-42 | 申込管理ボードで `payment_deadline` が `null` のとき、`later_notice` なら「後日連絡」、`unspecified` なら「締切未設定」と出し分けられる | auto-test |
| AC-43 | イベント編集フォームで振込締切の状態を変更でき、**日付を入力するとサーバー側で `fixed` に正規化される**（「後日連絡」のまま日付が入る矛盾状態にならない） | auto-test |
| AC-44 | イベント詳細画面で振込締切の状態が日本語で表示される | auto-test |

**検証手段の内訳**: auto-test 42件 / verify 1件 / manual 1件

---

## 5. Non-goals（今回やらないこと）

**機能面**
- **訂正版メールの自動検出**（AI 判定・関連ドラフト提案）。人力で確認して手動編集する
- **参加費の自動導出の UI 配線**。級→金額の定数は `packages/shared` にあるが、events への自動反映は別機能（`grade-entry-fee` の続き）で扱う
- pre-filter（`classification='noise'`）の撤去。一覧のフィルタとしては生きているため触らない
- cron の自動 AI 抽出の復活
- 信頼度スコアによる自動承認・`confidence` に代わる品質指標の導入
- XLSX 添付の抽出復活（脆弱性対応で無効のまま）
- 添付プレビュー・ビューアの改修、選択ダイアログでの中身プレビュー（ファイル名・種別・サイズのみ）

**技術面**
- `tournament_drafts.confidence` 列と `superseded_by_draft_id` 列の DROP（書き込みと表示を止めるだけ）
- `events.fee_jpy` 列の DROP（手入力・将来の自動導出のために残す）
- Opus / Fable 系モデルへの移行
- プロバイダ抽象化レイヤ（`LLMExtractor`）のインターフェース変更
- 添付ストレージ肥大（bytea 無期限蓄積）への対処

---

## 6. 技術的制約・契約

### 壊してはいけない既存挙動
- **本文は常に AI へ渡る**（[classifier.ts:227](../../../apps/mail-worker/src/classify/classifier.ts) の `bodyText ?? bodyHtml ?? ''`）。添付選択の導入で本文が落ちる実装にしない
- **`formal_name` は edition（開催）名寄せの種**（[[id]/page.tsx:221-231](../../../apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx) → `loadEditionSelectionData`）。`short_name_stem` を消しても `formal_name` の抽出品質は落とさない
- `composeTitle()` と `title.ts` は**残す**（stem の供給元が AI から人間に変わるだけ）
- `LLMExtractor` インターフェースは維持する
- `triggerExtractDraft` の多重起動ガード（`FOR UPDATE` + `triageStatus` / `linkedEventId` / `ai_processing` 検証）と `reextractDraft` の payload 競合対策を維持する
- cron（`--mode=fetch`）が `ANTHROPIC_API_KEY` なしで動くこと

### データ・互換性
- **保存済み `extractedPayload` に Zod を再実行しない**方針を維持する。Web 層は防御的ナローイングで読んでおり（[[id]/page.tsx:103-122](../../../apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx)）、スキーマから必須フィールドを消しても既存行は壊れない
- `confidence` / `superseded_by_draft_id` 列は残す。既存行の値も残す
- **`capacity_total` の保存先には `events.capacity` 列が既に存在する**（`capacity_a`〜`e` と併存）。マイグレーション不要
- **`events.payment_deadline_kind` は新規列**（pgEnum `fixed`/`later_notice`/`unspecified`、notNull default `unspecified`）。CHECK 制約と backfill は 3.2.7 のとおり
- 添付選択の永続化には**マイグレーションが必要**（保存先の設計は技術計画で確定する）
- `PROMPT_VERSION` の版数で新旧ペイロードを判別できる状態を保つ

### セキュリティ・権限
- AI 抽出のトリガーは従来どおり `admin` / `vice_admin` のみ
- 添付 ID の選択は**サーバー側で当該メールへの所属を検証**する（他メールの添付を読ませられない）

### 前提として認識しておくこと（今回は変更しないが、影響を理解した上で残す）
- **pre-filter は手動経路の入口を塞ぎうる。** cron は `classification='noise'` を付け、一覧の既定ビューはそれを除外する。`force: true` が prefilter をバイパスするのは **classifier の内部だけ**であり、一覧に出てこないメールは管理者が見つけられないため「会で流す」を押しようがない。本物の大会案内が pre-filter で noise 判定された場合、**一覧の「ノイズ」フィルタから探すのが唯一の救済経路**である
- **`oversize_skipped` ガードは防御専用になる。** 上限を 8000 に引き上げ UI が超過添付をブロックする以上、正常系ではこの経路に到達しない。**Server Action 直叩き・多重タブに対する防御として意図的に残すものであり、到達不能に見えても削除してはならない**

### 利用技術上の制約
- Anthropic API のリクエスト上限は 32MB。base64 で約 1.33 倍に膨らむため、上限 8000KB の添付を複数選択しても収まる範囲に収める
- prettier 設定はリポジトリに無い。single-quote / セミコロン無しのスタイルを手で維持する

### 未解決の技術論点（→ 技術計画で解決）
- 添付選択の永続化先（`tournament_drafts` の配列列 / 中間テーブル / `mail_attachments` のフラグ）
- `classifyMail` への選択の受け渡し方（オプション引数 / DB から都度読む）
- `capacity_total` → `events.capacity` の対応が妥当か（既存の `events.capacity` が別用途で使われていないかの確認）
- enum の日本語値を DB にそのまま入れるか、既存の `events.paymentType`（`advance` / `onsite`）へマッピングするか

---

## 7. 設計判断の根拠

### なぜ分類フィールドを「消す」のか（残して無視しないのか）
残すと AI は必ず値を埋めようとし、その判断のために資料を読む。人間が既に下した判断を AI に再実行させるのは、トークン代を払って矛盾リスクを買う行為になる。`is_tournament_announcement: false` と `events: [...]` が同時に返る自己矛盾を `superRefine` で弾いている現状の複雑さも、フィールドごと消せば不要になる。

### なぜ `confidence` を再定義せず削除するのか
現行の `confidence` は明確に「**分類**が正しい確率」と定義されている。抽出精度の指標に読み替えても、AI の自己申告値は校正できず、人間が必ず全件レビューする運用では意思決定に使えない。同じものを別名で残すより、`reason` を人間向けの抽出メモに作り替えるほうが実用的である。

### なぜ `short_name_stem` を人力入力に戻すのか
通称は「大阪」「札幌」程度の短い地名であり、人間が入力するコストはほぼゼロ。一方 AI にとっては「第N回」「令和N年度」「競技かるた」「選手権」「主催団体名」「級表記」を正しくそぎ落とすという曖昧な判断であり、プロンプトの1節を丸ごと消費していた。合成ロジック（`composeTitle`）は変えず、供給元だけ差し替えるのが最小の変更になる。

### なぜ `fee_jpy` を削除するのか
参加費は級から決定的に導出できる（公認大会の級別参加料は協会規定で A/B 2,500・C/D 2,000・E 1,500、公認料は全級 300）。定数は既に `packages/shared` にある。決定的に求まる値を AI に読み取らせるのは、誤読のリスクだけを増やす。

### なぜ `payment_deadline_kind` を足すのか
現状 `null` が「案内に後日連絡と書いてある」と「AI が読み取れなかった」の両方を意味しており、レビュー時に区別できない。前者は正常な状態で追加調査は不要、後者は人間が原文を当たるべき状態であり、対応がまったく違う。3値の状態フィールドで機械的に判別できるようにする。

### なぜ `payment_method` / `entry_method` を閉じた日本語 enum にするのか
実運用の値がそれぞれ2〜3種類に集中しており（口座振込／現地支払い、Excel 申込書／Google フォーム／メール）、自由テキストのままでは表記ゆれが溜まって将来の集計ができない。`"bank_transfer"` のような英語識別子は UI にそのまま出ると読みにくく、表示側でマッピングを持つより AI に日本語で出させるほうが経路が短い。

### なぜ全体定員と級別定員を両方持つのか
案内の書き方が実際に両方あり、片方に寄せると原文の情報が落ちる。`events.capacity`（全体）と `capacity_a`〜`e`（級別）の列は既に併存しているため、スキーマ側の受け皿も揃っている。片方からの逆算禁止は従来どおり維持する。

### なぜプロンプトキャッシュを撤去するのか
キャッシュは「同一プレフィックスを TTL 内に複数回叩く」ことで元が取れる。書込は 5m TTL で 1.25×、1h TTL で 2.0×、読込は 0.1×。運用が「メールが来たらその都度1件ずつ」に変わったため、どの TTL でもヒットせず書込プレミアムだけを払い続ける。

なお [prompt.ts:31-36](../../../apps/mail-worker/src/classify/prompt.ts) の「cache_control が効く 2048 トークン閾値を超えるために意図的に長くしている」というコメントは、Sonnet 4.6 / Sonnet 5 の最小キャッシュ長が 1024 であるため元から前提が誤っている。キャッシュ撤去によりこの制約は完全に消える。

### なぜ `thinking: disabled` を明示するのか
Sonnet 4.6 は `thinking` 省略＝思考なしだが、Sonnet 5 は省略＝adaptive thinking が ON になる。`max_tokens: 4096` は思考トークンと出力トークンを**合算して**上限をかけるため、明示しないと `record_extraction` の引数が途中で切れる。構造化抽出タスクに思考は不要であり、コストにもならない。

### なぜサイズ上限超過を「UI でブロック」するのか
現行は「1つでも上限超過 PDF があればメール全体をスキップ」という挙動で、超過に気づく手段がなかった。選択の時点で理由付きで示せば、管理者はその場で判断できる。classifier 側のガードは多重タブ・直叩きへの防御として残す。

### なぜ新しい機能スラッグを切ったのか
変更が `mail-tournament-import`・`tournament-title-grade-split`・`mail-inbox-mailer` の3書にまたがるため、いずれか1書の中で表現すると残り2書との整合が取れない。リポジトリの既存慣行（`event-list-refinements`・`senseki-stats-refinements`・`invite-register-redesign`）に倣い、delta を独立スラッグに置き、本書が変更後の唯一の正であることを冒頭で宣言する。

---

## 8. 変更履歴

- 2026-07-29: 初版。運用変更（AI の役割が分類＋抽出→抽出のみに縮小）に伴い、Sonnet 5 移行・分類ロジック撤去・抽出項目の整理・添付選択 UI 新設・PDF サイズ上限引き上げ・本文常時送信の回帰固定を定義（理由: cron の自動 AI 抽出が既に廃止され人間が事前判断する運用になっているのに、プロンプトとスキーマが旧運用のまま取り残されていたため）
