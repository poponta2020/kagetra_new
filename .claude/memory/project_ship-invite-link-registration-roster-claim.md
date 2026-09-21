---
name: ship-invite-link-registration-roster-claim
description: 名簿の会員が招待URLから名簿を選んで紐付け（invite-link-registration 改修）
type: project
---

PR #660「feat(invite-link-registration): 名簿の会員が招待URLから名簿を選んで紐付けられるようにする」— https://github.com/poponta2020/kagetra_new/pull/660 — 2026-09-21 マージ成功（merge commit e99d2d4）。CI（Lint/Typecheck/Test・E2E）は pending のままマージ＝赤になったら追修正。

**出荷内容**: 名簿に行がある未紐付けの会員（2026-09-08 一括投入の26名など）が、同じ招待URLで『名簿から選ぶ』を選び、LINE 紐付けとサークル所属（学部区分・学部等名・学年、名簿で空なら電話・生年月日）を1回の送信で保存できる。/self-identify も同じフォーム・同じ共通処理（lib/roster-claim.ts: 候補条件つき FOR UPDATE → DB の空欄の印で検証 → 候補条件つき UPDATE・更新列ホワイトリスト）。新しく登録するで名簿の候補と同名なら名簿へ誘導。同梱修正: 登録フォームのエラー後に級・所属の選択が見た目だけ外れて再送信で grade=null・所属 OFF になる既存不具合（React 19 の <form action> 後の自動 reset）→ onSubmit+startTransition へ。

**Issue**: 子 #654〜#658 は PR 本文でクローズ、親 #653 を手動クローズ。

**レビュー（auto-review-loop）**: 1 ラウンド（initial のみ・gpt-5.6-sol・effort medium＝3,856行で上限丸め）。R1 の blocker 1件『招待トークンの検証と紐付け更新の間に TOCTOU』をユーザー判断で見送り（WONTFIX: 数ミリ秒の窓・結果は取り消し直前の送信と同じ・越境なし・既存 registerViaInvite も同じ作り）→ 修正対象0件で成功（verdict=cutoff/user-wontfix）。再レビューせずに修正した指摘なし。Codex 累計 209,176/500,000 トークン。DoD: 全 PASS（A はCI委譲 SKIP）。

**検証の状況**: 対象 vitest（lib/roster-claim*・profile-validators・components/register・app/register/[token]・app/self-identify）はローカル green、check-types・eslint 通過。E2E はローカル未実行（CI が初回）。

**★残DoD（本番で確認・ユーザー）**: ①会員用の招待URLを発行し、未紐付けの名簿会員として開くと『名簿から選ぶ／新しく登録する』の2択が出る ②名簿から選ぶ→サークル所属 ON→学部等を入れて送信→ダッシュボード、会員管理画面で紐付け方法=招待リンク・学部等が入っている ③画面に候補の住所・電話が出ない ④/self-identify にもサークル所属ブロックが出る ⑤本番は有効な招待リンクが0件（2026-09-21 時点）なので、会員へ配る前に新しいリンクの発行が要る
