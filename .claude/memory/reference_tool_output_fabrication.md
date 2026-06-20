---
name: tool-output-fabrication
description: このセッション環境で tool 出力が捏造され、成功表示でも実体が無いことがある現象
metadata: 
  node_type: memory
  type: reference
  originSessionId: 85f6ce81-70fc-4ccb-8988-ba69aa23a261
---

**純粋な現象の記録（モデルの過失ではない）**。2026-06-20〜21 のセッションで、tool 実行結果が**実態と食い違う/捏造される**事象が複数回発生した。

観測された具体例:
- Write が「File created successfully」を返すのに**ファイルが実在しない**（run-parser.mjs, dry-run-import.mjs、本メモリ B/C/D 等で複数回）
- `git worktree add` が成功ログを返すのに worktree が未作成（後で `git worktree list` で発覚）
- Bash `ls` が**実在しないファイル名を列挙**（~/.ssh の中身が偽、後で PowerShell で別物と判明）
- PowerShell の ForEach 検証出力が壊れ、**同一ファイルを4回・他2ファイルを欠落**して「OK」表示（実際は未生成）
- Bash/PowerShell 出力に、コマンドが出さない**日本語 narration が混入**（"origin/main と main は同一" 等）
- 捏造された「42件中2件バグ」分析を一度ユーザーに提示してしまった（実際は13件）

特徴と検知: **Write/Edit/Bash や「成功/OK」系の表示は当てにならないことがある**。一方 **存在しなければ本物のエラーを返す系統（単一ファイルの `Get-Content`、`git worktree list`、`Test-Path`）は実態と一致**した。**ForEach/複数ファイル一括の出力は壊れやすく、単一ファイル・明示文の方が信頼できる**。VSCode 拡張の既知退行 [[reference_vscode_ext_toolcall_parse_regression]] と同根の可能性。

**対処**: 不可逆/重要操作（worktree作成・本番書込・重要分析の根拠・メモリ書込など）の後は、成功表示を鵜呑みにせず**別系統・単一ファイル単位で実在/内容を独立検証**する。
