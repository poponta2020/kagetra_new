---
name: ship-annual-registration-renewal
description: 年度確認（annual-registration-renewal）出荷
type: project
---

**annual-registration-renewal（年度確認）出荷完了** — PR #631 merged（2026-09-10）。https://github.com/poponta2020/kagetra_new/pull/631

## 内容
毎年3月の全日協登録更新で、管理者が個別に聞いて回っていた「今年度も登録するか」「登録情報に変更はないか」の確認を、会員の自己申告＋アプリの集計に置き換えた。学年の年度繰り上げ（travel-report が運用に回していた Non-goal）も同じ流れに載せた。124ファイル・+23,707行。

- S1 /renewal（会員）・S2 /admin/members/renewal（管理ボード）・S3 /settings/club-line-group・S4 ホームのバナー・S5 会員編集の公認資格
- migration 0066: users に reader_certification / is_associate_referee、line_channel_purpose に club_chat、新テーブル4本（club_line_groups / membership_renewals / membership_renewal_members / line_chat_tasks）
- LINE は Messaging API push（人数分課金）ではなく match-tracker の OAM チャット予約送信ワーカーを共用。/api/line-chat-worker/** を X-Service-Token で提供
- 日次バッチ2本（19:30 リマインド作成+reconcile / 00:05 学年反映）と systemd timer

## Issue
子 #620-#629 クローズ。**親 #619 と #630 は OPEN のまま**（#630 = match-tracker 側の複数アプリ対応＋メンション・別リポジトリ。kagetra 側の出荷はブロックしない＝未デプロイの間はタスクが PENDING のまま残るだけ）。

## レビュー
Codex 2R（initial + delta）・verdict=cutoff・effort=medium 固定・累計 624,661/1,000,000。
- R1（全差分14,653行・gpt-5.6-sol）: blockers 8 / should_fix 3
- 修正 9 件 / **見送り 4 件（WONTFIX・ユーザー判断）**: RESERVING 中の取消／登録完了ダイアログのプレビュー鮮度／分割リマインドの途中失敗復旧／会 LINE グループ設定の同時保存
- R2（delta 600行・gpt-5.6-terra）: pass。**再レビューせずに修正した指摘は 0 件**
- final（全差分の再確認）は残予算375k < 実測511k のためユーザー判断で省略
- CI（Lint/Typecheck/Test）は **pending のままマージ**（赤なら追修正）

## ★残 DoD（出荷後の人手作業・順序に注意）
1. **infra/sudoers/kagetra-deploy の本番反映**。unit 名は固定列挙なので、未反映のまま unit を含むコードがデプロイされると auto-deploy が install の段階で sudo に蹴られて失敗する。**既にマージ済みなので次のデプロイまでに要対応**
2. .env.production へ LINE_CHAT_WORKER_TOKEN を投入 → restart → curl で 401/403/200
3. /settings/club-line-group で会 LINE グループを設定（Bot招待 → 誰かが発言 → OAM の URL 貼り付け → join でグループID捕捉）
4. match-tracker 側の APPS_JSON 対応＋VM の .env 更新＋再起動
5. AC-28（375px 実機で S1〜S3 に横スクロールが無いこと。静的照合では判定できず未確認）・AC-30/31/32（本番送信・メンション PoC）

手順の正典 = docs/deploy/annual-registration-renewal.md、仕様の正典 = docs/spec/membership-renewal.md
