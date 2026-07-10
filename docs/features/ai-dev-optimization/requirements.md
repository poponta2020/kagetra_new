---
status: completed
design_required: false
approved: 2026-07-10
parent: poponta2020/match-tracker docs/features/ai-dev-optimization/requirements.md
---
# AI開発最適化 — kagetra-new 適用（ブロックK）要件定義書

3リポジトリ横断機能「AI開発最適化」（親: match-tracker [#1010](https://github.com/poponta2020/match-tracker/issues/1010)）の kagetra-new ブロック。
親要件定義書: `C:\Users\popon\match-tracker\docs\features\ai-dev-optimization\requirements.md`（GitHub: poponta2020/match-tracker main の同パス）。承認済み（2026-07-10）のため**再ヒアリング・再承認は不要**。
ブロックP（devflow プラグイン v0.5.0: gate-dod D2・docs レジストリ対応スキル）とブロックR（match-tracker のドメイン分割）は**出荷済み**。match-tracker main の docs/ 構造（ハブ+spec/+design/）が完成形の手本。

## 1. 概要

- **目的**: 改修時に AI がリポジトリ全体を探索するムダをなくし、docs を起点に改修箇所へ直行できるようにする。kagetra-new には全体仕様書が存在しないため、最初からドメイン分割形式でフル新規作成する
- **実行前提**: kagetra セッションで `/implement ai-dev-optimization` を起動

## 2. 機能要件

- K1: CLAUDE.md の stale 修正 — 本番環境「AWS Lightsail」→「Oracle Cloud（東京 / new.hokudaicarta.com）」、「apps/api は現状スケルトン（4ファイル）。API 実処理は apps/web/src/app/api/（BFF）にある」の明記
- K2: apps/web/_*.mts 診断スクリプト（約105本・未追跡・grep汚染源）を scripts/diagnostics/ へ一括移動し .gitignore に `scripts/diagnostics/` を追加。「使い捨て診断スクリプトは scripts/diagnostics/ に作る（apps/ 直下禁止）」を CLAUDE.md と profile §conventions に明記
- K3: apps/web/CLAUDE.md 新設（App Router 構成・lib/ モジュール・components 規約。50行以下・遅延読み込み前提）
- K4: .claude/memory/ の実ファイルと MEMORY.md 索引の差分解消（調査時点: 実130 vs 索引113）
- K5: 全体仕様書のフル新規作成 — ハブ docs/SPECIFICATION.md（≤200行）+ docs/spec/<ドメイン>.md（各≤500行）+ docs/design/db.md（packages/shared の Drizzle スキーマから生成）。コードベースのリバースエンジニアリングで作成し、以後は出荷時 in-place 更新の規律に乗せる
- K6: docs/features/INDEX.md 新設（既存28スラッグ+本件。末尾追記型の行独立リスト、match-tracker の docs/features/INDEX.md と同形式）
- K7: .claude/project-profile.md §docs のレジストリ化（下記 §5 の形式）

## 3. Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-K1 | CLAUDE.md に「Lightsail」が存在せず、Oracle Cloud と BFF（apps/api スケルトン）注記がある | auto-test |
| AC-K2 | apps/web 直下に _*.mts が0本。移動先に格納され、生成先ルールが CLAUDE.md/profile に記載 | auto-test |
| AC-K3 | apps/web/CLAUDE.md が存在し50行以下 | auto-test |
| AC-K4 | .claude/memory/ の実ファイルと MEMORY.md 索引の差分が0 | auto-test |
| AC-K5 | 全体仕様書（ハブ≤200行 + docs/spec/<ドメイン>.md 各≤500行 + docs/design/db.md）が存在 | auto-test |
| AC-K6 | 主要3ドメイン（結果取込・イベント出欠・選手管理）の仕様記述がコードの実挙動と一致することをレビューで確認 | manual |
| AC-K7 | docs/features/INDEX.md が全スラッグを網羅 | auto-test |
| AC-K8 | profile §docs がレジストリ仕様（対応表・更新手順・書き込み規律・devflow:docs パスパターン）を満たす | manual |

## 4. Non-goals

- apps/api（Hono スケルトン）の実装方針変更
- docs 以外のリファクタリング（K2 のスクリプト移動を除く）
- CI でのドキュメントドリフト検出／llms.txt／コードマップ自動生成
- data-quality 作業（docs/data-quality/）の再編・移動

## 5. 技術的制約・契約

- **ドメイン分割の規律**（match-tracker と同一）: ハブ≤200行（ドメイン名+1行責務+リンクのみ・行番号なし）／ドメインファイル各100〜500行・冒頭に定型メタブロック（責務1行・関連画面(ルート)・主要実装パス）／1事実1ファイル（SSOT）／見出しに連番を付けない／実装参照はファイルパス粒度（行番号禁止）／長いコード断片のコピー禁止（Drizzle スキーマからの型・制約の転記は可）／本文への changelog 追記禁止（履歴は docs/features/ と git）
- **ドメイン区分けの候補**（技術計画で確定）: events-attendance（イベント・出欠・アーカイブ）／tournaments-results（大会・結果取込 result-import）／players（選手・自己同定）／stats（成績 senseki）／schedule／auth-admin（認証・招待・LINE連携・管理）／mail-worker（メール取込・AI振り分け）／notifications（LINE broadcast）。App Router 構造と docs/features/ 28スラッグから過不足を確認して確定する
- **profile §docs レジストリの形式**（プラグイン v0.5.0 の README 準拠）: 事実タイプ→正典ファイル対応表／更新手順／書き込み規律／gate-dod D2 用パスパターン:
  ```sh
  DEVFLOW_SRC_PATTERNS=("apps/web/src/" "apps/mail-worker/src/" "packages/shared/src/")
  DEVFLOW_DOCS_PATTERNS=("docs/" "CLAUDE.md" "apps/web/CLAUDE.md")
  ```
- **Issue**: 対応 Issue は match-tracker 側の [#1017](https://github.com/poponta2020/match-tracker/issues/1017)・[#1018](https://github.com/poponta2020/match-tracker/issues/1018)。**cross-repo のため closing keyword では閉じない** — kagetra PR マージ後に手動クローズし、親 #1010 もその時点で全タスク完了としてクローズする
- **手本**: match-tracker main の docs/SPECIFICATION.md（ハブ）・docs/spec/players-auth.md 等（メタブロック・節構成）・.claude/project-profile.md §docs（レジストリ）・docs/features/INDEX.md（形式）
- K5 のリバースエンジニアリングは task-implementer サブエージェントのドメイン並列委譲を推奨（match-tracker ブロックRで実績のある方式）。db.md は packages/shared/src/schema/ の Drizzle 定義が正（本番 introspect は不要 — スキーマがコードで管理されているため）

## 6. 設計判断の根拠

親要件定義書 §7 を参照（読み方ガイドではなくドメイン分割を採用した理由・OpenSpec 二層モデル・見出し連番の廃止・kagetra 仕様書フル作成の判断はすべて承認済み）。
