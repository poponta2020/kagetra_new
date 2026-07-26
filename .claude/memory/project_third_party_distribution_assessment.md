---
name: third-party-distribution-assessment
description: 他かるた会への配布可能性調査(2026-07-26)。正典=docs/audits/third-party-club-deployment-assessment.md。公開は履歴なしスナップショット新規リポ一択
metadata:
  type: project
---

# 他かるた会への配布可能性調査(2026-07-26)

**正典**: [docs/audits/third-party-club-deployment-assessment.md](../../docs/audits/third-party-club-deployment-assessment.md)。match-tracker の同名調査(07-25版)と同観点で、並列サブエージェント5系統(起動経路/固有値grep/環境変数/PII監査/デプロイ経路)で実施。

## 結論の骨子

- **配布モデル**: private本体 → エクスポートスクリプトで**履歴なしスナップショットの public 配布リポ** → 各団体 fork-and-deploy。現リポの fork/mirror 公開は不可(下記E)。マルチテナント化は構造的に対象外(organizations 概念なし)。
- **最重要=情報漏洩**: `docs/data-quality/`(実在選手実名の台帳、小中学生含む)と `.claude/memory/` 189ファイル(本番IP・SSH手順・DBパスワード取得コマンド)が **git tracked**。一方、パスワード・APIキーの実値は tracked/untracked/履歴すべてに無いことを実測確認(myappdb.dump は一度も tracked になったことがない)。
- **LINE 依存が match-tracker と逆**: 認証が LINE Login のみで代替なし=LINE無し運用不可。Bot プールは DB 管理・0個でも起動可(30個は運用値でありコード要件ではない)。
- **統計・戦績機能群はデータごと配布不可**: 全国結果16年分+series180 はリポ外・会員限定ソース由来・実名PII。fork は空で壊れないが配布版の初期価値は「イベント+LINE配信+会員管理」に縮む。series マスター(PIIなし)のみ seed 化する余地あり。
- **起動経路は設計上可能だが未検証**: migration 0000-0044 は完備。ただし CI/テストは drizzle-kit push で **db:migrate 経路は本番でしか通っていない**(0031 のコメント自身が明言)。初回管理者は seed-initial-admin.ts で解決済みだが**どの手順書本文にも載っていない**。ルート README 無し・LICENSE 無し。
- **fork の CI が当方本番へ SSH 試行する罠**: ci.yml:119 に `kagetra@new.hokudaicarta.com` 直書き。repository ガード(match-tracker PR#1182 方式)を本体に今入れてよい。
- コード内の団体名直書きは実質1箇所のみ: register/[token]/page.tsx:107「北大かるた会 大会管理アプリ」。

## 未着手の推奨アクション(優先順)

1. エクスポートスクリプト+除外リスト(.claude/, docs/大半, scripts/migration, scripts/diagnostics, worklog, _tour_noedition.txt)
2. LICENSE 選定
3. CI deploy ジョブに repository ガード
4. register ページの団体名外部化
5. 空DB→migrate→seed-initial-admin→LINEログイン の1周検証(=手順書の原稿)
6. packages/shared/.env.example 追加

関連: [[project_kagetra_color_tokens]] ではなく配布系。match-tracker 側の正典= C:\Users\popon\match-tracker\docs\audits\third-party-club-deployment-assessment.md
