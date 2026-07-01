---
name: reference_codex_config_service_tier
description: "codex CLI が ~/.codex/config.toml の service_tier=\"default\" で起動時パース失敗→auto-review-loop 全停止。当該行を除去で解消"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 29c73f9c-f141-490d-bdae-ea85fbb6608f
---

`~/.codex/config.toml` に `service_tier = "default"` があると、codex CLI 0.130.0 は起動時に `Error loading config.toml: unknown variant 'default', expected 'fast' or 'flex' in service_tier` でコケ、**codex CLI 全体が無効**になる（`codex exec` が exit 1・結果ファイル未生成）。この値は **Codex Desktop アプリが書き込む**もので、CLI 側の enum は `fast`/`flex` のみ受理する版ズレが原因。

**How to apply:** auto-review-loop / 手動 `codex exec` が「結果ファイルが出ない」「即 exit」したら、まず `~/.codex/config.toml` の `service_tier` 行を確認。`service_tier = "default"` なら**その行を削除**（CLI 既定に戻す）すれば通る。Desktop アプリ再起動で再混入し得るので**再発注意**。`-c service_tier=flex` の CLI override で回避できる可能性もあるが、行削除が確実。

2026-06-30 [[project_invite_register_redesign]] の /auto-review-loop（PR #206）開始時に実害。Codex の medium 既定など他設定は [[project_codex_review_effort]] 参照。
