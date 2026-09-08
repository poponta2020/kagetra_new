---
name: feature-def-mail-ai-regional-eligibility
description: mail-ai-extract-refinements 改修: D・E 級の地域制限判定 要件定義
type: project
---

# mail-ai-extract-refinements 改修: D・E 級の地域制限判定 要件定義（2026-09-08）

正典 = docs/features/mail-ai-extract-refinements/{requirements.md（§3.2.12・AC-64〜80）, implementation-plan.md}。親Issue #612 / 子 #613 #614 #615 #616 #617。AC 17件（auto-test 16 / manual 1）。実装未着手。

## データファーストで確定した事実（ローカル dev DB の実要綱 14 件）
- D・E 級を含む要綱 9 件中 8 件に地域制限があり、北海道の選手が出られたのは北海道初心者大会の 1 件だけ
- 制限は**級ごとに違う**のが普通（兵庫: D=近畿＋隣接県、E=兵庫県内／丸亀: D=中国・四国、E=四国＋岡山）→ 単位ではなく級単位の判定
- **C 級にも制限の実例がある**（北九州: 福岡県協傘下 or 福岡県在住の弐段）。ユーザー判断で今回は D・E のみ、対象級は定数化して後で広げられる形
- 「地域制限」と「抽選の優先枠」は別物（横浜 E 級は「地域制限は設けない」と明記しつつ神奈川優先）→ 優先枠は制限扱いしない
- 埼玉 D 級のような「原則不可・緩和条項あり」がある → 4値目「要確認」

## 主要な設計判断
- **4値**（制限なし／北海道は対象／北海道は対象外／要確認）。「制限なし」と「北海道は対象」を分けるのは誤読リスクが違うため（後者は支部・隣接県の読み違いで反転しうる）
- **根拠の一文は資料から一字一句そのままのコピペ**（ユーザーの強い要望・整形禁止）。要確認以外は必須、要確認だけ null 可
- **ワーカーが機械照合**（AI に渡した本文＋選択添付の抽出テキストと、空白除去＋NFKC の部分一致）→ `evidence_verified`。照合は判定を書き換えず、**自動で外すかどうかだけが照合結果に従う**。画像だけの PDF は必然的に未照合＝人が見る側へ倒れる
- **承認フォームで照合済み「北海道は対象外」の級だけ初期値から外し、外したことと根拠を警告表示**（ユーザー選択。source_mismatch の「警告のみ」より一歩踏み込むのは照合済みの引用という裏付けがあるときに限る）。未照合・要確認は外さず確認依頼。全級が外れた単位は「このイベントを登録する」を既定 OFF
- **events へは持ち回さない**（ドラフト payload 内のみ・マイグレーション不要）。対象級から外せば申込・級別配信・未回答アラートは既存の eligible_grades の仕組みで止まる
- Server Action は不変（外すのはフォーム初期値だけ・人間の判断が AI より上位）
- design_required: false（既存フォーム内の警告ブロック追加。source_mismatch バナーと同じトークン）

## 技術計画で確定したこと
- `EventUnit.regional_eligibility: { grade: D|E, verdict, evidence_quote, evidence_verified? }[]`（必須・空配列可）。`evidence_verified` はワーカー専用: Zod には optional で持ち、**Anthropic へ渡す input_schema からだけ削る**（anthropic.ts でパスを指定して除去・見つからなければ例外）
- 定数は新規 leaf `apps/mail-worker/src/classify/regional.ts`（HOME_REGION='北海道'・対象級 D/E・4値ラベルを HOME_REGION から合成）。package exports に追加し Web は classify/title と同じ経路で import
- 照合コーパスは classifyMail が attachmentsForLlm を組むループで同時に集める（PDF は extractedText ?? ''）。runManualExtract / reextractDraft / reextract CLI は全部 classifyMail 経由で自動対象
- Web は純関数 planRegionalEligibility(unit) → { removedGrades, effectiveGrades, allRemoved, notices }。外す条件 = 対象外 ∧ evidence_verified===true ∧ eligible_grades に含まれる
- ExtractedPayloadView の汎用ループは object を [object Object] にするので regional_eligibility を除外して専用小表
- PROMPT_VERSION 3.1.0（追加のみ）。fixture 3 件は D・E を含まないので regional_eligibility: [] を足すだけ

## タスクと Wave
W1: #613 契約（regional.ts・schema・prompt 3.1.0・fixture・tool schema strip）→ W2: #614 照合（evidence.ts＋classifier）／#615 承認フォーム（utils＋Notice＋ApprovalForm）／#616 ExtractedPayloadView（3並行・ファイル重複なし）→ W3: #617 docs（spec/mail-worker.md＋INDEX）

## 出荷後の手動確認（AC-80）
ローカル dev DB の実要綱 5 件（兵庫 att#45・丸亀 #60・北海道初心者 #96・横浜 E #97・埼玉 D #89）で再 AI 抽出し、判定と根拠が原文どおりかを目視。
