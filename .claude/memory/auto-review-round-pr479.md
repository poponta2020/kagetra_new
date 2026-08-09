---
name: auto-review-round-pr479
description: auto-review PR #479
type: project
---

PR #479 member-mail-search（会員向け受信メール検索・閲覧）のレビューループ。**収束=pass（4R: i+d+f+fd）**。

## ラウンド一覧
| R | PHASE | model | effort | verdict | B/S/N | tokens |
|---|---|---|---|---|---|---|
| 1 | initial（全差分5882行） | gpt-5.6-sol | medium（sol較正: サイズ起因 high→medium） | needs_changes | 5/0/0 | 201,679 |
| 2 | delta（286行） | gpt-5.6-terra | medium | pass | 0/0/0 | 67,163 |
| 3 | final（全差分6019行） | gpt-5.6-sol | medium（sol較正） | needs_changes | 2/0/0 | 206,490 |
| 4 | final-delta（255行） | gpt-5.6-terra | medium | **pass** | 0/0/0 | 52,190 |

累計 527,522 / 500,000（上限は R4 完了後に超過。ラウンド開始前チェックでは未超過だったため続行）。escalated=false のまま。

## R1 blockers 5件 → 修正4 / 見送り1（commit e154101）
1. MailList の state が検索条件変更で初期化されない（key 無し）→ 修正
2. 同名 query 複数指定で q.split が TypeError → 500 → 修正
3. offset ページングの重複・欠落 → **WONTFIX**
4. ビューアの ID 検証が Number(id) のみ（1e5→100000）・int4超過で500 → 修正
5. ?from= が startsWith('/mail') で /mailbox を通す（AC-26 違反）→ 修正

## R3(final) blockers 2件 → 両方修正（commit 0eb7416）
1. 検索語数が無制限で巨大 SQL を生成できる（認証済み DoS）→ searchMemberMails の入口で全体長200字・語60字・重複除去・最大8語へ切り詰め
2. 存在しないページへの反復要求で毎回 LibreOffice 変換が走る → キャッシュ済みメタでページ数を知っていれば変換前に404。**管理者ルートは Non-goal のため据え置き＝意図的な振る舞いの差**

## WONTFIX（ユーザー判断・以降再掲禁止）
- search.ts — 新着メールの並行取り込みで offset ページングに重複と欠落 — 実害が一時的な1〜数件のずれでデータ破壊もなく、修正は search.ts/actions.ts/MailList の契約変更に波及して既存の RankingList・TournamentYearList と方式が食い違うため（2026-08-10）
- api/admin/mail/attachments/[id]/preview/[page]/route.ts — 管理者ルートにも同じ変換反復ガードを入れる — 管理者側は Non-goal・AC-30 で差分ゼロが要件のため（2026-08-10）

## 学び
- **Codex final（全差分の最終確認）は R1 が見落とした問題を実際に出した**（DoS 系2件）。R1 が needs_changes → delta pass で終わらせていたら見逃していた。final を残す設計は効いている
- 修正で入れたテストは計 +15件（R1修正 +7 / R3修正 +8）。対象スイート 179 tests green・tsc 通過・admin 配下の差分ゼロを毎回確認
