---
name: third-party-distribution-assessment
description: 他かるた会への配布可能性調査(2026-07-26)。正典=docs/audits/third-party-club-deployment-assessment.md。公開は履歴なしスナップショット新規リポ一択。統計・戦績はフラグ+物理削除で切り離し決定
metadata:
  type: project
---

# 他かるた会への配布可能性調査(2026-07-26)

**正典**: [docs/audits/third-party-club-deployment-assessment.md](../../docs/audits/third-party-club-deployment-assessment.md)。match-tracker の同名調査(07-25版)と同観点で、並列サブエージェント5系統(起動経路/固有値grep/環境変数/PII監査/デプロイ経路)で実施。

## 結論の骨子

- **配布モデル**: private本体 → エクスポートスクリプトで**履歴なしスナップショットの public 配布リポ** → 各団体 fork-and-deploy。現リポの fork/mirror 公開は不可(下記)。マルチテナント化は構造的に対象外(organizations 概念なし)。
- **最重要=情報漏洩**: `docs/data-quality/`(実在選手実名の台帳、小中学生含む)と `.claude/memory/` 189ファイル(本番IP・SSH手順・DBパスワード取得コマンド)が **git tracked**。一方、パスワード・APIキーの実値は tracked/untracked/履歴すべてに無いことを実測確認(myappdb.dump は一度も tracked になったことがない)。
- **LINE 依存が match-tracker と逆**: 認証が LINE Login のみで代替なし=LINE無し運用不可。Bot プールは DB 管理・0個でも起動可(30個は運用値でありコード要件ではない)。
- **起動経路は設計上可能だが未検証**: migration 0000-0044 は完備。ただし CI/テストは drizzle-kit push で **db:migrate 経路は本番でしか通っていない**(0031 のコメント自身が明言)。初回管理者は seed-initial-admin.ts で解決済みだが**どの手順書本文にも載っていない**。ルート README 無し・LICENSE 無し。
- **fork の CI が当方本番へ SSH 試行する罠**: ci.yml:119 に `kagetra@new.hokudaicarta.com` 直書き。repository ガード(match-tracker PR#1182 方式)を本体に今入れてよい。
- コード内の団体名直書きは実質1箇所のみ: register/[token]/page.tsx:107「北大かるた会 大会管理アプリ」。

## 統計・戦績切り離しの決定(2026-07-26、ユーザー確定)

元データは協会公開だが「ここまでの品質の集約は他に無く、無断情報公開との批判は必至」→ **配布版からドメインごと切り離す**。データ漏洩ではなく「同じ集計を誰でも再現できる装置の公開」問題という整理。

- **範囲**: 統計タブ4セクション・選手検索・戦績詳細・**結果取込**(出口が無くなるため一体で切る)。**当落線・抽選倍率は残す**(原データ=名簿+抽選実績で fork 自前蓄積可・批判リスクの性質が違う)。スキーマは共通のまま(migration 分岐禁止)。
- **方式**: フラグ+物理削除ハイブリッド(本体に capability フラグ、配布リポ生成時に物理削除)。フラグ休眠のみは fork が1設定で復活できるため不採用。
- **疎結合化(ユーザー追加要望)**: 後から再装着できる境界リファクタ(senseki-boundary)を本体で先行実施する方針。**境界監査済・正典=docs/audits/senseki-boundary-audit.md**。混線は5点のみ(bottom-nav 1エントリ / series/[id]の lottery 同居→系列名クエリ1本移設で分離可 / lib/players/member-link.ts は roster-import が依存→中立モジュール移設必須 / mail-inbox actions.ts の結果系4関数≈355行 / mail/[id]/page.tsx のセクション除去)。(senseki) route group で URL 不変移設可。
- **未決論点**: result-import 削除で editions の 'held' 遷移経路が消える→配布版当落線は名簿ベース集計のみ・missing_actual_result 警告が発火しない。senseki-boundary の要件定義時に受容 or 注記表示を確定(監査 §5)。
- **実装は未着手**(ルール1: /define-feature 改修モード→承認→実装GO 待ち)。

## 未着手の推奨アクション(優先順、正典F章)

1. CI deploy repository ガード
2. senseki-boundary リファクタ(フラグ+混線5点切断+route group 化)
3. register ページの団体名外部化
4. エクスポートスクリプト+除外リスト(戦績ドメイン物理削除面を含む)
5. LICENSE 選定
6. 空DB→migrate→seed-initial-admin→LINEログイン の1周検証(=手順書の原稿)
7. packages/shared/.env.example 追加

match-tracker 側の正典= C:\Users\popon\match-tracker\docs\audits\third-party-club-deployment-assessment.md
