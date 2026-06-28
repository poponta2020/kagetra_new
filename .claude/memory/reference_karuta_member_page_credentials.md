---
name: reference_karuta_member_page_credentials
description: 全日本かるた協会 会員ページのログイン資格情報の保管場所（パスワード本体はここに書かない）
metadata: 
  node_type: memory
  type: reference
  originSessionId: 18fb314c-25bf-47b3-9ee2-2ca50ce78dd2
---

全日本かるた協会 会員ページ（過去大会結果の一次ソース。[[project_karuta_member_result_source]]）のログイン ID/パスワードは、リポジトリ root の `.credentials.local.md` にある。

このファイルは `.gitignore`（`.credentials.local.md` 明示ルール）で除外済みで、`git check-ignore` 検証済み。**パスワード本体はこのメモリ（=git push される）やコード/worklog/コミットには絶対に書かない。** 参照が必要なときは `.credentials.local.md` を Read すること。
