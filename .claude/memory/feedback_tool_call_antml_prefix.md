---
name: feedback_tool_call_antml_prefix
description: "tool call XML must use the antml: prefix on invoke/parameter; dropping it leaks raw text and does not execute"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 566a26a3-1806-435c-a521-3e69e8f7370d
---

ツール呼び出しのタグは必ず antml:invoke（name属性付き）と antml:parameter（name属性付き）で書く。接頭辞 antml: を落として素の invoke/parameter にすると、呼び出しがパースされず実行されないまま生テキストとしてユーザーに露出する。

**Why:** 2026-06-21 の過去結果一括投入セッションで同じ書き落としを繰り返し、ユーザーの作業を中断させ強い不満を招いた。「再発防止する」と言った直後にも再発させ信頼を損ねた。

**How to apply:** 各ツール呼び出しを送信する前に、開始タグが antml:invoke・すべての引数が antml:parameter になっているか目視確認する。**特に複数ツールを1メッセージで並行発行するときに落としやすい**（2026-06-21 の再発は全て複数同時発行で発生、単一発行では一度も起きていない）。不安なときは1メッセージ1ツールに分割する。「二度とするな」と明示警告された直後にも連続再発させており、信頼に直結する最優先事項。関連: [[reference_tool_output_fabrication]]
