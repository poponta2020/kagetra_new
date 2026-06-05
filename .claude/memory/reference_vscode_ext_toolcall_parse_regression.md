---
name: reference_vscode_ext_toolcall_parse_regression
description: VSCode拡張 Claude Code 2.1.158-2.1.162 の tool_use input パース退行。「could not be parsed (retry also failed)」で出力停止する原因
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9f42ed12-4a59-476d-bf26-a5beb21ef669
---

「The model's tool call could not be parsed (retry also failed).」で出力が止まる症状の原因は、**VSCode拡張同梱CLIの 2.1.158〜2.1.162 に入った退行**。モデル側は正常（`stop_reason: tool_use`、max_tokens切り詰めでもコンテキスト溢れでもない）だが、拡張のストリーム再構成が tool_use ブロックの `input` JSON 組み立てに失敗してブロックを破棄し、「Your tool call was malformed and could not be parsed. Please retry.」をモデルに投げ返す。即時リトライも失敗すると上記の最終エラーで停止。

**確定根拠（2026-06-04〜05 のトランスクリプト実測）**: malformed 計20件が全て 2.1.158/161/162・全て `entrypoint: claude-vscode`。過去に使った 2.1.123/131/143/145 ではゼロ。失敗ターンの保存内容は「空thinking＋署名のみ・tool_use 消失」= クライアント側再構成失敗の指紋。npm `stable` タグは 2.1.153 のまま（退行前）。Windowsパスのバックスラッシュ・エスケープ済みクォート・大きな Write/Edit で踏みやすいが決定要因は拡張バージョン。ターミナルのスタンドアロンCLI(2.1.109)は無関係。

**対処**: ①拡張を 2.1.153/2.1.145 に「別バージョンをインストール」で固定＋Auto Update OFF（最確実）②2.1.163 を試す（直っていれば可、再発したら①）③重い実装は統合ターミナルの CLI 2.1.109 で。緩和=大Write/PowerShellヒアドキュメント分割（根治せず）。本件はクライアント側退行なので拡張側修正が出れば解消見込み——直ったら本メモリを更新/削除。
