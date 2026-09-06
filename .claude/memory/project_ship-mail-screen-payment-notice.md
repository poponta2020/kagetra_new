---
name: ship-mail-screen-payment-notice
description: メール処理画面から会計へ振込連絡
type: project
---

PR #582「feat: メール処理画面から会計へ振込連絡を送れるようにする」— **merged**（マージコミット 00fa30f・2026-09-06）。
URL: https://github.com/poponta2020/kagetra_new/pull/582
親 Issue #567 / 子 #568〜#574 は PR 本文の closing keyword で全てクローズ済み。

**出荷内容**: 確定名簿メールを処理する画面（`/admin/mail-inbox/mail/[id]` の統合処理フォーム）に「会計へ振込連絡を送る」セクションを追加。名簿の取り込みからそのまま会計へ振込依頼を出せるようにした（従来は申込グループページにしか導線がなく送り忘れていた）。migration 0063（`last_attempted_at` / `last_error`）・露出判定の共有化（`payment-notice-availability.ts`）・送信コアの集約（`payment-notice-send.ts`）・`processMail` への相乗り・UI・失敗表示の全7タスク。

**レビュー**: 4R（initial + delta + final + final-delta）で verdict=pass。effort は sol/high → terra。累計 1,013,870 トークン（上限 500,000 を超過。うち 198,862 は DNS 切断で成果ゼロに終わった R3 の1回目。超過のまま続行するのはユーザー判断）。**再レビューせずに修正した指摘は無し**（打ち切りなし・全件を再レビューで確認）。WONTFIX 無し。

★**final（全差分）の価値が実証された回**: R2 の delta は pass だったが、その後の final で blocker が**4件**出た。delta は修正差分しか見ないので、final を省略していたら4件とも素通りしていた。うち1件は自分で入れたリグレッション。詳細は [[auto-review-round-pr582]]。

**残 DoD**: AC-21 / AC-51 = 本番実機確認（実際の確定名簿メールを処理し、会計へ振込連絡が届くこと）。**本番デプロイ時に migration 0063 の適用が要る**（`pnpm db:migrate`。auto-deploy が実行する）。
**CI**: pending のままマージ（v0.9.0 方針）。赤くなったら /quickfix で追修正する。
