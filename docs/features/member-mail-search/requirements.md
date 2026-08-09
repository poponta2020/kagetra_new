---
status: completed
completed_sections: [ユーザーストーリー, 機能要件, Acceptance Criteria と Non-goals, 技術的制約・契約]
next_section: null
design_required: true
approved_at: 2026-08-09
---

# member-mail-search（会員向け 受信メール検索・閲覧）要件定義書

## 1. 概要

### 目的
一般会員が、会の共用メールボックスに届いた大会関連の連絡を**自分で検索して読める**ようにする。あわせて、その連絡を会としてどう処理したか（対応不要／大会案内として処理／どの大会に紐付けてLINE配信したか）を**日付つきの履歴**として示す。

### 背景・動機
- 受信メールは現状 `admin`／`vice_admin` だけが `/admin/mail-inbox` から見られる。一般会員は「あの大会の要項どこだっけ」「抽選結果のメール見たい」に自力で辿り着けず、都度管理者に聞くしかない。
- 本番実データ（2026-08-09 時点・292通）は **ほぼ全てが競技かるた大会関連の連絡**（`taikai-ajka` ML＋主催者からの直接連絡）で、会員にとって一次資料としての価値が高い。添付は366件／85MB（Excel 180・PDF 114・Word 62・画像8・zip1）。
- 「会としてこの連絡は処理済みなのか」が会員から見えないため、同じ連絡についての問い合わせが管理者に集中する。

### スコープの性質
**会員側は完全な読み取り専用**。書き込み・状態変更のUIは一切持たない。既存の管理者フロー（`/admin/mail-inbox`）には手を入れない。

---

## 2. ユーザーストーリー

### 対象ユーザー
ログイン済みの全会員（`member` / `vice_admin` / `admin`）。主対象は `member`。

### ユーザーの目的
- 大会の要項・組合せ表・名簿・抽選結果・結果報告を、メールの受信箱から**キーワードで**探して読む。
- 添付ファイルをスマホのアプリ内でそのまま閲覧する。必要なら元ファイルをダウンロードする。
- 「この連絡は会として対応済みか、どの大会の話か、LINEには流れたのか」を確認する。

### 利用シナリオ
1. LINEグループで流れてきた要項を後から見返したい → 「メール」タブ → 大会名で検索 → 添付PDFをタップして読む。
2. 自分が申し込んだ大会の抽選結果を確認したい → 大会名で検索 → 該当メール → 本文と添付を確認。
3. 「この大会案内、会として処理されてるの？」→ メール詳細の履歴欄で「2026年7月10日 第33回多摩大会 の案内として処理」を確認し、大会名タップでイベント詳細へ。

---

## 3. 機能要件

### 3.1 画面と遷移（画面インベントリ＋ナビゲーション地図）

> 個々の画面の見た目・レイアウトは `design-spec.md`（`/design-screen member-mail-search`）が正典。ここではインベントリと遷移だけを持つ。

| # | パス | 役割 | 権限 |
|---|------|------|------|
| S1 | `/mail` | 受信メール一覧＋検索（会員向け・新規） | ログイン済み全員 |
| S2 | `/mail/[id]` | メール詳細（本文・添付・処理履歴） | ログイン済み全員 |
| S3 | `/mail/attachments/[id]` | 添付ビューア（アプリ内プレビュー） | ログイン済み全員 |
| R1 | `GET /api/mail/attachments/[id]` | 添付バイナリ（新規） | ログイン済み全員 |
| R2 | `GET /api/mail/attachments/[id]/preview/[page]` | 添付のページ画像（新規） | ログイン済み全員 |

**ナビゲーション地図**

```
ボトムナビ「メール」タブ（adminOnly を解除＝全員に表示）
  ├─ admin / vice_admin → /admin/mail-inbox（従来どおり・変更なし）
  └─ member            → /mail  ← 本機能
                            ├─ 検索 / 絞り込み（同一画面内）
                            └─ メールカード → /mail/[id]
                                                ├─ 添付チップ → /mail/attachments/[id]
                                                │                  └─ 「元ファイル」→ R1（ダウンロード）
                                                ├─ 履歴の大会名 → /events/[id]（イベント詳細）
                                                └─ ✕ → 戻り元（?from= で明示）
```

- `/mail` は `admin` / `vice_admin` も閲覧できる（読み取り専用なので害がなく、権限判定を「ログイン済みか」だけに単純化できる）。ナビの行き先だけ role で振り分ける。
- 添付ビューアの ✕ の戻り先は既存の管理者ビューアと同じ `?from=` 方式。許可プレフィックスは `/mail` に限定し、それ以外は `/mail` へ倒す（オープンリダイレクト防止）。

### 3.2 公開範囲

**受信箱の全メール（292通・未処理を含む）を対象とする。** 除外条件は設けない。

- `classification='noise'` は**除外しない**。この値はAIの「新規の大会案内ではない」判定であってスパム判定ではなく、実体は「抽選結果のお知らせ」「名簿共有」「大会結果報告」「ライブ配信案内」など会員に有用な連絡（61通）である。
- `status`（`pending` / `fetch_failed` / `parse_failed` など）でも除外しない。取り込み途中のものは本文・添付が空なだけで、隠す理由がない。
- 他会の申込名簿など第三者の個人情報を含む添付も会員に開放する（招待制の身内アプリであること、および管理者が既に同じものをLINEグループへ配信していることを踏まえた判断。→ §7）。

### 3.3 検索

**検索対象フィールド**（1本のキーワード入力・部分一致・大文字小文字を区別しない）:

| 対象 | カラム | 備考 |
|------|--------|------|
| 件名 | `mail_messages.subject` | |
| 差出人 | `mail_messages.from_name`, `mail_messages.from_address` | |
| 本文 | `mail_messages.body_text` | 全292通に存在 |
| 添付ファイル名 | `mail_attachments.filename` | |
| 添付の抽出テキスト | `mail_attachments.extracted_text` | 168件・計363kB。Excel系198件は抽出非対応で対象外 |

- 空白区切りの複数語は **AND**（すべての語がいずれかのフィールドに含まれる）。
- キーワード未入力時は絞り込みなしで受信日降順。
- **絞り込み軸は「添付ありのみ」トグルの1つだけ**（処理状態・受信時期・大会での絞り込みは Non-goal）。
- 並び順は常に受信日時の降順（固定・切替なし）。
- ページングは「もっと読み込む」方式（初回20件・以降20件ずつ追加）。

### 3.4 処理履歴の導出ルール ★本機能の中核

履歴は**既存カラムからの導出**であり、履歴専用テーブルは作らない。1通のメールにつき、以下の該当する行を**日時の昇順**で並べる。

| 行 | 判定条件 | 日時ソース | 表示文言 |
|----|----------|-----------|----------|
| H1 | `tournament_drafts.status = 'approved'` | `tournament_drafts.approved_at` | `YYYY年M月D日 ○○大会 の案内として処理` |
| H2 | 当該メールを参照する `event_broadcast_messages.status = 'sent'` が存在 | `event_broadcast_messages.sent_at` | `YYYY年M月D日 ○○大会 の連絡としてLINEグループへ配信（本文と添付N件）` |
| H3 | `mail_messages.linked_event_id IS NOT NULL` かつ H2 が無い | `mail_messages.triaged_at` | `YYYY年M月D日 ○○大会 の連絡として紐付け` |
| H4 | `triage_status='processed'` かつ H0〜H3 のいずれも無い | `mail_messages.triaged_at` | `YYYY年M月D日 対応不要として処理` |
| H5 | H4 と同条件だが `triaged_at IS NULL` | — | `対応不要として処理済み`（日付を出さない） |
| H6 | `triage_status='unprocessed'` | — | 履歴行なし。一覧・詳細に「未処理」ピルのみ |
| H0 | `result_drafts.status = 'approved'` | `result_drafts.approved_at` | `YYYY年M月D日 試合結果として取り込み` |

**対象大会ラベルの共通規則（H1 / H2 / H3 共通）**

イベント集合からラベルを作る処理は1つのヘルパーに集約する:

1. `deriveEntryGroupName(titles)`（`apps/web/src/lib/entry-groups.ts:84`）で単一ラベルに畳めるなら、それ1つを表示し**開催日が最も早いイベント**の `/events/[id]` へリンクする（例: 多摩大会A・B・C → `第33回全国競技かるた多摩大会ABC`）。
2. 畳めない（`null` が返る）場合は各イベントタイトルを `・` 区切りで併記し、**それぞれ**を `/events/[id]` へリンクする。
3. イベントが1件も引けない場合は大会名を出さず、文言から大会名部分を落とす（例: `YYYY年M月D日 大会案内として処理`）。

**各行の詳細規則**

- **H1（大会案内として処理）**
  - 対象イベントは以下の**和集合**。★実測で必須（承認済み34ドラフトのうち **10件は後者からしか引けない**）:
    - `events.tournament_draft_id = <draft.id>` — 級別分割承認（`approveDraftUnits`）が作ったイベント群（1ドラフトあたり1〜5件）
    - `tournament_drafts.event_id` — 訂正版を既存大会へ紐付ける `linkDraftToEvent` が書く単一イベント
  - `tournament_drafts.status='rejected'`（＝管理者が大会案内として登録しないと判断）は H1 に含めない。この場合メールは `processed` になるため H4「対応不要として処理」に落ちる。**これは意図した扱い**（会員から見れば「会としては対応しない」で正しい）。本番実績0件。
- **H2（LINE配信）**
  - 対象大会は `event_broadcast_messages.event_line_broadcast_id → event_line_broadcasts.entry_group_id → events.entry_group_id` の3ホップ。`events.entry_group_id` は NOT NULL。**実測で 28件の配信レコードから42イベントが解決でき、1メールあたり1〜3イベント**。ラベルは上記の共通規則で作る。
  - 添付件数 N は**そのメールの添付総数**。`line-broadcast.ts:539` は `WHERE mail_message_id = X` でそのメールの添付を全件送るため、画面に並ぶ添付一覧＝配信されたファイルで一致する。
  - `event_broadcast_messages.include_body = false` のときは `（添付N件）`、添付0件なら `（本文のみ）`。
  - `status` が `sent` 以外（`pending` / `failed` / `partial`）の行は**履歴に出さない**（会員に配信失敗の内部事情を見せない）。
  - 同一メールが複数の大会（＝複数の `event_line_broadcast_id`）へ配信されている場合は、行を配信ごとに分けて出す。
- **H3（紐付けのみ）**
  - `mail_kind` が `applicant_roster` / `confirmed_roster` のときは文言を差し替える: `YYYY年M月D日 ○○大会 の申込名簿として処理` / `〜 の確定名簿として処理`。
  - `linked_event_id` は `ON DELETE SET NULL` なので、イベント削除後は H3 の条件を満たさなくなり H4 に落ちる。これは許容する（メール本体は履歴として残る）。
- **H5** は migration `0018_happy_human_robot.sql` が既存メールを `UPDATE mail_messages SET triage_status='processed'` で一括処理済み化した際に `triaged_at` を入れなかったことに由来する（実測67通）。日付を捏造せず省略し、`（処理日時の記録がありません）` を控えめな補足として添える。
- **H0（試合結果として取り込み）** — `approveResultDraft` も `triage_status='processed'` を書くため、これが無いと結果取込済みメールが H4「対応不要として処理」と**誤ラベル**される（本番実績1件。大会結果報告メールは今後も継続的に届く）。
  - 大会名は出さない（`result_drafts` はイベントではなく大会シリーズ／開催に紐づき、`events` へ素直に解決できないため）。日付＋文言のみ。
  - この行の実装は **`senseki-boundary` の物理削除対象**。判定・文言・クエリを**1関数に閉じ**（他の履歴行のロジックと混ぜない）、`docs/audits/senseki-boundary-audit.md` に削除箇所として登録する。削除時は H0 が消え、当該メールは H4 に落ちる（壊れない）。

### 3.5 メール詳細（S2）の表示内容

> **並び順・レイアウトは `design-spec.md` が正典**（確定順＝ヘッダ → 添付ファイル → 本文 → 処理の記録）。ここでは載せる内容だけを定める。

- 受信日時・差出人（表示名＋アドレス）・件名
- 処理状態ピル（未処理／処理済み）と、該当すれば種別ピル（大会案内／申込名簿／確定名簿）
- **処理履歴**（§3.4）
- 本文 — `body_text` を優先し、無ければ `body_html` を `<pre>` に生テキストとして表示（既存の管理者詳細と同じ方針。`dangerouslySetInnerHTML` は使わない）
- 添付一覧（ファイル名・アイコン・サイズ）→ タップでビューア（S3）

### 3.5b 一覧（S1）カードの表示内容

- 受信日時・件名・処理状態ピル・種別ピル・添付チップ
- **処理履歴の最新1行**（詳細を開かずに会の対応が分かるようにするため）
- 件名以外（本文・添付名・添付抽出テキスト）でキーワードにヒットしたときのみ、出所つきの抜粋を1本
- **差出人は出さない**（差出人は詳細ヘッダのみ。design-spec §3 の判断）

### 3.6 添付の閲覧・ダウンロード

- 表示方式は既存の管理者ビューア（`/admin/mail-inbox/attachments/[id]`）と同一の振り分け:
  - PDF / Office → libreoffice + pdftoppm でページJPEG化して縦積み表示
  - ラスタ画像 → バイナリを `<img>` 表示
  - `text/plain` `text/csv` → UTF-8 で `<pre>` 表示（先頭10万文字まで）
  - その他（zip 等）→ プレビュー不可カード＋ダウンロード導線
- ダウンロードは「元ファイル」リンクから R1 を叩く。
- **バイナリ配信のセキュリティポリシーは既存の管理者ルートを一字一句踏襲する**（§6）。

### 3.7 エラー・境界条件

| ケース | 挙動 |
|--------|------|
| 未ログインで `/mail` `/mail/[id]` `/mail/attachments/[id]` へアクセス | 既存の認証ミドルウェアに従いサインインへ |
| 未ログインで R1 / R2 | `401` |
| 存在しないメールID・添付ID | `notFound()`（ページ）／`404`（ルート） |
| 不正なID文字列（`1.5` `1e5` 負数 `2147483647` 超） | `400`（ルート）／`notFound()`（ページ） |
| 検索結果0件 | 「該当するメールがありません」の空状態 |
| 本文も添付も無いメール | 本文欄・添付欄を出さず、ヘッダと履歴だけ表示 |
| 添付のプレビュー生成に失敗 | プレビュー不可カード＋ダウンロード導線にフォールバック（例外を投げない） |
| 履歴行が1つも導出できない（未処理） | 「未処理」ピルのみ。履歴セクション自体を出さない |

---

## 4. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|---------|
| AC-1 | 未ログインで `GET /api/mail/attachments/:id` は 401 を返す | auto-test |
| AC-2 | `role='member'` のセッションで `/mail` が 403 にならず一覧が描画される | auto-test |
| AC-3 | `role='member'` のセッションで `GET /api/mail/attachments/:id` が 200 でバイナリを返す | auto-test |
| AC-4 | 検索キーワードが件名・差出人・本文・添付ファイル名・添付抽出テキストのいずれかに部分一致するメールが結果に含まれる（各フィールド1件ずつ） | auto-test |
| AC-5 | 空白区切りの2語検索は、両方の語を含むメールだけを返す（AND） | auto-test |
| AC-6 | キーワード未入力時は全メールが受信日降順で返る | auto-test |
| AC-7 | 「添付ありのみ」を有効にすると、添付を持たないメールが結果から消える | auto-test |
| AC-8 | 一覧は初回20件で、「もっと読み込む」で次の20件が追加される（重複・欠落なし） | auto-test |
| AC-9 | `classification='noise'` のメールが検索結果・一覧に含まれる | auto-test |
| AC-10 | `triage_status='unprocessed'` のメールが検索結果・一覧に含まれ、「未処理」ピルが付く | auto-test |
| AC-11 | 承認済み `tournament_drafts` を持つメールの詳細に「`approved_at` の日付 + 生成イベント名 + 案内として処理」の履歴行が出る | auto-test |
| AC-12 | 1ドラフトから複数イベントが生成されている場合、履歴行にその全イベント名が反映される（`deriveEntryGroupName` で畳めるなら単一ラベル、畳めないなら全件併記） | auto-test |
| AC-12b | `events.tournament_draft_id` の逆参照が0件でも `tournament_drafts.event_id` が指すイベントが履歴行の大会名として出る（`linkDraftToEvent` 経路・本番34件中10件が該当） | auto-test |
| AC-13 | `event_broadcast_messages.status='sent'` を持つメールの詳細に「`sent_at` の日付 + 大会名 + LINEグループへ配信」の履歴行が出て、添付件数がそのメールの添付総数と一致する | auto-test |
| AC-13b | 配信行の大会名が、3ホップ（`event_line_broadcasts.entry_group_id` → `events.entry_group_id`）で解決した申込グループのイベント群から作られ、`/events/[id]` へのリンクになっている | auto-test |
| AC-14 | `include_body=false` の配信行は「本文と」を含まず添付件数のみを表示する | auto-test |
| AC-15 | `status` が `sent` 以外の `event_broadcast_messages` は履歴行に現れない | auto-test |
| AC-16 | `linked_event_id` があり配信レコードが無いメールは「紐付け」行が出る。`mail_kind` が名簿種別なら「申込名簿／確定名簿として処理」に文言が変わる | auto-test |
| AC-17 | `processed` かつドラフト承認・紐付け・配信のいずれも無いメールは「対応不要として処理」行が出る | auto-test |
| AC-18 | `triaged_at IS NULL` の `processed` メールは「対応不要として処理済み」と表示され、**履歴行の要素内に**日付文字列（`年`／`月`）を含まない（ページ上部の受信日時は対象外なので、履歴行の要素にスコープして検証する） | auto-test |
| AC-19 | 複数の履歴行を持つメールで、行が日時の昇順に並ぶ | auto-test |
| AC-20 | 履歴行の大会名が `/events/[id]` へのリンクになっている | auto-test |
| AC-21 | 添付ビューアで PDF がページ画像として表示される（プレビュー生成成功時） | verify |
| AC-22 | プレビュー生成に失敗する添付でもページが 500 にならず、ダウンロード導線つきカードが出る | auto-test |
| AC-23 | R1 のレスポンスは、インライン許可リストに載る型のみ宣言MIME＋`inline`、それ以外は `application/octet-stream`＋`attachment` になる（許可外の `image/svg+xml` で検証） | auto-test |
| AC-24 | R1 は常に `X-Content-Type-Options: nosniff` と `Cache-Control: no-store` を返す | auto-test |
| AC-25 | R1 は非ASCIIファイル名を RFC 5987 形式（`filename*=UTF-8''…`）で返す | auto-test |
| AC-26 | 添付ビューアの `?from=` が `/mail` 配下でない値のとき、✕ の戻り先が `/mail` に倒れる | auto-test |
| AC-27 | ボトムナビの「メール」タブが `role='member'` でも表示され、遷移先が `/mail` になる | auto-test |
| AC-27b | 同タブが `admin` / `vice_admin` では従来どおり `/admin/mail-inbox` を指し、かつ**他タブの表示・並び・href が一切変わらない**（会員5→6タブ、管理者6タブのまま） | auto-test |
| AC-28 | 一覧・詳細のクエリが `mail_attachments.data`（bytea）を projection に含めない | auto-test |
| AC-29 | 本文・添付がどちらも無いメール（未処理・`fetch_failed` 等）の詳細ページが例外を出さずに描画され、本文欄・添付欄が出ない | auto-test |
| AC-30 | 既存の `/admin/mail-inbox` 配下の画面・Server Action の挙動が変わらない（既存テストが CI で green） | auto-test |
| AC-31 | 既存テスト・lint・typecheck が CI で green | auto-test |
| AC-32 | `result_drafts.status='approved'` を持つメールの履歴に「`approved_at` の日付 + 試合結果として取り込み」が出て、「対応不要として処理」が**出ない** | auto-test |
| AC-33 | H0 の判定・文言・クエリが単一モジュールに閉じており、**それを差し込まない構成**でも H1〜H6 の導出が成立する（`senseki-boundary` 物理削除の可搬性。H0 モジュールを渡さずに導出関数を呼ぶテストで検証する） | auto-test |
| AC-34 | 実機（iPhone・375px）で一覧→詳細→添付ビューア→戻る が破綻なく回る | manual |

**合計 37件 — 内訳: auto-test 35件 / verify 1件 / manual 1件**

---

## 5. Non-goals

**機能面**

- 会員によるメールの状態変更（対応不要にする・大会に紐付ける・LINE配信する等）。会員側は完全な読み取り専用。
- 処理履歴の専用テーブル（`mail_processing_events` 等）の新設と、管理者アクションへの追記処理の組み込み。**履歴は既存カラムからの導出のみ**。
- 既存の処理済みメール292通に対する `triaged_at` のバックフィル。日付が無いものは日付を出さない。
- 「未処理に戻す」等の取り消し操作の履歴表示（導出方式では過去の取り消しを再現できない）。
- 処理状態・受信時期・大会での絞り込み（今回は「添付ありのみ」トグルのみ）。
- 全文検索インデックス（PostgreSQL FTS / pg_trgm）。363kB規模なので `ILIKE` で足りる。
- 添付の一括ダウンロード（ZIP）。
- **結果取込（`result_drafts`）の詳細画面・ドラフト内容の閲覧。** 履歴に1行出すか（§3.4 H0・要判断）を除き、結果取込の中身は会員に見せない。
- 級別グループ配信（`event_grade_broadcasts`）・要綱配信（`event_broadcast_guideline_attachments`）の履歴表示。どちらもイベント単位でメールに紐づかない。
- メールへの返信・転送・新規作成。
- 会員向けの未読管理・お気に入り・通知。

**技術面**

- 既存の管理者ルート `/api/admin/mail/attachments/[id]` の権限ガードをその場で緩める改修。会員向けは別ルートとして立てる。
- `mail_messages` / `mail_attachments` のスキーマ変更・マイグレーション。**本機能はマイグレーション不要**。
- 管理者用受信箱 `/admin/mail-inbox` のUI・クエリ・Server Action の変更。
- `apps/api`（Hono）への実装。既存どおり `apps/web` の Server Component ＋ route handler で完結させる。

---

## 6. 技術的制約・契約

### 権限・セキュリティ

- **添付バイナリのポリシーは既存の管理者ルート（`apps/web/src/app/api/admin/mail/attachments/[id]/route.ts:51-73`）をそのまま踏襲する。** 添付はIMAP経由の**送信者由来の信頼できない入力**であり、`text/html` や `image/svg+xml` をインライン配信すると同一オリジンの stored XSS になる。
  - fail-closed の許可リスト（PDF / Office / ラスタ画像 / plain text）に載る型のみ宣言MIMEで `inline`。
  - それ以外は無条件に `application/octet-stream` ＋ `Content-Disposition: attachment`。
  - `X-Content-Type-Options: nosniff` を常時付与。レスポンスの `Content-Type` に保存値をそのまま echo しない。
  - 公開トークンルート（`/api/line-broadcast/attachments/[token]`）の「全型 attachment 固定」ポリシーは採らない。iOS ホーム画面PWAは `attachment` を受け取ると白画面で死ぬため（`feedback_ios_pwa_attachment_disposition`）、認証済みルートである本ルートは管理者ルートと同じ inline 許可リスト方式にする。
- 権限判定は `session.user.id` の有無のみ（role を見ない）。`/admin/entries` の開放時と同じ形。
- ID のバリデーションは管理者ルートと同じ `/^[1-9]\d*$/` ＋ int4 上限チェック。
- 添付ビューアの `?from=` は `/mail` プレフィックス必須（`//evil.example` を弾ける形）。

### 互換性・変更禁止挙動

- `/admin/mail-inbox` 配下の画面・Server Action・API は**一切変更しない**。
- ボトムナビの変更は `mail-inbox` タブの `adminOnly` 解除と role による href 出し分けのみ。他タブの並び・挙動は変えない。
- 既存の `image-cache`（globalThis ピン留めLRU・200MB／500エントリ）と `attachment-preview` はそのまま共用する。会員アクセスが増えてもキャッシュ層は共通なので変換コストは重複しない。

### データ

- **マイグレーション不要**。読むテーブルは `mail_messages` / `mail_attachments` / `tournament_drafts` / `events` / `event_broadcast_messages` / `event_line_broadcasts`（H0 採用時は `result_drafts` を追加）のみ、すべて SELECT。`entry_groups` は `events.entry_group_id` 経由で解決できるので直接引く必要はない。
- 一覧・詳細のクエリで `mail_attachments.data`（bytea・85MB）を projection に含めない。バイナリを引くのは R1 と、プレビュー未キャッシュ時の変換のみ。
- 検索は `ILIKE` ＋ 既存インデックス（`mail_messages_received_at_desc_idx`, `mail_attachments_mail_message_id_idx`）で足りる。292通・363kB規模では FTS インデックスは過剰。

### 技術スタック上の制約

- `apps/web` の Server Component ＋ Server Action／route handler で実装（`apps/api` は使わない）。
- UI は既存プリミティブ（`apps/web/src/components/ui/`）と Tailwind v4 トークンのみ。色・フォントを新規に発明しない。
- モバイルファースト 375px 基準・日本語UI。

### 未解決の技術論点（→ 技術計画フェーズで解決）

- 履歴導出ロジックの置き場所（`apps/web/src/lib/mail-history.ts` として単体テスト可能な純関数に切るか、ページ内クエリに埋めるか）。→ 純関数化を前提に検討する。H0 はさらに別ファイル（`mail-history.result-import.ts` 等）へ隔離し、AC-33 の可搬性を構造で担保する。
- 一覧の「もっと読み込む」を Server Action ベースにするか searchParams ベースにするか。
- 添付ビューア（S3）と管理者ビューアの共通化の是非（コンポーネント抽出 vs 複製）。管理者側を変更しない制約と両立する形を選ぶ。
- 対象大会ラベル生成ヘルパー（§3.4 共通規則）の置き場所と、`deriveEntryGroupName` の再利用範囲。

---

## 7. 設計判断の根拠

### 履歴を導出方式にした理由
追記型ログテーブルを新設すると、管理者側の各アクション（`dismissMail` / `processMail` / `undoTriage` / `approveDraftUnits`）に書き込みを足す必要があり、「会員向けの読み取り専用機能」という本件のスコープを越えて管理者フローの改修になる。既存カラムだけで、ユーザーが求めた3種類の履歴行はすべて日付つきで導出できる（`triaged_at` / `tournament_drafts.approved_at` / `event_broadcast_messages.sent_at`）。失うのは「取り消しの履歴」と「古い67通の対応不要日時」のみで、費用対効果が見合わない。

### 「対応不要」を消去法で判定することの限界を受け入れた理由
`dismissMail` は `triage_status='processed'` と `triaged_at` を書くだけで、「対応不要である」という積極的な印を残さない。したがって `processed` かつ H0〜H3 のいずれでもないもの＝対応不要、という推定になる。

`triage_status='processed'` を書く経路は `actions.ts` に **8箇所**あり、それぞれ H4 に落ちるかどうかは次のとおり（実測で確認済み）:

| 関数 | 行 | H4 に落ちるか |
|------|----|-------------|
| `approveDraft` | 233 | 落ちない（H1: `status='approved'`） |
| `approveDraftUnits` | 786 | 落ちない（H1） |
| `completeDraft` | 886 | 落ちない（H1。draft を `approved` で締める） |
| `rejectDraft` | 956 | **落ちる**（意図どおり。却下＝会として対応しない。本番0件） |
| `linkDraftToEvent` | 1233 | 落ちない（H1。ただし大会名は `tournament_drafts.event_id` からのみ引ける — §3.4） |
| `dismissMail` | 1318 | **落ちる**（本来の対応不要） |
| `processMail` | 1873 | 落ちない（必ず `mail_kind` か `linked_event_id` を伴う → H2 / H3） |
| `approveResultDraft` | 2700 | **落ちる ← 誤ラベル**。H0 を採用しない限り「対応不要として処理」と出る |

つまり「消去法で正しく対応不要になる」のは `dismissMail` と `rejectDraft` の2経路のみで、`approveResultDraft` は現状すでに誤判定する。これが §3.4 の H0 を要検討としている理由。

### H0（試合結果として取り込み）を入れた理由 — 2026-08-09 決定
上表のとおり `approveResultDraft` は現状すでに H4 へ落ちて誤ラベルになる。大会結果報告メールは毎大会届く継続的なカテゴリなので、放置すると誤表示が積み上がる。`senseki-boundary`（配布版から物理削除する範囲）が1箇所増えるコストより、誤ラベルを消す価値が上回ると判断した。削除の可搬性は AC-33 で担保する（H0 を除去しても他の履歴行が成立し、当該メールは H4 に落ちるだけ）。

### `classification='noise'` を除外しない理由
`classifier.ts:507-520` のとおり `noise` はAIが「新規の大会案内ではない」と判断した印であって、スパム判定ではない。実データの `noise` 61通には「抽選について」「名簿共有」「大会結果報告」「ライブ配信案内」など会員に有用な連絡が並ぶ。除外基準に使うと機能が成立しない。

### 全件公開（PIIを含む）を選んだ理由
受信箱には他会の申込名簿など第三者の個人情報を含む添付がある。それでも全件公開とするのは、(a) 招待制・LINE認証のみの身内アプリで外部から到達できないこと、(b) 同じ添付が既に管理者からLINEグループへ配信されており会員はすでに受け取っていること、(c) 大会関連の絞り込み（約55通）では事務連絡・名簿確認依頼が見えず検索機能として成立しないこと、による。外部公開時には再検討が必要（`project_self_identify_verification_pending` と同じくリスク受容の判断）。

### 会員用ルートを別に立てる理由
既存 `/api/admin/mail/attachments/[id]` のガードをその場で緩めると、管理者専用であることを前提にした周辺（プレビュー生成のコスト前提、`?from=` の許可プレフィックス）まで暗黙に会員へ開くことになる。境界を明示的に分けて、共通化はハンドラ抽出のレベルで行う。

### 「メール」タブを全員に開放する理由
`/admin/entries`（申込管理ボード）を一般会員へ開放したときと同じ形。設定ハブ配下に埋めると日常導線として見つからず、検索機能の価値が出ない。タブ数は一般会員6・管理者6で揃う。

---

## 変更履歴

- 2026-08-09: 新規作成
- 2026-08-09: design-screen 収束を反映（理由: デザイン確定に伴う整合）。§3.5 の表示順を design-spec へ委譲し内容の列挙に変更／§3.5b（一覧カードの表示内容・差出人を出さない）を追加

---

## デザインへの宿題（→ /design-screen member-mail-search）

**すべて解決済み（2026-08-09・`design-spec.md` が `status: locked`）。** 以下の8点は design-spec の §3 設計判断・§8 忠実度チェックリストに落ちている。

1. ~~処理履歴の見せ方~~ → 案A タイムライン採用
2. ~~日付のない行（H5）の扱い~~ → ドットを砂色・日付見出しなし・補足を `--kg-fg-muted`
3. ~~検索バーと「添付ありのみ」トグルの配置~~ → スクローラー内 `sticky top:0`
4. ~~一覧カードの情報密度~~ → 差出人を落とし、履歴の最新1行を入れる
5. ~~添付チップの見せ方~~ → 一覧＝チップ（`AttachmentList` 相当）／詳細＝行リスト（サイズ付き）
6. ~~未処理ピルの色とトーン~~ → `warn`
7. ~~空状態の文言とレイアウト~~ → design-spec §3・`edge.html`
8. ~~「もっと読み込む」の位置~~ → リスト末尾中央
