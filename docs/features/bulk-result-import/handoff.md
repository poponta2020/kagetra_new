# 過去大会結果 一括投入 — 作業引き継ぎ

> 2026-06-21 作成。前セッションが長くなったため別セッションへ引き継ぐ用。
> このドキュメント＋関連メモリを読めば文脈ゼロから続行できる。**実装はまだ未着手**（設計と検証のみ完了）。

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
- 採用は「より完全な方」。ただし max(試合数) は誤り（訂正版は行が減ることがある）。**訂正版/改定版/新しい方を優先**し、迷うものは manifest で提示してユーザー確定。

### 名寄せ（manifest 方式・完全自動化しない）
- 投入単位 = **1年分の Excel フォルダ**。
- フロー: 全パース → 「大会名候補 × 開催日 × 級 × 選手/試合数 × 採用ファイル」を **manifest(CSV) に自動下書き** → **ユーザーがレビュー確定**（名寄せ統合・採用級・開催日・重複採否）→ 確定 manifest で投入。
- 開催日は自動キーにできない（報告作成日≠競技日、取得不可あり）ので**人が確定**する。

### 同姓同名
- **区別しない**（リスク受容）。所属会も識別キーに使わない（変わるため）。
- 生データ tournament_participants が氏名・所属を保持するので、将来区別したくなれば再構築可能＝**不可逆ではない**。

---

## 再利用資産（実装済み・そのまま呼ぶ）

- **パーサ** apps/mail-worker/src/result-import/parser.ts の parseResultExcel(sheets) → ParsedClass[]
  - 出場者DB形式バグ修正済み（PR #165, merge cb8589f）。氏名=漢字・所属=所属会・相手解決OK。
- **reader** reader.ts の readExcel(buf, filename) — xlsx=exceljs / xls=libreoffice 変換。
- **格納** apps/web/src/lib/result-import/materialize.ts の
  materializeResultDraft(tx, payload, { tournamentName, eventDate, venue, sourceResultDraftId })
  - players get-or-create（同姓同名は同一視＝意図通り）、opponent 正規化解決、1 tx で確定。
  - sourceResultDraftId は **nullable** → 下書き/メール不要で**スクリプトから直接呼べる**。
- **大会名・開催日・会場はパーサ出力に無い** → manifest から供給（アプリは承認画面 approveResultDraft で手入力していた）。

## DB スキーマ（該当テーブル）
- tournaments(id, name NOT NULL, event_date nullable, venue nullable, source_result_draft_id nullable)
- tournament_classes(id, tournament_id, class_name, grade, num_players, sheet_name)
- tournament_participants(id, class_id, player_id, name, name_kana, affiliation, prefecture, dan, member_no, final_rank, seq_no) ← 各大会の生スナップショット（常に正）
- matches(class_id, round, participant_id, opponent_participant_id, opponent_name, result, status, score_diff)
- players(id, display_name, normalized_name, name_kana, affiliation, prefecture) / UNIQUE(normalized_name, affiliation) NULLS NOT DISTINCT

---

## 作業手順

1. **ユーザーから1年分の Excel フォルダのパスを受け取る**（どの年から始めるか確認）。
2. **パース＋manifest 生成**（既存ハーネス流用、c:\tmp）:
   - グリッド化（Python: xlsx=openpyxl / xls=xlrd で reader.ts 相当。または本番ホストで libreoffice）。
   - 実 parseResultExcel に通す（Node の type-strip で parser.ts を直接ロード、run-parser.mjs / dry-run-import.mjs 参照）。
   - 大会名抽出（ファイル名 stem）＋開催日（ファイル名 → シートの「令和N年」「YYYY年M月D日」）。
   - **manifest CSV**: tournament_name, event_date, date_source, grades, source_files, adopt_file(重複時), players, matches, status(ok/後回し)。
3. **ユーザーが manifest をレビュー・確定**（名寄せ統合・採用級・開催日・重複採否）。
4. **投入スクリプトを作る**（scripts/migration/ に、冪等）:
   - 確定 manifest を読む。
   - 各 (大会, 開催日) について採用ファイルをパース → materializeResultDraft で本番DBへ（sourceResultDraftId=null、name/date/venue は manifest から）。
   - **冪等**: 同一 (name, event_date) が既存ならスキップ（再実行可）。
5. **本番投入の安全順序**:
   1. 本番DBバックアップ（R2、docs/deploy/backup.md）。
   2. **コピーDB（pg_dump→別DB）でリハーサル** = 全件投入して件数確認。
   3. dry-run（書き込み無しで投入予定サマリ）。
   4. 本番コミット（**開催単位 tx**）。
   5. **read-back で件数照合**（tournaments / participants / matches）＋ 戦績スポット確認。
6. パース不能・イレギュラーは**後回しリスト**に出して別途対応。

---

## 実行環境・本番アクセス

- **本番ホスト**: ssh -i ~/.ssh/id_ed25519_oracle ubuntu@new.hokudaicarta.com（Oracle 東京、140.238.51.41）。
- **本番DB**: docker の kagetra-postgres、DB=kagetra、localhost bind（外部非公開）。
  - 読み例: ssh ... 'sudo docker exec kagetra-postgres psql -U kagetra -d kagetra -c "..."'
  - ⚠️ **疎通テストは前セッションで未完**。次セッション冒頭で**まず本番DBから件数を1つ読めるか確認**すること。
- **.xls 変換**: libreoffice は**本番ホストにあり**。**ローカル Windows には無い**（アンインストール済み、レジストリ登録だけ残存）→ .xls はホスト実行 or Python xlrd で。
- **投入の実行場所**: **本番ホスト推奨**（libreoffice＋DBローカル）。ローカル+SSHトンネルも可だが .xls 不可。

---

## 現状の成果物

- **dry-run ハーネス**（c:\tmp、git 外、このマシンのみ）: grids.py / grids_xls.py / run-parser.mjs / dry-run-import.mjs（**開催単位の名寄せ・重複・日付抽出**）。c:\tmp は Drive 外なので再現はロジックを scripts 化し直す。
- **サンプル42件**: docs/調査用/（git 外、実在選手名のためコミット禁止）。**設計検証用で本番対象ではない**。
- **検証結果**: 42件中 41 パース成功、38 件で開催日取得、開催単位の分割・同一開催の級再掲検出を動作確認済み。

---

## 注意（このセッション環境の問題 — 必読）

- **tool 出力の捏造現象**（メモリ tool-output-fabrication）: Write/Bash の「成功」表示でも**実体が無い**／ls・出力が**偽**のことがある。実際このセッションでメモリ4ファイルや本 handoff が「作成成功」表示で書けていなかった。
  - **重要/不可逆操作の後は必ず** PowerShell Test-Path / .NET / git 状態問い合わせ で、**単一ファイル単位**で独立検証（ForEach・複数一括の出力は壊れやすい）。
- **PowerShell 5.1 のエンコーディング**: Get-Content の既定は非UTF-8。日本語は -Encoding UTF8 か .NET ReadAllText/WriteAllText(UTF-8) を使う。怠ると**文字化けして書き戻す**（実際 MEMORY.md を一度破損→復旧した）。
- 本番書き込みは特に **read-back 必須**。

---

## 関連

- メモリ: bulk-result-import-design / homonym-risk-accepted / tool-output-fabrication
- 機能: impl_tournament_results / impl_fix_result_parser_shusshadb（PR #165）
- **別バグ未対応**: 熊本票（シート 大会報告/Ａ級詳報/Ｂ級詳報）は署名検出されず**0件取り込み**になる。本作業とは別件、要 issue 化。