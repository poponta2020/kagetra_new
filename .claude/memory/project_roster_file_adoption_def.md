---
name: feature-def-roster-file-adoption
description: roster-file-adoption 要件定義（名簿ファイル採用）
type: project
---

roster-file-adoption — 名簿をパースせずファイル原本のまま採用して申込フェーズを進める救済導線。要件定義完了(2026-07-29)・実装未着手。

**背景**: 本番で名簿3件(秋田大会 参加者一覧/参加費一覧・E級D級クラス分け)を取り込もうとして全滅。tournament_entry_rosters は本番0件のまま。原因は決定論パーサ(mail-worker/src/roster-import/parser.ts, roster-deterministic-v1)の3重の壁 —
① ヘッダ検出がタイトル行「●第9回秋田大会参加者」を '参加者' 部分一致で拾い、No.列を氏名列と誤認(rawName=1,2,3…)。実ヘッダの「氏|名」2列分割も '氏' が lastName 語彙に無く認識不可
② duplicate_name_grade が1件でも出ると UI もサーバーも採用を全面ブロック。実際の重複は(a)同じ207人を並べ替えただけの2シート(級別/団体別) (b)末尾のキャンセル・昇級ブロックの再掲 (c)同姓同名の別人(出場番号4305/4306)で、いずれも正常な名簿様式
③ 承認フォームのイベント候補が edition 紐付け済みに限られ、本番は40件中3件しか紐付いていない(秋田DEは未紐付け)
★おまけの独立バグ: 却下すると persistRosterDraft/triggerRosterParse が 'この原本には既に名簿ドラフトがあります (rejected)' で再解析を拒否し、その添付は復旧不能になる。**本番のドラフト#1-3 は pending_review のまま。出荷まで却下しないこと**

**方向転換の判断**: ユーザーの「AIを全く使わずやりきるのは無茶では」に同意。構造化取込の本命は P3「AI名簿→反映」(AI抽出＋人間承認＋決定論書込のハイブリッド。extracted_payload がパーサ非依存JSONなので生成元の差し替えだけで承認画面・materialize は無改修)。本機能はそれとは別に、**フェーズ管理(会の進行)と構造化データ(統計)を分離**してファイルだけで進める恒久的な逃げ道を作るもの。AI取込導入後も抽出失敗の受け皿として残す。

**確定した設計判断**:
- 新テーブル tournament_entry_roster_files（tournament_entry_rosters を拡張しない）。★理由=entries 0件の roster 行を混ぜると /dashboard の出場者チップが出欠フォールバックを失い「0人」表示になる・版管理UNIQUE・lottery facts も巻き込む
- source_attachment_id は NOT NULL + ON DELETE **CASCADE**(mail→attachment が既に CASCADE のため RESTRICT だと将来のメール削除が落ちる。attachment_share_tokens 等ポインタ表の前例に揃えた)。entry_group_id は RESTRICT
- hasConfirmedRoster の拡張点は /admin/entries/page.tsx のクエリ1箇所だけ。classify 純関数は不変(消費者は groupBoard のみ・entry-overdue-alert は entry_status しか見ず名簿非依存＝ボードとリマインドの食い違いは構造上起きない)
- 会員向けビューアは /roster-files/[id] + /api/roster-files/[id]{,/preview/[page]} を新設し loadAdoptedRosterFile 1本で fail-closed 認可。管理者向け既存routeは無変更
- 採用元はメール添付のみ(手動アップロード無し)・原本は会員全員に公開・確定名簿のみフェーズ連動(申込は表示のみ)・パース済み優先でファイルは補助表示

**AC 13件**(auto-test 12 / manual 1=本番の滞留3添付を実採用)。親Issue #403 / 子 #404-408。Wave1=#404(スキーマ)、Wave2=#405-408 並行。正典= docs/features/roster-file-adoption/{requirements,implementation-plan}.md

調査に使った本番接続は [[reference_prod_db_tunnel_connect]]、パーサ再現は scripts/diagnostics/replay-roster-parse.mts(添付DL先は scratchpad。実名1200人分のPIIなのでfixture化禁止＝合成xlsxで構造特性だけ再現)
