---
name: impl_fix_doc_attachment_extraction
description: PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 28823bb7-31e0-47fa-8098-7592e1e9419b
---

PR #134 merge `c208b66` (2026-06-10)、Issue #133 自動クローズ。多摩大会 (draft #29 / mail #98) の AI 抽出で申込締切・参加費・定員が全 null になった原因は二重:

1. 添付 `32rd(A-E)多摩大会案内.doc` が `application/msword` → extraction unsupported / extracted_text NULL → classifyMail の LLM 入力から完全除外（AI は本文のみで判断していた）
2. 実 .doc の締切は「申込期間　令和８年６月１７日　〜　７月１１日」(和暦・全角・期間・級グループ別) — prompt 2.0.0 の「期間表記→null」全日付共通ルールが終了日(=実質の締切)を破棄

非自明ポイント:
- `word-extractor` (pure JS / MIT、依存 saxes+yauzl のみ) で OLE .doc 抽出。日本語は UTF-16 runs なので codepage 問題なし。本文+本文テキストボックスを結合
- classifier に **in-memory lazy fallback**: 取り込み時 unsupported/pending だった行を classify 時にその場抽出。DB は更新しない（classifyMail の pure-read+LLM 不変条件を維持）→ 過去メールも UI の「再抽出」だけで新形式対応が効く。バックフィル SQL 不要
- PROMPT_VERSION 2.1.0: 申込/振込の期間表記は**終了日**を締切に採用（開催日の期間→null は event_date 限定）、和暦=2018+N・全角数字換算を明文化、Example 2 を和暦+全角+期間表記に変更
- XLSX は引き続き意図的 unsupported（xlsx パッケージ脆弱性、PR2 決定のまま）
- **会内締切・抽選日が AI 抽出に入らないのは仕様**（案内文書に存在しない会内運用値。承認フォーム or イベント編集画面で手入力）— ユーザー初報の「会内締切が入らない」はこれで、真のバグは entry_deadline だった
- テスト fixture はローカル Docker + LibreOffice で生成した合成 .doc 9KB をコミット（実メールは含めない方針維持。builders.ts の in-memory 主義の例外として provenance コメント付き）

**残 DoD: 本番 auto-deploy 反映後、mail-inbox で多摩大会 draft #29 を「再抽出」→ 申込締切 (A/B級 2026-07-11、C/D/E級 2026-07-05)・参加費 (A/B 2,500、C/D 2,000、E 1,500)・定員が prefill されるか実機確認 → 承認**。[[feedback_git_textconv_doc_no_utf8_diff]] [[feedback_ship_dod_residual_check]]

⚠️ 2026-06-11 追記: この PR のデプロイは `targets: web=0` で **web が再ビルドされず**、再抽出 Server Action（web バンドル内で classifier を実行）には新ロジックが載っていなかった（Issue #135、ユーザーが再抽出を押しても結果が変わらない実害）。[[impl_fix_deploy_web_rebuild_on_worker_change]] (PR #137) で deploy 判定を修正し web 再ビルドを実施済み。上記 DoD は #137 デプロイ後に消化可能。
