# モデル階層委譲（Model Delegation）

> main 会話（Fable/Opus）をオーケストレーターとして維持し、委譲可能な葉ステップだけを下位モデル（Sonnet/Haiku）のサブエージェントへ流すための正典。フロー骨格の設計は [feature-flow.md](feature-flow.md)、カスタムエージェント方針の経緯は [proposed-agents.md](proposed-agents.md)。2026-07-04 の Web 調査（公式ドキュメント＋実践知見）に基づく。

## 原則

1. **main のモデルは切り替えない。** プロンプトキャッシュはモデル別なので、mainを途中で安いモデルに切り替えると全履歴を非キャッシュで読み直す。「main は Fable/Opus 固定・安い作業はサブエージェントへ切り出す」が公式推奨の形
2. **判断は上・作業は下。** 要件定義・設計判断・計画・裁定・本番操作は main。仕様が確定した作業だけを下位へ
3. **モデルは常に明示指定。** 指定なしのサブエージェントは main と同モデル（=Fable 価格）で走る。**内蔵 `Explore` も v2.1.198 以降は main 継承（Opus 上限）** で、勝手に Haiku にはならない。Agent tool 呼び出し時に `model` を必ず渡す

## ルーティング表

| 層 | モデル | 対象タスク | 機構 |
|---|---|---|---|
| スカウト | Haiku（$1/$5） | read-heavy な探索: 関連ファイル特定・既存パターン収集・grep 系調査・ログ/テスト出力の要約 | Agent tool: `subagent_type: Explore` + **`model: haiku`**（スキーマ調査など精度が要る調査のみ `model: sonnet` に上げる） |
| ワーカー | Sonnet（$3/$15） | 実装手順書で完全仕様化された単一実装タスク、仕様確定済みのテスト作成 | Agent tool: `subagent_type: task-implementer`（`.claude/agents/`、model: sonnet / effort: high 埋め込み済み） |
| オーケストレーター | Fable/Opus（main） | 要件定義・設計判断・計画、曖昧なデバッグ、跨層リファクタ、schema/migration、認証認可、委譲結果の受け入れ確認、コミット/PR/ship、本番操作 | main 会話（スキル骨格） |

**レビューは従来どおり Codex（auto-review-loop）が担う。** Sonnet による前段セルフレビュー（code-reviewer-jp 案）は 2026-07-04 に不採用と決定：Codex レビューで充足しており Claude 使用量を割かない・Sonnet レビューの効果に疑義（ユーザー判断）。

## 委譲可否の判定（4条件すべて満たす場合のみ委譲）

1. **仕様完全性**: 要件定義書＋実装手順書でタスクが完全に記述されている（変更対象ファイル・完了条件が明確）
2. **設計判断の余地なし**: API の形・データモデル・UI 挙動の解釈が確定済み
3. **検証手段あり**: テスト・型チェック・CI で失敗を機械的に検知できる
4. **高リスク領域を含まない**: schema 変更/migration・認証認可の新設・本番操作を含まない

1つでも欠けたら main が直接実装する。迷ったら main。

## 委譲の作法（実践知見の失敗3パターンへの対策）

| 失敗パターン（Web調査で一致） | この運用での対策 |
|---|---|
| 仕様不足の丸投げ → ワーカーが「もっともらしい推測」で誤った方向へ | タスク仕様は**要約せず全文**をプロンプトに貼る。task-implementer には「迷ったら停止して報告」規約を埋め込み済み（自分で判断させない） |
| ワーカーの effort 不足で品質劣化／xhigh に上げて価格差消滅 | task-implementer は effort: high 固定（xhigh にしない。Sonnet を xhigh に上げると Opus との価格差がほぼ消える実測報告あり） |
| 能力ミスマッチが「成功」の顔で静かに通る | 委譲後に main が必ず `git diff` をレビューし検証コマンドを自分でも再実行してからコミット。後段に CI + Codex レビュー（auto-review-loop）の網 |

エスカレーション: ワーカーが停止報告を返したら、その論点は main が引き取って判断・実装する。同じタスクを下位モデルに再委譲してリトライしない。

## 運用ルール

- **小径修正は委譲しない**（目安: 数ファイル・数十行以下）。サブエージェント起動と文脈再構築のオーバーヘッドの方が高くつく。`/quickfix` の修正実装が main 直なのはこのため
- **ワーカーの並列実行は worktree を分ける**。同一 worktree では1タスクずつ直列（/implement は元々直列ループ）。並列してよいのは read-only のスカウトのみ
- **スカウトの要約は「どこを見るべきかの地図」として使う**。設計判断の根拠になる核心ファイルは main が自分で読んで裏取りする（Haiku の見落としを設計に持ち込まない）
- **general-purpose 等の他サブエージェントも、タスクが単純なら `model` を下げて呼ぶ**（無指定 = main と同じ Fable 価格で走る）
- **テストファーストを brief で担保**: 実装手順書にテストが無いタスクを委譲するときは、main がテスト要件を決めて brief に含める（ワーカーは仕様外のことをしない規約のため、書かなければテストは生まれない）
- **品質フィードバックループ**: 受け入れ確認 NG が同種タスクで2回続いたら、その種別を委譲対象から外して本ドキュメントを更新する。claude-mem 記録には「どのワーカー（モデル）が実装したか」を含め、後から監査できるようにする（静かな能力ミスマッチ対策）

### 各スキルの委譲対応（配線状況）

| スキル | 委譲 |
|---|---|
| /implement | Step 7 で4条件判定 → task-implementer（配線済み） |
| /do-plan | claude-mem:do への指示文に【モデル委譲】ブロックを伝搬（配線済み） |
| /quickfix | 調査のみ Explore(haiku)。修正実装は小径のため main 直（配線済み） |
| /define-feature | Step 2 の調査のみ Explore(haiku/sonnet)。要件・技術設計は main（配線済み） |
| /fix（レビュー指摘修正） | main 直。Codex 指摘の文脈が濃く小径のため委譲しない |
| /bug-report | 原因調査は Explore(haiku) 可。修正は quickfix に準ずる |
| /fix-feature | define-feature / implement に準ずる |
| /design-screen・/prepare-pr・/ship・/auto-review-loop | 委譲なし（視覚判断・side-effect・レビュー裁定は main） |

## 価格メモ（2026-07-04 時点, per MTok 入力/出力）

| モデル | 価格 | 対 Fable 比 |
|---|---|---|
| Fable 5 | $10 / $50 | 1x |
| Opus 4.8 | $5 / $25 | 1/2 |
| Sonnet 5 | $3 / $15（2026-08-31 までイントロ $2 / $10） | 約 1/3（イントロ 1/5） |
| Haiku 4.5 | $1 / $5 | 1/10 |

価格差に加えて、サブエージェント隔離により冗長な読み取り出力が main コンテキストに乗らない分の入力トークン節約が**毎ターン**効く（main の履歴は以後の全ターンで再送されるため）。

## 根拠（調査ソース抜粋）

- 公式: [Subagents doc](https://code.claude.com/docs/en/sub-agents)（`model:` frontmatter／「Control costs by routing tasks to cheaper models」／Explore の main 継承と `model: haiku` 上書き推奨）、[model-config doc](https://code.claude.com/docs/en/model-config)（opusplan・モデル切替のキャッシュ無効化）、[multi-agent research system blog](https://www.anthropic.com/engineering/multi-agent-research-system)（Opus リード + Sonnet ワーカーで単体 Opus 比 +90.2%／マルチエージェントはチャット比 ~15x トークン＝価値あるタスク限定）
- 実践: opusplan 系記事（well-specified plan なら Sonnet 実行で品質維持・セッショントークンの約8割が実行フェーズ）、HN 実務者スレ（曖昧なデバッグ・跨層回帰は Sonnet が取りこぼす）、テレメトリ分析（下位モデルへの静かな過負荷＝監査の必要性）

> このドキュメントは `/implement`・`/quickfix`・`/define-feature` の SKILL.md および feature-flow.md から参照される正典。ルーティングを変えるときはこの1ファイルを直す。
