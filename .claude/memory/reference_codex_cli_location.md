---
name: reference_codex_cli_location
description: auto-review-loop の codex CLI 本体は VS Code 拡張内にある（PATH 未登録・~/.codex/.sandbox-bin は古い）
metadata:
  type: reference
---

`/auto-review-loop`（[[project_codex_review_effort]]）が呼ぶ `codex` CLI は、この環境では **PATH に登録されていない**。`which codex` / `Get-Command codex` は失敗する。

- **使うべき本体**: VS Code ChatGPT 拡張に同梱されている `~/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe`。複数バージョンが並ぶことがあるので **最新版**を選ぶ（2026-06-29 時点で `openai.chatgpt-26.623.42026-win32-x64` の **codex-cli 0.142.3**）。
- **使ってはいけない罠**: `~/.codex/.sandbox-bin/codex.exe` は古い alpha（0.119.0-alpha.28）で、`~/.codex/config.toml` の既定モデル `gpt-5.5` に非対応。これで `codex exec` すると `400 invalid_request_error: 'gpt-5.5' model requires a newer version of Codex` で落ちる。`--version` は答えるので生存確認だけでは見抜けない。
- **発見方法**: `Get-ChildItem $env:USERPROFILE,$env:LOCALAPPDATA -Recurse -Filter codex.exe -Depth 6` で全 codex.exe を列挙し各々 `--version` を確認 → 最も新しいものを使う。bash では `export PATH="<その bin>:$PATH"` してから `codex exec` を実行。
- 認証は `~/.codex/auth.json`（ChatGPT サブスク, `auth_mode=chatgpt`）が既存で OK。
- 拡張更新でパスのバージョン番号は変わるので、固定パスを覚えず**毎回グロブで最新を引く**こと。
