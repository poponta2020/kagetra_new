---
name: auto-review-round-pr455
description: auto-review PR #455
type: project
---

PR #455 member-role-management（管理者による会員ロールの付与・剥奪）のレビューループ。

## ラウンド

| R | phase | model / effort | verdict | B/S/N | tokens |
|---|---|---|---|---|---|
| 1 | initial（全差分940行） | gpt-5.6-sol / medium（サイズ起因 high を sol 較正で一段下げ） | needs_changes | 1/0/0 | 219,946 |
| 2 | delta（176行） | gpt-5.6-terra / medium | needs_changes | 1/0/0 | 62,802 |
| 3 | delta（34行） | gpt-5.6-terra / medium | pass | 0/0/0 | 19,638 |
| 4 | final（全差分1101行） | gpt-5.6-sol / medium | **pass** | 0/0/0 | 132,351 |

累計 434,737 / 500,000。終了理由 = final pass（打ち切りなし・WONTFIX なし・nit なし）。

## ★R1 blocker（実在の権限昇格経路・要件の穴）

updateMemberRole は昇格時に `lineUserId` を要求するが、**その後 `unlinkLine` を実行すれば未紐付けの管理者行が作れた**。`/self-identify` は「未紐付け ∧ 招待済み」を role を見ずに候補化するため、招待リンクを開いた第三者がその行を名乗って管理者になれる。要件段階で「入口（昇格）側で塞ぐ」と決めたが、**裏口（既存の解除操作）を見落としていた** — 「role を見ないクエリが認証フローにある」という前提を1箇所塞いでも、その前提に依存する操作が他にあれば無意味になる。

修正: `unlinkLine` の対象を `role='member'` 限定に（UPDATE の WHERE に埋め込み）。0行時は不在なら従来どおり無害に返し、権限持ちなら `privileged_role` を throw。編集画面でも権限持ちには解除ボタンを出さない。**既存挙動の変更**（管理者・副管理者の紐付けやり直しは、先に降格してから解除する運用になった）。

## R2 blocker（実装側の見解と食い違い→多重防御で収束）

「昇格と解除の並行実行で穴が残る」との指摘。実装側の分析では `updateMemberRole` が対象行を `FOR UPDATE` してから読むため、`unlinkLine` の UPDATE は行ロック待ち→待機解除後に最新ロールで WHERE 再評価となり、指摘のインターリーブは起きない。ただし対策自体（昇格 UPDATE の WHERE に `isNotNull(lineUserId)`・`isNull(deactivatedAt)` を追加）はコスト極小・設計方針と一致するため多重防御として適用し、R3 で pass。**false positive を論争せず低コストな対策で収束させた方が速い**という判断。

## 運用メモ

- R1 の effort は review-effort.sh が「940行 > 400」で high 判定 → PHASE=initial の sol 較正でサイズ起因のみ medium へ降格（高リスクパス起因ではないため）。medium でも blocker を検出できた
- レビュー対象外（既定除外）: docs/features/member-role-management/*.md, docs/spec/auth-admin.md
