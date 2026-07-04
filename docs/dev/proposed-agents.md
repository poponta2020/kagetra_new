# カスタムサブエージェント 再評価（2026-07-01 改訂）

> **改訂の要旨**: 当初「有効なカスタムエージェント7種」を提案していたが、Claude Code 公式ドキュメント・Anthropic 公式ブログ・複数の実務家記事（一次資料と複数の一致意見）を 2026-07-01 に再調査した結果、**7つ全部を作るのは "sprawling roster" アンチパターン**だと判明。結論を反転する。旧提案（7種一括作成）は本ファイル末尾に「旧案」として保存。

> **2026-07-04 追記（モデル階層委譲の導入）**: `code-reviewer-jp` は**不採用が確定**（レビューは Codex/auto-review-loop で充足しており Claude 使用量を割かない・Sonnet レビューの効果に疑義。ユーザー判断）。代わりに well-specified タスク実行用の `task-implementer`（Sonnet, `.claude/agents/`）を作成した。これは生成系 per-layer 専門エージェントの復活ではなく**モデル階層ルーティングのワーカー**（委譲4条件・main による diff 受け入れ確認つき）。正典= [model-delegation.md](model-delegation.md)。

---

## 結論

**7つ全部は作らない。**

- サブエージェントとして**正しい形なのは実質 1〜2 つ**（`code-reviewer-jp`、条件付きで `drizzle-scout`）
- **生成系4案（test-scaffold / action-forge / zod-syncer / hono-builder）は Skill にすべき**（公式が生成・ボイラープレートは Skill と明言）
- `migration-guard` は **Hook もしくは明示実行 Skill** 寄り（安全ゲートを自動委譲に依存させない）
- 目玉の「コスト削減 1/15」は**エージェントを作らなくても設定で無料で回収できる**可能性が高い

---

## ゴールデンスタンダード（複数の一次資料が一致）

1. **少数精鋭。乱立は自動委譲を壊す** — 公式ブログ: *"Most teams settle on a handful of well-scoped agents rather than a sprawling roster."* solo プロジェクトで7つは乱立側。
2. **自動委譲（description トリガー）は当てにならない** — 確実なトリガーは @-mention / `--agent` の明示呼び出しのみ。「description を作り込めば勝手にコスト削減が効く」という旧前提は崩れる。
3. **サブが本当に強いのは「読む・調べる・レビューする」** — research / parallel investigation / objective review / verbose output の隔離。実装はメイン文脈。
4. **生成・ボイラープレートは Skill が正解（公式の判断枠組み）** — 公式ドキュメント: *"Consider Skills instead when you want reusable prompts or workflows that run in the main conversation context rather than isolated subagent context."* 生成コードは結局メインに戻すため、隔離という最大利点が効かない。
5. **生成系サブは「メインからコンテキストを隠す」害がある** — Shrivu Shankar: *"If I make a `PythonTests` subagent, I've now hidden all testing context from my main agent."* 生成系カスタムエージェントを "brittle solution" と評価。

---

## 7案の再評価

| 案 | サブとして正しい形か | 判定 | 理由 |
|---|---|---|---|
| **drizzle-scout** | ○ 読み取り調査・Haiku・要約返し | **△ 条件付き可** | 形は正解だが**内蔵 Explore とほぼ重複**（Explore は既定 Haiku・読み取り専用・コードベース探索）。付加価値はスキーマ知識の埋め込みのみ |
| **migration-guard** | △ 「毎回必ず走らせたい安全ゲート」 | **✕ → Hook/Skill 化** | 安全チェックを**不安定な自動委譲に依存させない**。"no matter what" 系は Hook、明示実行なら Skill |
| **code-reviewer-jp** | ◎ 白紙文脈での客観レビュー | **○ 唯一の本命** | 公式ドキュメント筆頭サンプルが正にこれ。ただし既存 Codex/auto-review-loop と重複するので「Codex 前段の安価パス」として割り切る |
| **test-scaffold** | ✕ コード生成 | **✕ → Skill 化** | 生成物はメインに戻す＝隔離利点なし＋文脈隠しの害 |
| **action-forge** | ✕ コード生成 | **✕ → Skill/CLAUDE.md** | 定型パターンは規約として CLAUDE.md か Skill テンプレへ |
| **zod-syncer** | △ 乖離検知は「検査」・同期は「編集」 | **✕ → 検知は型テスト、同期は Skill** | Drizzle↔Zod 乖離は本来**型テスト/lint で検知**すべき。自動編集はメイン文脈作業 |
| **hono-builder** | ✕ コード生成 | **✕ → Skill 化** | 旧提案自身が「既存 nextjs-hono-engineer スキルは0回起動」と記載。**別エージェントを作っても採用率は上がらない**（問題は「生成をサブに出す設計」そのもの） |

---

## 見落としていた重要点

**■ 目玉の「コスト削減 1/15」は無料で直る**
旧提案の「Explore が Opus で25回＝15倍コスト」は、**内蔵 Explore は本来 Haiku 既定**なので設定/バージョン起因の疑いが濃い。公式ドキュメント: *"In earlier versions, `inherit` forced subagents onto the main conversation's model"*、v2.1.196 以降 `CLAUDE_CODE_SUBAGENT_MODEL=inherit` はこの強制をしない。
→ **Claude Code 更新＋`CLAUDE_CODE_SUBAGENT_MODEL` を inherit 強制にしない**だけで Explore は Haiku に戻り、「1/15」は `drizzle-scout` を作らずとも大半回収。`drizzle-scout` の残り価値は「スキーマ知識埋め込み」だけに縮小する。

**■ 未使用の Workflow / 並列レビューこそ伸びしろ**
実測で「9 並列レビューエージェントで actionable 提案 75%（単体は <50%）」。サブが数字で効くのは**レビュー/調査の並列化**であって、生成の自動化ではない。`code-reviewer-jp` を作るなら将来 Workflow で複数観点に fan-out する形が本筋。

**■ このプロジェクトの「本物の自動化」は既に Skill チェーン**
auto-review-loop 45回 / ship 37回 / prepare-pr 26回 が示す通り、**メイン文脈で回る Skill 連鎖が実績ある自動化**。生成系4案を Skill 側に寄せるのは既存の勝ちパターンと整合する（＝公式指針そのもの）。

---

## 推奨アクション（段階的）

公式の起票基準 *"Define a custom subagent when you keep spawning the same kind of worker with the same instructions"* と、公式ブログの *"start with conversational prompts. Notice which requests keep occurring and build automation as those patterns clarify"* に沿う。

1. **まずコスト問題を設定で潰す（無料）**: Claude Code 更新＋`CLAUDE_CODE_SUBAGENT_MODEL` を inherit 強制にしない。Explore が Haiku で回るか確認 → `drizzle-scout` の要否を再判断。
2. **作るなら `code-reviewer-jp` の1つだけ先行**。公式サンプル形に忠実に、read-only・Codex 前段の安価パスとして。効果測定してから増やす。
3. **`test-scaffold` / `action-forge` / `hono-builder` は Skill 化**（または CLAUDE.md 規約）。生成をサブに出さない。
4. **`zod-syncer` は「型テスト（乖離検知）＋ Skill（同期補助）」に分解**。自動編集エージェントにしない。
5. **`migration-guard` は Hook か明示実行 Skill** に。安全ゲートを自動委譲任せにしない。
6. **`drizzle-scout` は保留**。Explore＋CLAUDE.md にスキーマの入口を書いて回し、「同じ調査を繰り返し手で投げている」と実感したら初めて起票。

**要するに「7つ作る」ではなく「1つ作って設定を直し、残りは Skill/Hook/テストへ振り分ける」。**

---

## 参考（一次資料・複数の一致意見）

- [Create custom subagents — Claude Code 公式ドキュメント](https://code.claude.com/docs/en/sub-agents)
- [How and when to use subagents in Claude Code — Anthropic 公式ブログ](https://claude.com/blog/subagents-in-claude-code)
- [How I Use Every Claude Code Feature — Shrivu Shankar](https://blog.sshh.io/p/how-i-use-every-claude-code-feature)
- [Skills vs Hooks vs Subagents vs MCP — Totalum](https://www.totalum.app/blog/claude-code-skills-totalum)
- [Agent Teams vs Sub-Agents — MindStudio](https://www.mindstudio.ai/blog/claude-code-agent-teams-vs-sub-agents)
- [9 Parallel AI Agents That Review My Code — HAMY](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents)
- [Best practices for Claude Code sub-agents — PubNub](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)

---
---

# 【旧案・参考保存】提案済みカスタムサブエージェント7種（2026-07-01 初版）

> 以下は再評価前の初版。上記の結論により **7種一括作成の方針は撤回**。設計の元ネタ・各エージェントに埋め込む知識のメモとして保存する。

## ゴールデンスタンダード前提（初版）

- **3層モデルルーティング**: 読み取り→Haiku (1/15コスト) / 実装→Sonnet (1/3) / 複雑推論→Opus (1x)
- **description が自動委譲トリガー**: キーワード豊富に書く ← ※再評価で「自動委譲は unreliable」と判明
- **ツールは明示ホワイトリスト**: 不要なツールを渡さない
- **メインコンテキストに冗長出力を返さない**: 要約のみ返す
- **isolation: worktree**: ファイル編集する並行エージェントに必須

現状の問題(初版認識): 全サブエージェントが Opus 継承 → Haiku 比で15倍コスト消費中
※再評価: 内蔵 Explore は本来 Haiku 既定。設定/バージョン起因の疑い。

### Agent 1: `drizzle-scout`（→ 再評価: 保留。Explore と重複）

```yaml
---
name: drizzle-scout
description: "Drizzle スキーマ・マイグレーション・relations の調査。新機能でテーブル設計する前、既存の FK/制約/型を確認したいとき、migration 番号の空きを調べたいときに使う。packages/shared/src/schema/ 配下の全ファイルを読んで要求情報を返す。"
model: haiku
tools: Read, Grep, Glob
effort: low
---
```

埋め込む知識: `packages/shared/src/schema/` 全体構造 / マイグレーション採番ルール（最新0037）/ FK循環パターン（tournaments↔result_drafts）/ `relations.ts` の読み方

### Agent 2: `test-scaffold`（→ 再評価: Skill 化）

```yaml
---
name: test-scaffold
description: "Vitest 統合テスト・Playwright E2E テストのスケルトンを生成する。"
model: sonnet
tools: Read, Write, Edit, Grep, Glob
effort: medium
isolation: worktree
---
```

埋め込む知識: `apps/web/src/test-utils/seed.ts` / `auth-mock.ts`（mockAdminSession）/ `playwright-auth.ts` / `vitest.config.mts` / `playwright.config.ts` / 注意: WSL2+Docker で `--no-file-parallelism` 必須

### Agent 3: `action-forge`（→ 再評価: Skill/CLAUDE.md 化）

```yaml
---
name: action-forge
description: "Next.js Server Action（'use server'）のスケルトンを生成する。"
model: sonnet
tools: Read, Write, Edit, Grep, Glob
effort: medium
---
```

埋め込む知識: `apps/web/src/app/(app)/events/[id]/actions.ts`（参照実装）/ `requireAdminSession` 実装 / `revalidatePath` 規約 / 日本語エラーメッセージ統一 / DB delete 前 FK 参照チェック＋FOR UPDATE 必須

### Agent 4: `zod-syncer`（→ 再評価: 検知は型テスト、同期は Skill に分解）

```yaml
---
name: zod-syncer
description: "Drizzle スキーマの変更を検知し、対応する Zod バリデーターを自動更新する。"
model: sonnet
tools: Read, Write, Edit, Grep, Glob
effort: medium
---
```

埋め込む知識（Drizzle→Zod 型マッピング）: `integer()`→`z.number().int()` / `text()`→`z.string()` / `boolean()`→`z.boolean()` / `date()`→`z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` / `pgEnum(...)`→`z.enum([...])` / `notNull()`→必須 / `default()`→`.optional()`。場所: `enums.ts` / `apps/web/src/lib/form-schemas.ts`

### Agent 5: `migration-guard`（→ 再評価: Hook/明示実行 Skill 化）

```yaml
---
name: migration-guard
description: "db:generate 前のスキーマ変更の安全確認。連番チェック、FK 循環検出、NOT NULL 追加時の既存データ影響、インデックス不足の指摘。"
model: haiku
tools: Read, Grep, Glob, Bash
effort: low
---
```

埋め込む知識: `packages/shared/drizzle/` 採番（最新0037）/ FK循環パターン / `db:push` vs `db:migrate`（本番は migrate 必須、push は TTY 要求で CI 死ぬ）/ 並行 worktree 採番衝突検知 / Windows worktree は `C:/tmp/`

### Agent 6: `hono-builder`（→ 再評価: Skill 化）

```yaml
---
name: hono-builder
description: "apps/api の Hono API ルートを実装する。zValidator ミドルウェア、Auth.js セッション確認、Drizzle クエリ、JSON レスポンス構造。"
model: sonnet
tools: Read, Write, Edit, Grep, Glob, Bash
effort: medium
isolation: worktree
---
```

埋め込む知識: `apps/api/src/routes/` 実装パターン / Hono middleware チェーン / Drizzle クエリ / エラーレスポンス規約 / `apps/api/src/index.ts` ルート登録
※初版メモ: 既存 `nextjs-hono-engineer` スキル指定は実際には0回起動。

### Agent 7: `code-reviewer-jp`（→ 再評価: 唯一の本命・先行作成候補）

```yaml
---
name: code-reviewer-jp
description: "このプロジェクト固有のパターンでコードレビューを行う。Auth.js 認証ガード漏れ、Drizzle トランザクション外の状態変更、revalidatePath の抜け、日本語エラーメッセージの不統一、FOR UPDATE ロック欠如を検出。Codex review の前段として素早く検証したいとき、実装完了後のセルフレビューに使う。"
model: sonnet
tools: Read, Grep, Glob, Bash
effort: medium
---
```

埋め込む知識: `requireAdminSession()` が必要な全エンドポイントのパターン / DB delete 前 FK 参照チェック＋FOR UPDATE / `revalidatePath()` が必要なケース / `globalThis` pin（PR#129実害）/ `node:crypto` がクライアントバンドルを破壊（招待登録で実検出）/ 日本語エラーメッセージ統一規約

## 初版・調査で判明した現状の問題点

- Agent tool 実績46回のうち: Explore 25回(Opus) / general-purpose 16回(Opus)
- 専門エージェント（hono/frontend/drizzle/test/security）: 実績2回のみ
- Workflow tool: **0回**（未使用）← 再評価: 並列レビューが本来の伸びしろ
- Haiku使用: **0回**（全部Opus継承）← 再評価: 設定で無料回収可能
- Skill チェーン（auto-review-loop 45回 / ship 37回 / prepare-pr 26回）は本物の自動化
