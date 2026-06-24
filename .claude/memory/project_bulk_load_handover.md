---
name: project_bulk_load_handover
description: 過去大会結果の本番DB投入 — 個人戦パース完了(1453大会/82万対戦)、本番投入のみ残(明示GO待ち)。詳細引き継ぎは c:/tmp/HANDOVER_bulk_load.md
metadata: 
  node_type: memory
  type: project
  originSessionId: c46027bf-8209-47b5-a303-06559f887d85
---

過去大会結果(全日本かるた協会会員ページ harvest の HTML/Excel)の本番DB投入タスク。**個人戦パース完全完了 = 1,453大会 / 371,070参加者 / 824,064対戦**。残るは本番DBへの投入のみ（**ユーザー明示GO必須**・未着手）。

**詳細引き継ぎ書**: `c:/tmp/HANDOVER_bulk_load.md` ← 次セッションはまずこれを読む（投入手順/ファイル一覧/接続情報/救済19大会/見送り分類/未解決fail を全記載）。

要点:
- **ローダー**: `apps/web/_rehearse_load.mts`（git外スクラッチ。`DATABASE_URL`切替・`DRY_RUN`/`RECOVERY_ONLY`/`TARGET`/`DIAG`スイッチ・エラーは`e.cause?.message`記録）。救済データ=`c:/tmp/recovery.jsonl`(生成=`extract_recovery.py`)。汎用位置パーサ=`c:/tmp/positional.py`。
- **本番投入手順**: SSHトンネル `ssh -i ~/.ssh/id_ed25519_oracle -L 5432:127.0.0.1:5432 ubuntu@new.hokudaicarta.com` → PWは `sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD`(保存禁止) → `DATABASE_URL="postgresql://kagetra:<PW>@localhost:5432/kagetra" tsx _rehearse_load.mts` → read-back照合。**事前に本番tournament系が空か確認**。
- **救済19大会(systematic pass)**: 兵庫全国第10-13回・大垣第12/13回・札幌第4/5回・北國83・東京都高校初段認定1/3・神奈川県選手権14・鹿児島/佐賀/福井初段認定・ミュンヘン・さがみ野38・桑名76・東京東会76。手法=calamine/ID参照/ヘッダ無し/汎用位置/結合形式/N回修正。
- **見送り確定(別スコープ・ユーザー合意 2026-06-24)**: 団体戦~74(個人戦DBモデルに乗らない=別機能)・レポート/対戦データ無~13・PDF24・暗号化1(三原6414=PW要、入手すれば msoffcrypto で復号可)。
- **fail=2 は解決済(データ/コードのバグでない)**: 真因=`deadlock detected`。`TaskStop`で死にきらないゾンビloaderプロセスが open transaction を掴み、現役runと players get-or-create で相互ロック。ゾンビ一掃後の単一クリーンランは **fail=0** で実証。**本番は単一writerなので無問題**。ただし bulk投入中にアプリ側の大会取込(approveResultDraft/mail-worker)が走ると本物の並行デッドロック有り得る→静かな時間帯に投入。投入前に `_rehearse_load` プロセス0 と pg_stat_activity 自分以外0 を確認。
- **段位(dan)カバレッジ修正 ship 済（PR #169 merge `78e4b51`, 2026-06-25）**: パーサ `parseResultExcel` が positional フォールバック/見出し無し段位列で段位を落としていたのを修正（フォールバックに段位列検出追加＋`findDanColByContent` 内容ベース回収、`danCol` null 時のみ起動＝段位列以外の列割当は不変、実コーパス933ファイルで非dan出力バイト一致を実証）。本番投入時の段位投影 **19,313→22,383件 / 107→128大会**。**残**: 救済 'classes'（兵庫全国10-12 等 ~1,361人・北國83・札幌・東京都高校）は Python `positional.py` 生成物で段位未回収＝やるなら positional.py 改修＋`recovery.jsonl` 再生成。Excel 残りは 683/8764 のみで軽微。
- 並行ブランチ `feature/import-past-results` は終始無視で進めた（ユーザー指示）。**本番書込はGO必須・会員PW(naniwagata)と本番PWは保存禁止**。
- 関連: [[project_bulk_result_import_design]] [[project_karuta_member_result_source]] [[impl_result_html_parser]] [[impl_result_excel_positional]]
