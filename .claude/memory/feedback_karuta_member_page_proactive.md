---
name: feedback_karuta_member_page_proactive
description: かるた関連の調査では全日本かるた協会の会員ページに積極的にログインして一次資料を取りに行く
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 06ed65e3-77fc-4efd-90fd-cea56acdc47b
---

かるた関連の調査をするときは、**全日本かるた協会の会員ページ（ログイン必須）にも積極的に見に行く**こと。一般公開ページや web 検索だけで止めない。

**Why**: 制度の詳細定義・通達・運用文書は会員ページ限定で公開されていないことが多い（2026-06-26 の「公認大会 抽選出場回数優先ルール」調査で、規程本文＋web 検索では曖昧なままだったが、会員限定の通達 `member-document/13161`/`10819` の添付に最精密な定義があった）。ユーザーが「会員ページも積極的に見に行って」と明示。

**How to apply**:
- ログインは WP-Members フォーム（フィールド `log`/`pwd`/`a=login`/`_wpmem_login_nonce`）。資格情報は [[reference_karuta_member_page_credentials]]（repo root `.credentials.local.md`）。curl で nonce 取得→POST→cookie で会員ページ取得が通る。パスワードはファイルから変数経由で渡し、コマンド/出力/memory に直書きしない。
- 通達文書一覧: `https://www.karuta.or.jp/memberdocumentcat/administration/`。添付は `member-download/<id>` から cookie 付き curl で取得。docx/xlsx は zip 解凍→XML テキスト抽出、PDF は Read で読む。
- 成果物の一次資料は git 外（C:/tmp 等）に置く。関連: [[reference_karuta_kounin_taikai_lottery]]、[[project_karuta_member_result_source]]。
