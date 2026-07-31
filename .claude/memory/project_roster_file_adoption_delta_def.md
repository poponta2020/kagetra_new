---
name: feature-def-roster-file-adoption-delta
description: roster-file-adoption 改修 要件定義（級別採用・候補フィルタ・パースUI退役）
type: project
---

roster-file-adoption（PR #409 出荷済み）の改修モード要件定義＋技術計画（2026-08-01 完了）。requirements.md は生きた仕様として上書き済み。実装は /implement roster-file-adoption 待ち。

**変更3本柱**: (1) 採用時に取込単位を選択 — グループ統一（従来。既存行は grades NULL で無変換解釈）／級別（同一グループ内で複数級同時指定可。「A・B級名簿」対応。UNIQUE(source_attachment_id) 維持）。(2) 候補提示規則（§3.2.7 の4象限）— applicant=申込済み∧applicant未取込、confirmed=申込済み∧confirmed未取込（ユーザーの「申込済∧未取込 ∨ 申込名簿済∧確定未取込」は後者に簡約。抽選なし直行ケース対応）。未取込判定はファイル採用のみ（パース済み名簿は見ない）。「すべて表示」トグルが正規の逃げ道（秋田の2ファイル採用パターン・申込マーク忘れ）→ Server Action はフィルタを強制しない。(3) パース取込UI退役 — メール詳細「大会名簿の取込」セクション非表示。コード・テーブル・roster-drafts ページは全温存（将来AI取込の土台。直URLは生きる）。

**ユーザー判断**: 級別が一部済みでも全級カバーまで統一候補に残す／トグル方式採用／パースは「UI導線だけ消す・機能温存」。

**技術設計（deep-advisor 検証済み）**: grades grade[] nullable 列追加（junction 棄却。migration 0053・enum array の ADD COLUMN は生成SQL要目視）。候補データはサーバー集約（表示名は deriveEntryGroupName+代表fallback をサーバーで文字列化）→ client 純関数 roster-adopt-utils.ts（leaf・DB値import厳禁）。advisor 指摘の穴4つ: 基本条件（個人戦∧非cancelled∧cutoff）は同一event行のANDで評価／grades 冒頭検証（空配列は明示エラー=級未選択バグを統一採用として通さない）／級⊆G(g) は cutoff 非依存／entryGroupId 直指定化で FK violation(23503) を日本語化（deleteGroupIfEmpty との競合）。

**AC**: 22件（auto-test 21 / manual 1=本番実機）。回帰AC: ボード classify・hasConfirmedRoster 定義（パース∪ファイル・級別行も1行）・ビューア3経路・既存採用データ表示の不変。

**Issue**: 親 #433 / 子 #434(スキーマ) #435(純関数) #436(action) #437(メール詳細UI+パース退役) #438(大会詳細ラベル)。Wave1=#434 → Wave2=#435/#436/#438 並行 → Wave3=#437。
