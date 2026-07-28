---
name: project-pr399-fixture-pii-accepted
description: PR #399 fixture の PII 露出はリスク受容（2026-07-28）
type: project
---

PR #399 の fixture に混入した個人情報（他会主催者の実名4件・社名1件）について、**ユーザーがリスクを受容し履歴の是正は行わない**と判断した（2026-07-28）。

**経緯:** 実物の申込書テンプレから作った fixture の docProps/core.xml・app.xml に dc:creator / cp:lastModifiedBy / Company が実名で残ったまま、public リポジトリのコミット 0932d55（と 530eca1）へ push した。Codex R2 で検出。

**現在の状態:**
- HEAD の fixture は scrub 済み（creator/lastModifiedBy=kagetra-fixture・Company 空）
- 再発防止テスト = apps/web/src/lib/entry-form/__fixtures__/fixtures-privacy.test.ts（メタデータとセル内メールアドレスを機械チェック）
- 履歴中の blob は残置。force-push・squash merge・GitHub サポート依頼はいずれも実施しない

**How to apply:** この件を再び blocker として扱わない。ただし**今後 fixture を追加するときは docProps を必ず scrub する**（[[feedback-office-docprops-pii]]）。実物由来ファイルをコミットする判断自体は有効だが、scrub の対象はセル値だけではない。

リポジトリが public であることは、他の実データ（docs/data-quality の実名等）を扱うときの前提としても覚えておく（[[project-third-party-distribution-assessment]] の公開方針とあわせて判断する）。

関連: [[fix-pr399-r2]] / [[impl-entry-form-autofill]]
