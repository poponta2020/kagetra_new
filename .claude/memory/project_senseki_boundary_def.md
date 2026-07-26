---
name: feature-def-senseki-boundary
description: senseki-boundary 要件定義
type: project
---

# senseki-boundary 要件定義（2026-07-27 承認）

統計・戦績ドメイン（統計タブ4セクション・選手検索・戦績詳細・結果取込）を、配布版からファイル単位で物理削除でき・再装着もできる疎結合境界へ再編する改修。正典 = docs/features/senseki-boundary/{requirements,implementation-plan}.md、境界実測 = docs/audits/senseki-boundary-audit.md。

## 主要な設計判断

- **フラグ＋物理削除ハイブリッド**: fork がソース改変できる前提でフラグ休眠のみ不採用（ユーザー明示要望）。フラグは削除後のビルド整合のためだけ
- **capability フラグ = 定数モジュール** apps/web/src/lib/capabilities.ts の `SENSEKI_ENABLED: boolean = true`（型注釈必須・葉モジュール）。env でなく定数＝fork の env 設定忘れ事故を構造的に排除。配布時に false 版へファイル置換
- **junction + stub 置換**: 残すページ内の統計同居3箇所（series 一覧/詳細・mail/[id]）は junction ファイル経由の static import にし、配布時に stub へ cp 置換。export 面はプリミティブ props＋自己 fetch RSC に限定（stub が削除対象の型に依存しない）
- **(senseki) route group**: 削除対象ルートを URL 不変で移設し layout 1箇所の notFound() で一括ガード。dual segment（tournaments 等が2グループに並存）は URL 非重複なら合法（deep-advisor 実測確認）。将来 (app)/admin/layout.tsx を作ると (senseki) 側に効かない罠をコメントで固定
- **mail-worker のパーサも削除対象**: reader.ts→excel-reader.ts・normalizePlayerName→name-normalize.ts の中立化＋index.ts の result_parse ディスパッチを junction 化（stub は throw、既存 catch→markJobFailed が拾う）で src/result-import ごと削除可能に
- **「大会」タブ化**: フラグ OFF では統計タブの代わりに「大会」タブ→series 一覧（kept 化・検索は TournamentsHeader から切り出し）→詳細=当落線。当落線の導線を一般会員にも確保
- **欠損警告は受容**: 配布版の当落線出場回数は確定名簿ベースのみ・missing_actual_result 非発火。ドキュメント明記で代替
- スキーマ・migration 完全不変（AC-10）。検証 = scripts/dist/senseki-manifest.json＋check-senseki-boundary.sh（git worktree 方式。cp -r は pnpm symlink で不可）

## AC 要約
AC-1〜AC-10 全10件・全て auto-test。核は AC-1（本体完全回帰）・AC-7（マニフェスト全削除＋フラグOFFで build/test 成功=疎結合の機械証明）・AC-8（残す側→削除対象 import 0件）

## Issue / タスク構成
親 #368 / 子: T1=#369 フラグ+ボトムナビ → T2=#370 共有コード中立化・T3=#371 series kept化・T4=#372 mail-inbox分割（Wave2 3並行） → T5=#373 route group移設 → T6=#374 マニフェスト+検証・T7=#375 OFFテスト+docs（Wave4 2並行）

## 申し送り
- T4 は entry-groups 実装と mail-inbox 領域で排他（senseki-boundary を先に出荷する前提）
- 配布可能性調査全体は [[third-party-distribution-assessment]]
