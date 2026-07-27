---
status: locked
round: 2
design_source: claude-design
mock_dir: docs/features/entry-form-autofill/design-mock/
design_project: { name: Kagetra Design System, id: 74ab8bf1-f11a-48e8-9853-e063b2f1f2d5 }
chosen_direction: B（3ステップウィザード）
locked_at: 2026-07-27
---
# entry-form-autofill design-spec

要件は [requirements.md](requirements.md) を参照（レイアウトの言葉での再記述はしない）。

## Round 1: S2 構造の A/B 比較 → **B案採用**

- **A案** `a-normal.html` — 縦スクロール1枚。**不採用**（比較記録として残置）
- **B案** `b-step1/2/3.html` — 3ステップウィザード（EntryFlow の点＋罫線意匠をステップ表示に転用）。step2 は警告を画面先頭の warn 面に先出し

## Round 2: B案の状態網羅（S1/S3 含む）

- `b-step1-multisheet.html` — 鳳玉型（級別複数シート）。シートタブ（下線トグル）＋タブ内に級・記入開始行・振分名を表示
- `b-step1-aifallback.html` — ヒューリスティック失敗→AI（Haiku）推定。AI 告知面は brand-bg（警告ではないので朱を使わない）・各列に「AI」タグ・「対応なし=空欄」の列も明示
- `b-step2-edit.html` — 行タップ→ボトムシート編集。かな欠損は warn 面＋必須マーク、「会員情報にも保存」を明記。参加級/段位/出場回数/備考は「この申込書だけ」の注記。productionize 時は createPortal(body)+svh 規約（feedback_bottom_sheet_url_bar_hidden）に載せる
- `b-done.html` — 完了。成功リング=success（藍）、作成サマリ＋「この後の流れ」2ステップ（Yahoo で送信→申込済にする）
- `b-error.html` — IMAP 失敗。danger 面のエラー詳細＋「xlsx は生成済み・編集内容は保存済み」の success 面＋DL/再試行
- `s1-lifecycle.html` — 進行管理への delta（作成前/作成後の2態並置）。既存行意匠に「申込書」行を1行追加、作成後は pill「下書き作成済」＋日時・作成者＋DL 行
- `s3-settings.html` — 設定ハブ配下の6項目フォーム。E-Mail に「差出人になる」等のヒント行

共通の意匠判断:
- 脱カード方針（event-detail-redesign 踏襲）: 節は「見出し＋右へ伸びる罫線」、リストは罫線行
- 級表示は Serif（--kg-font-display）＋ --kg-brand-fg
- 朱（--kg-accent）は警告のみ（ふりがな未登録・出場回数不確か）
- AI/抽出由来のプレフィル値には出所バッジ（「申込書から抽出」「主催者指定を抽出」「定型」）
- CTA 直下に「送信はされません」の常設注記
- モックデータ: 第3回青森大会 15名（A5/B5/C3/D1/E1）を模した**架空名**。実データ配線は /implement
- ボトムシートのオーバーレイ `rgba(30,27,19,0.4)` は既存の bg-black/40 相当（配色トークン正典の意図的例外）に合わせた ink 基調の非トークン値

## 必要データ（仮データ→実配線の対応表）

モックは全て架空データ。/implement 時の実配線元:

| モックの表示 | 実データ元 |
|---|---|
| グループ名・開催日・締切（サブタイトル） | entry_groups → events（deriveEntryGroupName・entryDeadline） |
| テンプレ候補「案内メール添付・5/8受信」 | events.tournamentDraftId → tournament_drafts.messageId → mail_messages → mail_attachments（.xlsx のみ） |
| 会員行（級・姓名・かな・段位） | event_attendances(attend=true) → users（grade/familyName/givenName/familyKana/givenKana/dan） |
| 出場回数 | appearance-counts（基準日=作成日）。incomplete 時に warn |
| 列の対応（B列=参加級 等） | セルマップ推定（ヒューリスティック→Haiku fallback）。requirements §3.2.3 |
| 宛先・件名・ファイル名の出所バッジ | requirements §3.2.6 のプレフィル優先順のどこで決まったか |
| 所属会・責任者・電話・E-Mail・振込名義人 | settings テーブル（S3 で編集） |
| S1「下書き作成済 7/27 21:04・土居」 | 作成履歴テーブル（最新行） |

## 忠実度チェックリスト

- [ ] S2 は3ステップウィザード。ステップ表示は EntryFlow と同じ点＋罫線意匠（done=藍塗り点・now=藍リング点・ラベル now は藍太字）で、カード枠・番号丸を使わない（b-step1.html）
- [ ] 節見出しは「13px 太字＋右へ伸びる 1px 罫線（--kg-border-soft）」。節や一覧を Card で包んでいない（全カード共通・脱カード方針）
- [ ] 会員行の要素順: 級（Serif・--kg-brand-fg・幅固定）→ 姓名（太字）＋かな（10px --kg-fg-3 の2行目）→ 段位（右寄せ）→ 出場回数（右寄せ）→ ›。行区切りは --kg-border-soft の罫線（b-step2.html）
- [ ] 朱（--kg-accent 系）は警告（ふりがな未登録・出場回数不確か・必須マーク・失敗）のみ。AI 告知・成功・ステップ表示に朱を使っていない
- [ ] AI 推定の告知は --kg-brand-bg の面＋「必ず確認」の一文＋列ごとの「AI」タグ（b-step1-aifallback.html）。列対応リストの「対応なし」列は --kg-fg-muted で「空欄のまま」と明示
- [ ] step2 の警告は画面先頭の --kg-warn-bg 面に会員名リンク付きで先出しし、該当行にも ⚠ を重ねる（b-step2.html）
- [ ] 級別複数シートは下線トグルのタブ（active=--kg-brand の 2px 下線＋--kg-brand-fg 太字）＋タブ内に人数、下部に「シートへの振分」行（b-step1-multisheet.html）
- [ ] 会員編集はボトムシート（グリップバー・rgba(30,27,19,0.4) オーバーレイ）。かな欠損は warn 面＋「会員情報にも保存され…」の文言、下部に「参加級・段位・出場回数・備考の変更はこの申込書だけ」の注記（b-step2-edit.html）
- [ ] メール欄のプレフィル値には出所バッジ（「申込書から抽出」「主催者指定を抽出」=--kg-brand-bg、「定型」=--kg-info-bg）が付く（b-step3.html）
- [ ] 下書き作成 CTA の直下に「送信はされません — …」の 10px 注記が常設（b-step3.html / a-normal.html）
- [ ] 完了画面は success（藍）リング＋「作成した下書き」サマリ＋「この後の流れ」2ステップ（①Yahoo で確認・送信（旧下書き削除の注意つき）②申込済にする）（b-done.html）
- [ ] 失敗画面は danger 面のエラー詳細と、--kg-success-bg 面の「申込書は生成済み・編集内容は保存済み」＋「ダウンロード」「もう一度作成」の並置（b-error.html）
- [ ] S1 進行管理は既存行意匠のまま「申込書」行を追加。作成後は pill「下書き作成済」（--kg-success-bg/fg）＋日時・作成者メタ＋ファイル名/DL 行（s1-lifecycle.html）
- [ ] S3 は 375px で1カラムの平組みフォーム。E-Mail と振込名義人にヒント行（10px --kg-fg-muted）（s3-settings.html）
- [ ] 375px で全カードとも横スクロールが発生しない

## 要件への宿題（→ /define-feature entry-form-autofill）
（なし — 「失敗時も編集値・生成 xlsx が残る」は requirements §3.2.7/3.2.8 に反映済み）
