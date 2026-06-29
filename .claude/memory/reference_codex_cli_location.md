---
name: reference_codex_cli_location
description: codex CLI は npm global で PATH 上にある（2026-06-29 整備）。auto-review-loop はそのまま `codex` で動く
---

`/auto-review-loop`（[[project_codex_review_effort]]）が呼ぶ `codex` CLI は、**2026-06-29 に npm グローバル導入して PATH 上で解決できるようにした**。スキルは `codex exec` をそのまま叩けば動く（フルパス指定は不要）。

- **正しい状態（あるべき姿）**: `npm install -g @openai/codex@latest` で導入。`C:\Users\user\AppData\Roaming\npm\codex(.cmd/.ps1)` に入り、npm global bin は PATH 済み。`codex --version` → `codex-cli 0.142.3`（`@openai/codex` の npm 最新と一致。`gpt-5.5` 対応）。更新は `npm i -g @openai/codex@latest` を再実行するだけ。
- **認証**: `~/.codex/auth.json`（ChatGPT サブスク, `auth_mode=chatgpt`）を共有。VS Code 拡張・CLI で同一。
- **既定モデル**: `~/.codex/config.toml` の `model`/`model_reasoning_effort`（[[project_codex_review_effort]] 参照）。0.142.3 は `gpt-5.5` OK。
- **罠（過去の詰まり）**: `~/.codex/.sandbox-bin/codex.exe` は codex 自身が生成するサンドボックス補助で**古い**（2026-06-29 時点 0.119.0-alpha.28）。`gpt-5.5` 非対応で `400 'gpt-5.5' model requires a newer version of Codex` で落ちる。PATH 整備前はこれしか見つからず詰まった。`--version` は答えるので生存確認だけでは見抜けない。**直接呼ばない**（PATH の `codex` を使えば回避）。
- フォールバック（npm 導入が壊れた等）: VS Code ChatGPT 拡張同梱の `~/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe` の**最新版**を使う（グロブで最新を引く。拡張更新でパスのバージョン番号は変わる）。
