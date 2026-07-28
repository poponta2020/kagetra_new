---
name: feedback-office-docprops-pii
description: 実物由来の fixture は docProps に実名が残る
type: feedback
---

実物ファイル（xlsx / docx / pdf）を fixture 化するとき、**セル値・本文の差し替えだけでは PII は消えない**。

**Why:** Office 文書は本文とは別に docProps/core.xml（dc:creator・cp:lastModifiedBy）と docProps/app.xml（Company・Manager）を持ち、そこに作成者の実名と所属組織が残る。画面にもセルにも現れず、sharedStrings.xml を grep しても出てこないので、目視でも通常の検索でも見落とす。PR #399 で実際に実名4件と社名をコミットして push した（Codex R2 が検出）。

**How to apply:** exceljs なら保存前に `creator` / `lastModifiedBy` / `company` / `manager` / `title` / `subject` / `keywords` / `description` / `category` と各種日時を明示的に潰す。そのうえで**メタデータを検査する自動テストを fixture と同じディレクトリに置く**（apps/web/src/lib/entry-form/__fixtures__/fixtures-privacy.test.ts が実例）。生成スクリプトの scrub 漏れは、次に誰かが fixture を足したときにまた起きる。

一度 push すると blob が履歴に残る。作る前に潰すこと。

関連: [[fix-pr399-r2]] / [[impl-entry-form-autofill]]
