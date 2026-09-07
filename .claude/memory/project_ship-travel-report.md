---
name: ship-travel-report
description: travel-report（遠征届）出荷
type: project
---

travel-report（遠征届）出荷。**PR #592** https://github.com/poponta2020/kagetra_new/pull/592 — MERGED（2026-09-07）。親 Issue #583・子 #584〜591（全て自動クローズ）。

北大かるた会サークル所属者の遠征経路入力と、大学提出用「遠征届」Word の自動作成・副連絡責任者への LINE 通知。migration 0064（users へ6列＋新テーブル5つ）。

## レビューループ
7ラウンド（initial 1・delta 3・final 1・final-delta 1・cutoff 1）／終了理由=cutoff(user-wontfix)／effort=high→medium／**累計 1,430,128 トークン**（既定上限 500,000 を2回引き上げ）。**blocker 19件を修正**。詳細と誤検知3件は [[auto-review-round-pr592]]。
CI は pending のままマージ（この repo の既定運用。赤なら追修正）。

## ★残 DoD（出荷後の手作業）
1. ~~本番 migration~~ **不要（自動）** — ★本番の migration は **CI の deploy ジョブが自動適用**する
   （`scripts/deploy/auto-deploy.sh` が `CHANGED` に `packages/shared/drizzle/[0-9]*.sql` を見つけたら
   `apply-migrations.sh` を実行。journal+hash で冪等）。**`pnpm db:migrate`（drizzle-kit migrate）は
   TTY 必須で本番不適**とスクリプト冒頭に明記されている。手で流さないこと
2. **AC-33 実機確認**: 実際の大会で作成した docx を Word で開き、原本と同じ体裁・記入例と同じ位置に値が入るか
3. **顧問教員の初期設定**: /settings/travel-report で 所属部局等・職・氏名 を入力（★要件は「初期値は原本の値」だが、原本の氏名をコードに埋め込むと §7 に反するため**空**にしてある。未設定でも作成は成功し欄が空欄になる）
4. **サークル長・副連絡責任者フラグの付与**と、既存会員のサークル所属・学部・学年の投入（/admin/members/circle の一括編集）
5. **未確認（コード照合では判定不能）**: 375px で横スクロールが無いこと、描画上の高さ・角丸・ピル形状

## ★この出荷で得た再利用可能な知見
- **after() はリクエストスコープの外で throw する**。RSC の単体テストがある画面で使うときは必ず try/catch で握りつぶす
- **PII の scrub 対象を文字列で書くと、その文字列自体がリポジトリに残る**。位置指定（段落番号＋残す run 数）にして、様式のラベルだけを検査に使う
- **review-diff.sh は lockfile を除外する** → Codex が「lockfile に反映されていない」と誤検知する。frozen install で実証してから判断する
- **106ファイル・645KB の PR は initial だけで 900k トークン**。大機能は PR を割るか initial の effort を下げる
