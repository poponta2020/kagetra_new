---
name: ship-tournament-results-ai-revamp
description: tournament-results AI改修 出荷
type: project
---

PR #541 — feat(tournament-results): 結果取込に AI ルーティング・PDF 対応・edition×級 突合/部分承認/差し替えを追加
https://github.com/poponta2020/kagetra_new/pull/541 — **MERGED**（2026-08-23）。親 Issue #533 + 子 #534〜#540 すべてクローズ。

## 何を出荷したか

3ヶ月で結果メール61通に対し取込2件という運用停滞（級名品質の破綻・重複防御ゼロ・パース失敗/PDF の受け皿なし）への対処。

1. **AI ルーティング（fail-open）** — 決定的パーサを常に先に試行し、その試行結果と生データを AI に突き合わせさせて採用可否を判定させる。adopt→級名正規化マップ適用（原値は payload の `rawClassName` に保持）／escalate→フル抽出／out_of_scope→決定的パース結果のまま承認画面に警告。AI 障害でも取込は止めず `ai_error` に理由を記録。`ANTHROPIC_API_KEY` 未設定でも決定的パースのみで動く
2. **フル AI 抽出フォールバック** — 0クラス／escalate／PDF の3経路。PDF は `readExcel` より前に分岐（`detectExcelFormat` が .pdf で throw するため）。出力は Zod 検証し不整合は parse_failed
3. **edition×級 突合・部分承認・差し替え** — 取込済み級はバッジ+既定 OFF、級単位の部分承認、差し替えは旧データ物理削除+active fact の新級への revision 再リンク+監査（全級消滅=旧draft superseded／部分=tournaments.note 追記）

migration `0061_lumpy_jackal.sql`（result_drafts に AI 列8本・全て nullable・既存行に影響なし）。

## レビュー結果

Codex 3ラウンド（initial 1 + delta 2）／effort h→h→h／累計 512,312 トークン。**R3 で pass**。**終了理由=token-budget**（既定上限 500k 超過のため任意の final 全差分ラウンドは未実施。ただし変更行のカバレッジに欠けはない — R1 が全差分を網羅レビューし R2・R3 が各修正差分をレビュー）。**修正したが再レビューしていない指摘は無い**（R3 が指摘ゼロの pass）。

blockers 8件中 6件修正・2件 WONTFIX。詳細は [[auto-review-round-pr541]]。実装記録は [[impl-tournament-results-ai-revamp]]。

### ★出荷後に残る手作業 DoD（未消化）
1. **AC-21 実機確認**: 本番で級別分割の後続メール（多摩／さがみ野系の級別報告など）を1通取り込み、①先行取込済みの級に「取込済み」バッジが出て既定 OFF ②未取込級だけの部分承認が通る、を確認する
2. **worker 側の `ANTHROPIC_API_KEY` 配線確認**: 未設定だと `buildResultImportAi` が warn ログを出して AI を無効化し、決定的パースのみで**静かに**動く（`ai_error` すら残らない）。デプロイ後に worker のログか、取り込んだドラフトの `ai_model` 列が埋まるかで確認する

## この出荷で確定した仕様変更（既存挙動の破壊・ユーザー承認済み）

「同一 edition の同 grade を差し替え指定なしで2回承認し、あとから `replaceActualResultFact` で fact を切り替える」旧フローは**禁止**になった（サーバー側で拒否）。`replaceActualResultFact` 自体は、過去の一括投入由来など既に複数クラスがある edition 向けの明示置換 API として残る。
