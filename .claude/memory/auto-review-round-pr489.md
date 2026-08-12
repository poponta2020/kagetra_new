---
name: auto-review-round-pr489
description: auto-review PR #489
type: project
---

# auto-review PR #489（guest-role）

**最終結果: pass 相当（cutoff / user-wontfix）。全3ラウンド + 打ち切り記録。**

| R | phase | model | effort | verdict | B/S/N | tokens |
|---|---|---|---|---|---|---|
| 1 | initial | gpt-5.6-sol | high | needs_changes | 5/1/1 | 663,839 |
| 2 | delta | gpt-5.6-terra | medium | needs_changes | 1/0/0 | 92,002 |
| 3 | final | gpt-5.6-sol | high | needs_changes | 2/0/0 | 299,989 |
| 4 | — | — | — | cutoff(user-wontfix) | 0/0/0 | — |

累計 **1,055,830 トークン**（既定上限 500,000 を大きく超過。R1 終了時点で一度 token-budget 中断し、ユーザーの「レビュー続けて」で再開）。
レビュー対象外（既定除外）: docs 6ファイル + drizzle/meta 2ファイル。

## 修正した指摘（8件）

**R1（commit 24c5ed4 / 832108c）**
1. ★**`'use server'` から非 async 値を export → 本番 build が失敗**。型検査・lint・テストが全 green のまま build だけ落ちる類。repo に同じ理由の先例（`line-grade-groups/grades.ts`）があり、`registration-invite-kinds.ts` へ分離
2. `loadMoreMails` / `loadMoreTournaments` / `loadMoreRanking` / `startLineLink` にゲストガードが無く、**許可ページから Server Action を直接呼べば会員限定データが取れた**（要件 R8 違反の実例）
3. 確定名簿クエリが現在の role を見ておらず、名簿掲載後にゲストへ変わった人が名簿由来とゲスト合流の両方で拾われ**重複・過大集計**（競合ではなく定常的な不整合）
4. ゲスト設定画面の表示名だけ session 由来で stale
5. 要件 AC-18 の `totalJpy=null` が実装・既存契約の `0` と矛盾 → 要件書を訂正
6. 申込書**確定時**のロール再検証（`memberUserIds` を追加）

## ★ユーザー判断で見送り（WONTFIX 4件）

**すべて「管理者の並行操作とタイミングが重なったときだけ」の TOCTOU / 脅威モデル外**。管理者は実質1人で、ロール変更は登録会移動時の年数回の操作という運用実態が根拠。

1. R1: `api/line-link/callback/route.ts` — LINE 切替の開始〜callback の窓でゲストへ変更されると切替が成立。**開始 Action のガードは修正済み**なので破れるのは「開始時点では会員だった人」だけ
2. R2: 申込書の `members` と `memberUserIds` の**対応関係**をサーバーで保証していない。→ **原理的に防げない**: xlsx に書く `EntryFormMember` は姓名・級などの自由文字列だけで識別子を持たず、管理者はゲストの名前を直接タイプできる
3. R3: ゲスト検査と xlsx 保存が `FOR UPDATE` で直列化されていない。窓は数秒で、**別の**管理者の同時操作が要る
4. R3: 通知先の管理者をゲストへ変更しても LINE 通知が止まらない。→ **この PR のスコープ外の既存問題**: `notification_line_user_id` は運用者が CLI（`seed-system-channel.ts`）で手入力した固定値で `users` を引いておらず、AC-28「通知対象を引くクエリ」に該当しない。ゲスト以前も**一般会員への降格**で同じことが起きていた。この PR は通知経路のファイルを1つも変更していない

## ★教訓

- **`'use server'` ファイルの値 export は静的解析を全部すり抜けて build だけ壊す。** レビューが無ければマージ後の CI で初めて発覚していた（R1 最大の収穫）
- **ページのゲストガードは Server Action を守らない。** 許可されたページから任意の action ID を POST できるため、load-more 系のような「ログイン済みなら誰でも」の Action は個別に塞ぐ必要がある
- **同一クラスの指摘は WONTFIX を明示的に渡さないと毎ラウンド蒸し返される。** R2・R3 のプロンプトに「再掲禁止」として渡したことで、見送り済みの指摘は再出現しなかった（別角度の新指摘は出た）
