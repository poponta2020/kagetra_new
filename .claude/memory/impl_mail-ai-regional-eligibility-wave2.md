---
name: impl-mail-ai-regional-eligibility-wave2
description: mail-ai-extract-refinements 地域制限判定 Wave 2（タスク2〜4）
type: project
---

mail-ai-extract-refinements 改修（D・E 級の地域制限判定・親#612）Wave 2 = タスク2（#614）／タスク3（#615）／タスク4（#616）を task-implementer（sonnet）3並行で実装。worktree C:/tmp/impl-mail-ai-extract-refinements・branch feature/mail-ai-extract-refinements。

タスク2: classify/evidence.ts 新設（normalizeEvidenceText＝NFKC＋/[\s\u200b\ufeff]+/gu 除去・buildEvidenceCorpus・annotateRegionalEvidence 非破壊）＋classifier.ts が attachmentsForLlm と同時に evidenceTexts を集めて llm.extract 成功後に parsed だけ注釈。テスト: evidence 15件＋classifier に6件。
タスク3: regional-eligibility-utils.ts の planRegionalEligibility（3条件で外す・制限なしは notices 無し・eligible_grades に無い級は無視）＋RegionalEligibilityNotice（HOME_REGION から文言合成・warn トークン）＋ApprovalForm（registered 初期値=!allRemoved・composeTitle と EventForm.eligibleGrades に effectiveGrades・Notice は fieldset の外）。テスト: utils 12件・ApprovalForm に8件。
タスク4: ExtractedPayloadView に地域制限小表（級／判定／根拠／照合）。テスト6件。

受け入れ確認（main）: 排他宣言ミスなし（3ワーカーの変更ファイルは重複ゼロ）。main の追修正2点: ①ワーカー3の指摘どおり composedTitleOf に registeredMap ガードを追加（登録済み単位の表示名から級を落とさない=AC-75）②ExtractedPayloadView.test.tsx の noUncheckedIndexedAccess 型エラー（regional[0] → regional[0]!）を修正、タスク4の IIFE を map のブロック本体に整理。検証: mail-worker tsc/eslint/vitest 55件・web tsc/eslint/vitest 68件 すべて green。commits: 2=#614, 3=#615, 4=#616（git log 参照）。

ワーカー品質メモ: 3名とも指示（テスト不実行・担当パス限定・.js 拡張子）を厳守。ワーカー2は Bash ヒアドキュメントで \u200b が畳まれる罠を踏み自力回復（Write ツール推奨）。ワーカー3は advisor 相談で登録済み単位の表示名の論点を自発的に報告した（良質）。
