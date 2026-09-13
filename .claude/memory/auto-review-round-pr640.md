---
name: auto-review-round-pr640
description: auto-review PR #640
type: project
---

PR #640 = tournament-results 受信箱可視性（取込中は消す→承認待ちで復活）。**3R(i+d+f) で verdict=pass**・累計 333,214 tokens / 500,000。

## R1 (initial・全差分網羅・gpt-5.6-sol・medium・130,393 tokens)

verdict=needs_changes / blockers 2・should_fix 0・nits 0。差分 1,547 行 / 17 ファイル（docs・memory は既定除外）。

- **B1 修正済み（即修正・並行修正 → 5ed1dac）**: 結果取込の完了 Web Push が `runResultParse` の内側にあり、`markJobDone`（dispatcher 側）より先に badge を数えていた。ジョブがまだ `claimed` なので、この PR で入った `countUnprocessedMails` が**完了メール自身を取込中として除外**し、「結果取込完了」通知が届いた瞬間の badge が実際より 1 件少なくなる。通常の完了経路で必ず起きる。★通知を dispatcher の `markJobDone` 直後へ移設して根治した（badge 側に「この1件は終わったことにする」フラグを足す案より、通知を確定後に送る方を選んだ）。`runResultParse` の opts から `webPushConfig` を外したため run.test.ts の 21 箇所を機械削除。
- **B2 見送り（WONTFIX・ユーザー判断）**: `dismissMail` の新ガードが `triggerResultParse` / worker のドラフト確定と直列化されていない。dismiss は `mail_messages` を FOR UPDATE するが trigger 側はしないため、同時操作で承認待ちドラフトを持つメールが processed になりうる。理由 = 同一メールへの同時操作が必要な競合で管理者1〜2名の運用では実質起きない・**既存の tournament_drafts ガードも同じ構造**なので直すなら両方まとめて別 Issue・最悪ケースも「未処理に戻す」で復旧可能。

## R2 (delta・修正差分のみ・gpt-5.6-terra・medium・45,729 tokens)

verdict=pass / 0-0-0。284 行 / 3 ファイル。B1 の解消を確認。

## R3 (final・全差分・gpt-5.6-sol・medium・157,092 tokens)

verdict=pass / 0-0-0。1,826 行 / 19 ファイル。出荷される最終形を確認。

★WONTFIX は R2・R3 のプロンプトへ「対応不要が確定した指摘」として渡し、言い換え（mail 行ロック・advisory lock）も含めて再掲禁止と明示した → 蒸し返しなし。
