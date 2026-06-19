---
status: completed
completed_sections: [ユーザーストーリー, データ調査, 機能要件, 技術設計, 影響範囲]
next_section: null
---
# tournament-results 要件定義書

全国の競技かるた大会の結果（メーリングリストで届く Excel）をアプリに取り込み、**全選手の試合勝敗を DB に記録・保存**し、会員が閲覧できるようにする機能。

> 実データ 42 ファイル（`docs/調査用/大会結果`＋`大会結果2`、5か月分）を解析して設計。フォーマットは多様だが
> **全対戦シートが「選手名＋相手/枚数/勝敗×N回戦」の普遍シグネチャに収束**するため、**ヘッダ署名駆動の決定的パーサ 1 本**で
> 処理できる。**AI は使わない（API コスト $0）**。署名に合致しない真の定型外のみ管理者が手動補正（これも $0）。

## 1. 概要
- **目的**：全国大会結果の記録・保存（最優先）。蓄積データから選手成績・統計を後段で引き出す土台。
- **背景**：旧 kagetra の `contest_*`（試合結果）機能の再実装。結果は標準ツール（マクロ「大会結果入力シート」/「伊助」）製 Excel でメーリス着。
- **位置づけ**：既存 `mail-tournament-import`（大会“案内”取込）の兄弟。基盤（IMAP・添付保存・ジョブキュー・レビュー UI）を再利用。

## 2. ユーザーストーリー
- 管理者/副管理者が、受信メールの結果 Excel を「結果として取り込む」→ 自動パース → 内容確認 → 承認で DB 保存。
- 全会員が、選手名で検索して「その選手の全大会の戦績」を閲覧できる。
- 記録対象は会員＋外部選手の全選手。記録粒度は試合単位（勝敗＋枚数差）。

## 3. 機能要件

### 3.1 取り込み（管理者）
- mail-inbox 詳細に **「結果として取り込む」** アクション追加（.xls/.xlsx 添付があるメールで表示。既存の「会で流す(AI抽出)」「既存イベントに紐付け」「対応不要」と並ぶ）。
- 押下で `result_parse` ジョブ投入 → mail-worker が Excel をパース → `result_drafts` に格納（成功=`pending_review` / 失敗=`parse_failed`）。完了は Web Push（既存流用）。添付が複数 Excel なら対象選択。

### 3.2 レビューと確定（管理者）
- レビュー画面に解析結果を表示：**大会名（編集可、件名/ファイル名からプリフィル）**、開催日・会場（任意、null 可）、級ごとの一覧（class_name/grade/参加者数/試合数）と参加者・試合プレビュー。
- **承認**：1 トランザクションで `tournaments`/`tournament_classes`/`tournament_participants`/`matches` を作成し、**`players` を get-or-create して participant に紐付け**。draft=approved、メール=processed。
- **却下**：draft=rejected。`parse_failed` は内容表示の上で却下のみ（v1 はセル補正・手動登録は非対応＝後続）。
- 訂正版の再取込は既存 supersede（差し替え）で対応。

### 3.3 閲覧（全会員）
- **選手戦績ページ**：選手名で検索 → `players` を引き当て → その選手の全出場（大会・級・順位・各試合の相手/枚数/勝敗）を読み取り専用で表示。
- 勝敗数は表示時に `matches` から集計（後述の集計ルール）。

### 3.4 ビジネスルール / パース・集計仕様
- **普遍シグネチャ**：ヘッダ行に「選手名」＋「相手/枚数/勝敗」×N を持つシートを対戦シートと判定。無いシート（大会報告・入賞者・表紙・マニュアル・集計のみ級シート・歴代優勝 等）は**スキップ**。
- 列は**名前で特定**（位置・列順非依存）。級は「級/クラス列があれば列、無ければシート名」。class_name は**自由文字列**、grade(A–E) は best-effort 導出（非該当は null）。
- 1 行=1 選手。各回戦 (相手,枚数,勝敗) を 1 試合として**選手視点 2 行**で取り込み（勝者○/敗者×で重複出現＝ロスレス）。**不戦勝のみ 1 行**（相手なし）。
- トークン正規化：枚数 ∈ {整数, `不戦勝`, `棄権`}、勝敗 ∈ {○, 〇, ×}。3 ケースを `status` で表現（下表）。
  | ケース | 行数 | 相手 | score_diff | result | status |
  |---|---|---|---|---|---|
  | 通常 | 2（○/×） | あり | 数値 | win/lose | `normal` |
  | 不戦勝 | 1（○のみ） | なし | null | win | `walkover` |
  | 棄権 | 2（○/×） | あり | null | win/lose | `forfeit` |
- **勝敗数は固定カラムに保存せず `matches` から導出**（数え方変更で再取込不要）。集計は **`status=normal` の実戦のみ**：勝ち数=count(normal & win)、負け数=count(normal & lose)。**不戦勝・棄権は勝敗数に含めない**（不戦勝/棄権の回数は必要なら `status` で別集計）。
- `final_rank` は順位列の生テキスト（優勝/準優勝/３位/４位）をそのまま保持（導出不可のため）。
- 相手は同一級内の参加者名で解決（解決時 opponent_participant_id、未解決時は opponent_name 保持）。
- **選手マスタ名寄せ**：取込承認時に各 participant を **正規化した (名前, 所属) で `players` を get-or-create** して `player_id` を付与。正規化＝空白除去・全半角統一(NFKC)・○/〇や髙/高等の揺れ吸収。participant は「その大会の生スナップショット」を別途保持（players は再解決・マージ可能なグルーピング層＝生データが常に正）。
- 1 ファイル=1 tournament（同一大会が複数ファイルでも各 1 行。マージは後続）。

## 4. 技術設計

### 4.1 DB 設計（新規 5 テーブル＋ドラフト、旧 contest_* と整合）
**enum 追加**：`result_draft_status`(pending_review/approved/rejected/parse_failed/superseded)、`match_result`(win/lose)、`match_status`(normal/walkover/forfeit)。`mail_worker_job_kind` に `result_parse` 追加。grade(A–E) は既存流用。

| テーブル | 主な列 |
|---|---|
| `players`（選手マスタ：全国の競技者・会員/非会員問わず） | id / display_name(text,notNull) / **normalized_name**(text,notNull) / name_kana(null) / affiliation(null) / prefecture(null) / **user_id**(FK users set null,null=会員同定/後続) / created_at / updated_at ／ **UNIQUE(normalized_name, affiliation)** |
| `tournaments`（大会＝取込ファイル 1 つ） | id / name(notNull) / event_date(date,null) / venue(text,null) / source_result_draft_id(null) / note(null) / created_at / updated_at |
| `tournament_classes`（級） | id / tournament_id(FK cascade) / class_name(text,notNull) / grade(grade,null) / num_players(int,null) / sheet_name(text,null) |
| `tournament_participants`（大会ごとの出場スナップショット） | id / class_id(FK cascade) / **player_id**(FK players set null) / seq_no(int,null) / name(text,notNull) / name_kana(null) / affiliation(null) / prefecture(null) / dan(null) / member_no(null) / final_rank(text,null) |
| `matches`（試合＝選手視点 1 行） | id / class_id(FK cascade) / round(int) / round_label(text,null) / participant_id(FK cascade) / opponent_participant_id(FK set null,null) / opponent_name(text,null) / result(match_result) / score_diff(int,null) / status(match_status,'normal') |
| `result_drafts`（取込ドラフト＝メール 1 通） | id / message_id(FK mail_messages cascade,unique) / status / extracted_payload(jsonb) / parser_version(text) / parse_error(null) / superseded_by_draft_id(null) / tournament_id(FK set null,null) / approved_by/at / rejected_by/at/reason / created/updated |

- index：players(normalized_name)〔選手検索〕 / players(user_id) / participants(player_id) / participants(class_id) / matches(class_id) / matches(participant_id) / result_drafts(status,created_at)。
- **正規化単一保持**（自会選手の別テーブル複製はしない。自会成績は players.user_id（会員紐付け後）or affiliation のクエリで抽出）。

### 4.2 バックエンド（mail-worker）
- Excel 読取：**.xlsx は `exceljs`、.xls は libreoffice で .xlsx 変換してから読む**（脆弱な `xlsx` lib 不使用。最終選定は PR2、fods 経由も可）。
- パーサ：ヘッダ署名探索 → 列名マッピング → (相手,枚数,勝敗) 抽出 → トークン/丸正規化 → payload 生成（純関数化、42 サンプルで fixture テスト）。
- ジョブ：`result_parse`（payload=`{mail_message_id, attachment_id}`）。`runResultParse` が parse→`result_drafts` 格納→Web Push。既存 extract-only timer に相乗り。

### 4.3 フロント（web）
- Server Action：`triggerResultParse` / `approveResultDraft` / `rejectResultDraft`（既存 `triggerExtractDraft`/`approveDraftUnits` 踏襲）。承認時に players get-or-create＋opponent 解決。
- 管理 UI：mail-inbox 詳細にアクション＋結果レビューコンポーネント。会員 UI：選手戦績ページ（検索＋表示、全ログインユーザー可）。

## 5. 影響範囲
- 追加：shared に 5 テーブル＋3 enum＋relations＋migration、mail-worker に parser＋result_parse 経路、web に取込/レビュー UI＋選手戦績ページ。
- 既存への破壊的変更なし（mail_worker_job_kind への値追加のみ。AI 抽出経路に影響なし）。

## 6. v1 スコープ境界（明示）
- レビューは確認＋大会メタ編集＋承認/却下（**セル単位の補正 UI なし**）。`parse_failed`/真の定型外は却下＝手動対応は後続。
- **会員同定（players.user_id 紐付け）は後続/管理者操作**（v1 は名寄せ＝players 自動 get-or-create までで、user_id は基本 null）。
- 選手マスタの**マージ/分割 UI は後続**（v1 は自動 get-or-create のみ。生データが正なので後から是正可）。
- 統計/ランキング/対戦成績・大会報告(日付/会場)パース・複数ファイルの大会マージ・**団体戦**は v1 対象外。

## 7. 設計判断の根拠
- **ヘッダ署名駆動の単一パーサ**：列を名前で特定し列順/ツール差/級の持ち方/版差(伊助 V0.93→V1.10)を吸収。42 ファイル全変則をカバー。
- **決定的パース > AI**：定型に収束＝コスト $0（無料原則）。真の定型外のみ手動。
- **旧 contest_* 踏襲＋選手マスタ追加**：実データ構造と旧実績モデルが一致。players で名寄せ・通算成績・会員紐付けの土台。[[reference_legacy_dump]]
- **勝敗数は導出（status=normal のみ）**：数え方を後から変えられる。不戦勝・棄権は勝敗数に含めない。
- **players はグルーピング層・participants は生スナップショット**：名寄せ誤りを生データを壊さず是正可能。

## 8. 実装 PR 分割（実装手順書で詳細化）
1. shared スキーマ＋migration（players 含む 5 テーブル＋enum＋relations）
2. パーサ中核（reader＋署名駆動パーサ）＋42 サンプル fixture テスト ← 最重要・最難
3. result_parse ジョブ＋triggerResultParse＋mail-inbox 取込ボタン
4. レビュー UI＋承認/却下 Server Action＋確定保存（players get-or-create・opponent 解決含むトランザクション）
5. 選手戦績ページ（検索＋表示、勝敗は status=normal 集計）

依存：1→2→3→4、1→5。
