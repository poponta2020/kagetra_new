---
name: impl-mail-ai-regional-eligibility-task1
description: mail-ai-extract-refinements 地域制限判定 タスク1
type: project
---

mail-ai-extract-refinements 改修（D・E 級の地域制限判定・親#612）タスク1（#613）: 抽出契約の拡張。main 直で実装、commit 663771c（worktree C:/tmp/impl-mail-ai-extract-refinements・branch feature/mail-ai-extract-refinements）。

変更: apps/mail-worker/src/classify/regional.ts 新設（HOME_REGION／REGIONAL_ELIGIBILITY_GRADES／4値 VERDICT_* と REGIONAL_VERDICTS。依存ゼロ leaf・package exports に ./classify/regional 追加）／schema.ts に RegionalEligibilitySchema と EventUnitSchema.regional_eligibility（必須・空配列可）＋superRefine（級重複拒否・要確認以外の根拠 null/空白拒否）／llm/anthropic.ts に stripWorkerOnlyProperties（input_schema から evidence_verified だけ除去・パス不在は例外）／prompt.ts 3.1.0（新セクション・反例2件・Example 3 に D=制限なし・Example 4 新設・出力サマリ）／fixture 3 件＋FIXTURE_DEFAULT_PAYLOAD に regional_eligibility: []。テスト: schema/prompt/anthropic/fixture 65件 green・tsc・eslint 通過。

注意点: ①prompt.ts は 4値と「北海道」「D 級・E 級」をすべて regional.ts の定数から補間している（literal は支部の地理説明の1箇所のみ）。②EventUnit.regional_eligibility が必須になったので web 側の EventUnit リテラル（ApprovalForm.test.tsx buildUnit 等）は typecheck で落ちる＝タスク3の「型の波及」で吸収する。③fixture JSON は CRLF。official 行の直後に1行足しただけ（他フィールド不変=AC-78）。④Wave 2（タスク2/3/4）はこの commit を土台に task-implementer 3並行で着手。
