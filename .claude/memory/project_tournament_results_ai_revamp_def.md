---
name: feature-def-tournament-results-ai-revamp
description: tournament-results 改修（AI取込+突合・部分承認・差し替え）要件定義
type: project
---

# tournament-results 改修（AI取込補助+突合・部分承認・差し替え）要件定義（2026-08-22）

改修モードで既存 requirements.md を更新（親 #533・子 #534-#540・7タスク4Wave）。実装未着手。

## 主要な設計判断
- AI はルーティング（どのパースに乗せるか）・級名正規化・メタ抽出・整合検証に絞る。決定的パーサ（個人戦98%成功実測）を常に先に無料試行し、AI が試行結果+生データを見て 採用/フル抽出エスカレート/対象外警告 を決定。fail-open 必須（AI障害で取込は止まらない）
- フル AI 抽出フォールバック: 0 classes・検証破綻・PDF のみ。Sonnet 5 + streaming + max_tokens 100k（出力中央値33k実測）。既存 ParsedResultPayloadSchema で検証
- 突合は edition×級粒度。既取込級は既定チェックOFF+バッジ、級単位の部分承認（承認アクションで payload をフィルタ→materialize 本体は無変更=回帰AC-12）
- ★差し替えは物理削除+ドラフト原本復旧（deep-advisor 助言でユーザー承認の上 AC-14 を論理削除から改定）: 論理削除だと読み取り約35箇所へ除外フィルタ恒久追加・1箇所漏れ=当落線の静かな二重計上（Explore 調査済み・chokepoint 無し）。materialized 4表は導出層で extracted_payload+添付から再承認で復元可能。トランザクション順序: materialize新→active fact を linkActualResultClass(replaceExisting:true) で新級へ→旧class DELETE(cascade)→空 tournaments DELETE→監査(全級=draft superseded/部分=tournaments.note)→display_name+会員リンク再計算(旧∪新)
- 自動検知はユーザー判断でスコープ外（手動トリガー起点維持）。将来制約: 添付プルーニング導入時は approved/superseded draft の添付を除外（復旧原本）

## AC 要約
AC-1〜AC-22（auto-test 21件 / manual 1件=AC-21 本番実機確認）。回帰AC: 全級選択=現行同一(12)・edition未確定時現行挙動(16)・状態ガード(18)・既存テストCI green(19,20)

## タスク/Wave
W1: #534 shared AI列migration(main) / #535 ai/モジュール / #537 PDFトリガー → W2: #536 run.ts統合 / #538 承認画面UI → W3: #539 承認アクション(差し替えtx) → W4: #540 docs。フォーム契約(selectedClasses/replaceGrades JSON)は implementation-plan.md 設計メモが正

関連: [[project-result-import-reality-audit]]（実測根拠）
