# 過去大会結果 一括投入 — 作業引き継ぎ

> 2026-06-21 更新。**manifest（投入計画）完成**。次セッションは **投入スクリプト作成** から。
> このドキュメント＋関連メモリを読めば文脈ゼロから続行できる。
> 設計の大前提（同一性 (name+date)×級 / 重複処理 / 同姓同名受容）はこのファイルの「確定済み設計」を参照。

## ゴール

ユーザー保有の**過去の大会結果 Excel（数百件）を本番DBに一括投入**する。
これから来るメールは通常のアプリフロー（メール→AI抽出→承認）。**過去分のみ**この一括バッチの対象。

---

## 確定済み設計（合意済み・変更しない）

### 同一性モデル（最重要）
- **tournament 行 = 開催単位 = (正規化大会名 + 開催日) × 級**
- 同じ大会名でも**開催日が違えば別 tournament 行**。これで「3月/8月の別開催」「同じD級を年2回」「級ごとに開催日が違う」を全てスキーマ変更なしで吸収する。
- ❌ **1大会に束ねて class に日付を持たせる案は不可**：parser/materialize が className で級を一意に MERGE するため、年2回同級で**データ消失**する。
- 大会ブランドの束ね（「第N回〜」を1見出しに）は後の表示用 series で対応（今回スコープ外）。

### 重複処理
- 同一 (大会名, 開催日) の**同じ級が複数ファイル = 再掲** → **1回だけ**採用。
- 採用は「より完全な方」。ただし max(試合数) は誤り（訂正版は行が減ることがある）。**訂正版/改定版/新しい方を優先**。

### 名寄せ（manifest 方式・完全自動化しない）
- 投入単位 = **1年分の Excel フォルダ**。
- フロー: 全パース →「大会名候補 × 開催日 × 級 × 選手/試合数 × 採用ファイル」を **manifest(CSV) に自動下書き** → **ユーザーがレビュー確定** → 確定 manifest で投入。
- 開催日は自動キーにできない（報告作成日≠競技日、取得不可あり）ので**人が確定**する。

### 同姓同名
- **区別しない**（リスク受容）。所属会も識別キーに使わない（変わるため）。
- 生データ tournament_participants が氏名・所属を保持 → 将来区別したくなれば再構築可能＝**不可逆ではない**。

---

## 現在地（2026-06-21）

- **manifest 完成**: `scripts/大会結果取り込み/2025年_manifest.csv`（667 class行）＋ `2025年_manifest_summary.txt`
- 対象: `scripts/大会結果取り込み/2025年/` の **116 Excel**（.xlsx 107 / .xls 9）＋ 札幌 PDF 2（別途）
- adopt=YES **664** / DUP-SKIP **3** / REVIEW **0**
- 開催日 **667/667 確定**（未確定 0、ファイル名≠JKA不一致 0）
- 全 116 ファイル **パース成功**（後回し 0）
- **未着手**: 投入スクリプト、コピーDBリハーサル、本番投入

### 成果物の場所
- Excel原本: `scripts/大会結果取り込み/2025年/`（**.gitignore済・実名・コミット禁止**）
- manifest: 同フォルダ直下 `2025年_manifest.csv` / `2025年_manifest_summary.txt`（gitignore済）
- サンプル: `docs/調査用/`（git外・実名・コミット禁止。設計検証用で本番対象ではない）
- **ハーネス**（`c:\tmp`・git外・このマシンのみ。再現はロジックを scripts 化し直す）:
  - `grids.py <dir> <out.json>` / `grids_xls.py <dir> <out.json>` — Excel→グリッドJSON（openpyxl/xlrd、reader.ts相当）
  - `make-manifest.mjs` — 本体。本物 parser.ts を type-strip でロード＋JKA日付結合＋重複判定＋救済パーサ。出力=manifest.csv/_summary.txt
  - `jka-dates-2025.mjs` — JKA公式日程テーブル＋EXTRA手動override＋DROP_FILES
  - `compare-dups.mjs`（名簿照合）/ `dump-broken.mjs`（構造ダンプ）
  - ⚠ **救済ロジックは c:\tmp のみ**。投入スクリプトへ移植が必要（新潟/熊本=salvageParse系、大垣=salvageOgaki系）。

### manifest 列
`instance_key(nameKey|date)` / `tournament_name` / `event_date` / `date_source` / `sheet_date_cands` / `grade` / `class_name` / `players` / `matches` / `source_file` / `adopt(YES|DUP-SKIP)` / `dup_note` / `marker` / `quality`

---

## 本セッションの確定事項（再導出不要）

### 開催日
- JKA cup-info/date/2025 を級レベルで取得 → 各行へ (開催地×回×級) で結合（make-manifest の PLACE_TOKENS / roundOf / jkaDateFor）。
- 優先順位: ファイル名の明示日付 > JKA結合 > JKA(ファイル全級同日) > シート日付∩JKA > 月のみ。
- 級ごと開催日違いを正しく分割（横浜105 A=9/14・B=8/16・C=8/17 / 山口13 CDE=12/20・AB=12/21 / 宮崎41 ABC=6/15・D=11/9 / 奈良34 / 愛知25 / 桑名82 ほか）。
- JKA曖昧・未収載は `jka-dates-2025.mjs` の EXTRA で手動確定: 広島34 D・E=11/3、京都76 C/D=1/19・E=1/18、益田30 E=5/31・E2回目=10/26、杉並DEF=6/14（ファイル名「第二十三回」は誤記・実際は第2回）。

### 重複・dedup
- 桑名82「(AB級)報告用」は全5級入りの完全ファイル（A=3/16, B=3/15, C=1/19, D=1/18, E=1/18）。単独「C級」「DE級」は名簿完全一致の重複（compare-dups.mjs で確認）→ DROP_FILES で除外し報告用を採用。
- 秋田8: 「ABCD」(D=55名, 10/5) と「DE」(D=43名) は D級名簿が別物（共通27・部分集合でない）→ 別開催として分離。**DE=8/31 はユーザー確定済み（2026-06-21・別日開催）**。

### 救済パーサ（make-manifest 内のみ。本番 parser.ts は未変更）
壊れていた4ファイルは全て救済・検証済み（各ファイル内「大会報告」記載人数と一致）:
- 新潟7（計489名）: 2行に分割されたヘッダをマージ。
- 熊本41（A62/B77/C95/D93）: 2行ヘッダ＋「勝敗/枚数」列ズレをデータ内容で判定して吸収（B/D級は元々消失→復活、C級は試合0→正常化）。
- 大垣13（A151/B205/C205/D208/E115）: 全日協ID方式＝対戦相手をシート内 ID→氏名 対応表で解決＋姓/名の分割列を結合。
- ⚠ **投入スクリプトへ移植が必要**。

### F級
- **取り込まない**（ユーザー指示）。椿杯/静岡58/静岡59/杉並のDEFファイルにF級データ有り（className扱い・grade未付与）だが**投入時に除外**すること。

### その他
- 表記揺れ4組（横浜105 / 千葉3 / 宇都宮12 / 近江神宮75）は名称差のみで開催日が違うため実害なし → 名寄せは保留（ユーザー指示）。
- 札幌 2 件は PDF（別途対応）。

---

## 再利用資産（実装済み・そのまま呼ぶ）

- **パーサ** `apps/mail-worker/src/result-import/parser.ts` の `parseResultExcel(sheets)` → `ParsedClass[]`
  - 出場者DB形式バグ修正済み（PR #165, merge cb8589f）。氏名=漢字・所属=所属会・相手解決OK。
- **reader** `reader.ts` の `readExcel(buf, filename)` — xlsx=exceljs / xls=libreoffice 変換。
- **格納** `apps/web/src/lib/result-import/materialize.ts` の
  `materializeResultDraft(tx, payload, { tournamentName, eventDate, venue, sourceResultDraftId })`
  - ⚠ **tournaments 行は毎回 INSERT**（get-or-create ではない）→ **冪等性はスクリプト側**で「同一 (name, event_date) が既存ならスキップ」を実装する。
  - ⚠ **`MaterializeOpts.sourceResultDraftId` の型は `number`（必須）**。DBカラムは nullable。スクリプトから null 投入するには **materialize の型を `number | null` に緩める1行変更**が要る（既存呼び出しは number を渡すので非破壊）。
  - players は get-or-create（`normalized_name, affiliation` UNIQUE NULLS NOT DISTINCT）。**同姓同名は同一視＝意図通り**。
  - opponent は class 内で正規化名がユニークな時のみ解決、他は null＋opponent_name テキスト保持。

## DB スキーマ（該当テーブル）
- `tournaments(id, name NOT NULL, event_date nullable, venue nullable, source_result_draft_id nullable)`
- `tournament_classes(id, tournament_id, class_name, grade, num_players, sheet_name)`
- `tournament_participants(id, class_id, player_id, name, name_kana, affiliation, prefecture, dan, member_no, final_rank, seq_no)` ← 各大会の生スナップショット（常に正）
- `matches(class_id, round, participant_id, opponent_participant_id, opponent_name, result, status, score_diff)`
- `players(id, display_name, normalized_name, name_kana, affiliation, prefecture)` / UNIQUE(normalized_name, affiliation) NULLS NOT DISTINCT

---

## 次の作業（投入スクリプト）— 未着手

1. **materialize.ts は読了済**（上記「再利用資産」の注意点を参照）。
2. **アーキテクチャの肝＝ (name, date) でグルーピングして materialize を呼ぶ**:
   - 1インスタンスが複数ファイルに跨る（大分 AB＋CDE 等）。
   - 1ファイルの級が複数日に割れる（桑名 報告用→4日）。
   - → 各ファイルをパース（救済込み）→ 各クラスを manifest の (tournament_name, event_date, adopt) で振り分け → **adopt=YES かつ 非F** のみ → **(name,date) で束ねて 1インスタンス1回 materialize 呼び出し**。
3. **冪等**: 同一 (name, event_date) が既存ならスキップ（再実行可）。
4. **venue**: manifest に無い。JKA に会場あり（jka-dates に保持。必要なら列追加）。schema が null 許容なら省略可。
5. 配置: `scripts/migration/`。救済ロジック（新潟/熊本/大垣）を移植。

### 本番投入の安全順序（崩さない）
1. 本番DBバックアップ（R2、docs/deploy/backup.md）。
2. **コピーDB（pg_dump→別DB）で全件リハーサル**＋件数確認。
3. dry-run（書き込み無しサマリ）。
4. 本番コミット（**開催単位 tx**）※**本番書き込みはユーザー確認必須**。
5. **read-back で件数照合**（tournaments / participants / matches）＋戦績スポット確認。
- ✅ **本番DB疎通テスト 済み**（2026-06-21、SSH→docker→psql で全テーブル 0 件を確認）。初回投入は空テーブルへ＝既存衝突なし。

---

## 実行環境・本番アクセス

- **本番ホスト**: `ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com`（Oracle 東京、140.238.51.41）。
- **本番DB**: docker の `kagetra-postgres`、DB=kagetra、localhost bind（外部非公開）。
  - 読み例: `ssh ... 'sudo docker exec kagetra-postgres psql -U kagetra -d kagetra -c "..."'`
- **.xls 変換**: libreoffice は**本番ホストにあり**。**ローカル Windows には無い**（アンインストール済み）→ .xls はホスト実行 or Python xlrd で。
- **投入の実行場所**: **本番ホスト推奨**（libreoffice＋DBローカル）。ローカル＋SSHトンネルも可だが .xls 不可。

---

## 注意（このセッション環境の問題 — 必読）

- **tool 出力の捏造現象**（メモリ tool-output-fabrication）: Write/Bash の「成功」表示でも**実体が無い**／ls・出力が**偽**のことがある。
  - **重要/不可逆操作の後は必ず** PowerShell Test-Path / Import-Csv 等の**独立系統・単一ファイル単位**で検証（ForEach・複数一括の出力は壊れやすい）。
- **PowerShell 5.1 のエンコーディング**: 日本語は `-Encoding UTF8`（Import-Csv）／Python は `utf-8-sig`。怠ると**文字化け**。Bashコンソールは日本語が化けるがファイル実体は正常。
- **⚠ ツール呼び出しの antml: 接頭辞必須**（メモリ feedback_tool_call_antml_prefix）。落とすと壊れた呼び出しで生テキスト露出。送信前にタグ確認。
- 本番書き込みは特に **read-back 必須**。

---

## 関連

- メモリ: project_bulk_result_import_design / project_homonym_risk_accepted / reference_tool_output_fabrication / feedback_tool_call_antml_prefix
- 機能: impl_tournament_results / impl_fix_result_parser_shusshadb（PR #165）
- 既存資産: `apps/mail-worker/src/result-import/{parser.ts, reader.ts, normalize.ts}` / `apps/web/src/lib/result-import/materialize.ts`
- **別バグ未対応**: 熊本票（シート 大会報告/Ａ級詳報/Ｂ級詳報）は署名検出されず**0件取り込み**になる。本作業とは別件、要 issue 化。
