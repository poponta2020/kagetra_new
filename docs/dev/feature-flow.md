# 機能開発フロー：要件と設計の螺旋（define-feature ⇄ design-screen）

要件（ロジック）と設計（視覚）は**順番に並ぶ段階ではなく、互いを生みながら螺旋で深まる2つのレンズ**。`/define-feature` と `/design-screen` はその2レンズの入口で、**行き来して収束させる**。

## 2レンズ・1フォルダ
1つの機能は `docs/features/<slug>/` に**2つの生きた文書**を持ち、相互参照する（**重複させない**）：

| 文書 | スキル | 担当する「何を」 | 高度 |
|---|---|---|---|
| `requirements.md` | `/define-feature` | ロジック・画面遷移・データ・API・DB・ビジネスルール | 振る舞い（言葉） |
| `design-spec.md`（複数画面は `design-spec-<screen>.md`）＋ `design-prototype.patch` | `/design-screen` | レイアウト・コンポーネント・状態・見た目 | 視覚 |

- requirements は**画面レイアウトを言葉で再記述しない**（design-spec を参照）。
- design-spec は**ロジックを決めない**（requirements に投げる）。
- **画面インベントリと画面間遷移（ナビゲーション地図）は requirements が持つ**（多画面でもスケール）。

> **design-screen の実体（2026-07-12〜）**: Claude Design へのモック push ではなく、**使い捨て worktree（`C:/tmp/design-live`・ブランチ `design/<slug>`）で実コードを直接編集し、Claude Code の Browser プレビュー（launch.json `design-live`・port 3100）で実物を見ながら調整するライブプロトタイピング**。確定時に design-spec.md（意図・状態・データ要件）と design-prototype.patch（実差分＝レイアウトの正）を出力し、productionize（実データ配線・DESIGN-PROTO スタブ除去・テスト）は /implement が行う。プロトタイプ worktree からの push・PR は禁止。Claude Design（DesignSync）は実機閲覧・アーカイブ用の任意フォールバックに格下げ。

## 宿題で投げ合う（行き来の実体）
片方のレンズで解けない論点は、相手レンズへ**宿題**として渡す：
- design-spec に `## 要件への宿題（→ /define-feature <slug>）`
- requirements に `## デザインへの宿題（→ /design-screen <slug>）`

例：「戦績詳細で相手名タップ→その選手の戦績へ」は design 中に出た emergent logic →「要件への宿題」→ define-feature で遷移/データ/同名処理を確定 → design-screen でリンク affordance を詰める → …

## 螺旋の回し方
1. **中心（center of gravity）から始める**：UI 駆動なら design-screen 起点／ロジック駆動なら define-feature 起点。
2. 各レンズは**完成を待たず**、宿題を投げ合って交互に深める。**文書は作り直しでなく追記**（戻っても無駄にならない）。
3. **収束ゲート**：両文書が `status: locked`＋互いの宿題ゼロ＋**薄い implementation-plan**（テスト先行のタスク／対象ファイル／影響範囲）→ `/implement`。

## 片レンズに自然に縮む
- **視覚だけ**（新ロジック皆無）→ design-screen のみ（確定時に薄い implementation-plan も生成）→ implement（define-feature 不要＝design-spec + patch が要件成果物）
- **ロジックだけ**（UIなし。cron/API 等）→ define-feature のみ → implement
- **両方** → 螺旋

## 新規作成 / 既存改修（どちらも同じ仕組み）
| | 新画面作成 | 既存画面の改修 |
|---|---|---|
| 起点 | ロジック寄り→define-feature／UI 寄り→design-screen | たいてい design-screen（UI 駆動） |
| requirements | greenfield（ストーリー/データ/API/DB/migration） | delta（既存挙動を参照し差分だけ） |
| design-spec | 画面ごとに分割可 | 1枚（現状=before を起点に） |
| 現状把握 | 近い既存画面を参照し worktree にスタブルートで試作 | 対象画面を design worktree で直接編集 |

現状把握の出し分けは design-screen の Step1 が、greenfield/delta は define-feature が、それぞれ内部で吸収する。連結（同居・宿題・収束ゲート）は新規/改修で同一。

## オーケストレーション設計方針（Skills / Subagents / Workflows）

**このフロー全体の骨格はスキルのまま維持する。エージェント連鎖に置き換えない。** 2026-07-01 に公式一次資料（下記出典）で再確認した結論：

- **Skills = オーケストレーションの骨格**（main会話で可視・逐次介入・手続き）。公式ブログ *"Use a skill when you want the procedure to play out inside the main thread so you can see and steer each step"* / *"deploy workflows, release checklists, or review processes belong in a skill"*。`define-feature → design-screen → implement → prepare-pr → auto-review-loop → ship` は**多段・文脈共有・side-effctあり**＝全部 main会話（スキル）側が公式解。
- **Subagents = 葉ステップの隔離委譲**のみ。サブは *fresh context で会話履歴を見ない* ため、連鎖に置き換えると各ホップで蓄積文脈が切れる（＝劣化）。**置き換えではなく、スキルの中の read-heavy 調査ステップと客観レビューだけをサブに逃がす。**
- **Workflows = 規模もの専用**（多数エージェントの決定的オーケストレーション。過去データ一括移行・全コーパス監査・多観点並列レビュー）。1機能の実装フローには過剰。

### ステップ→機構の対応

| ステップ | 機構 | 理由 |
|---|---|---|
| define-feature / design-screen / make-plan | スキル（main） | 文脈共有・逐次介入・宿題往復 |
| **スキーマ/既存コードの事前調査** | **`context: fork` + `agent: Explore`** でスキルから委譲（**`model: haiku` を明示**） | 冗長な読み取り出力を隔離（サブ本来の得意）。要約だけ main に返る。指定なしだと main と同モデル価格で走る |
| implement（オーケストレーション） | スキル（main）**forkしない** | タスク選択・委譲判定・受け入れ確認・コミットは蓄積文脈が必須。`context: fork` はタスク自己完結スキル限定（公式警告） |
| **仕様確定済みの単一実装タスク** | **`task-implementer`（Sonnet）へ Agent 委譲** | 4条件（仕様完全・設計判断なし・検証手段あり・高リスク領域なし）を満たす場合のみ。仕様は全文添付・迷ったら停止 |
| レビュー | Codex（auto-review-loop）に一本化 | Sonnet 前段セルフレビューは不採用（2026-07-04 ユーザー判断: Codex で充足・Claude 使用量を割かない） |
| prepare-pr / ship（side-effect） | スキル＋`disable-model-invocation: true` | 手動トリガー必須。「Claudeが勝手に deploy しない」公式パターン |

**スキルがエージェントを呼ぶ = `context: fork`（＋逆方向はサブの `skills:` フィールドで知識先読み）が公式機構。** カスタムエージェント方針は [proposed-agents.md](proposed-agents.md) を参照（code-reviewer-jp は不採用・`task-implementer` を採用、経緯は同ファイルの 2026-07-04 追記）。

### モデル階層（葉ステップに割り当てるモデル）

サブ委譲する葉には**下位モデルを明示指定**する（指定なしだと main と同モデル＝Fable/Opus 価格で走る。内蔵 `Explore` も v2.1.198+ は main 継承・Opus 上限）：調査・探索= `Explore` + `model: haiku` ／ 仕様確定済みの単一実装タスク= `task-implementer`（Sonnet, `.claude/agents/`）／ 判断・計画・裁定・本番操作= main（Fable/Opus）のまま。委譲可否の4条件・委譲の作法・価格は [model-delegation.md](model-delegation.md) が正典。

出典: [Skills 公式ドキュメント](https://code.claude.com/docs/en/skills) / [Subagents 公式ドキュメント](https://code.claude.com/docs/en/sub-agents) / [Steering Claude Code（Anthropic公式ブログ）](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more) / [Workflows 公式ドキュメント](https://code.claude.com/docs/en/workflows)

> このフローは `/define-feature`・`/design-screen` の SKILL.md から参照される正典。変更時はこの1ファイルを直す。
