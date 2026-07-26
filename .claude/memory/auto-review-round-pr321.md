---
name: auto-review-round-pr321
description: auto-review PR #321
type: project
---

pr: 321
rounds: R4 / R5（R6 実行中）
effort: high（全ラウンド）
cumulative_tokens: 1256580（R1-R5 合計。ユーザー指示で上限を撤廃して継続）

## R4 の指摘（全件対応・コミット bd302f6）

blocker: **retry key と元 push リクエストの 1:1 対応が崩れ、サイレントな配信欠落**
A・B をまとめた push がタイムアウト(実際は未受理)した後、A だけを同じキーで送って
受理されると、続く B の再送が 409 になり「B は一度も送られていないのに送信済み」に
なる。再送ボタンは1大会ずつ送るため**現実に踏む経路**。
→ 再試行時は同一 retry key の未送信行を全て呼び戻して**元のバッチ構成を復元**し、
同じ本文(event id 昇順で決定的)・同じ宛先で送り直す。
→ LINE の retry key 保持期間は 24h。超過後は同じキーでも新規リクエスト扱いになり
二重配信になるため、期限切れは自動再送せず deliveryUnknownGrades として管理者へ
「配信結果不明」通知（claim は残す）。

should_fix: 先行グループが unknown のまま後続グループで例外→catch が unknown の
claim と retry_key まで消していた（次回は新キーで二重配信）→ protectedRowIds で保護。
notifyAdmin が pushSystemText の outcome を捨てて常に true を返していた → 実際の成否を返す。

## R5 の指摘（全件対応・コミット e47f095）

blocker: **R4 のバッチ復元は単一プロセスの逐次経路しか塞げていなかった**
元バッチ A+B のリース失効後に2プロセスが A と B を分け取ると、双方が部分本文を
同じキーで送り、片方受理・片方 409 → どちらも sent_at 確定 → 配信欠落。
→ **兄弟行を全件 claim できなければそのキーでは1件も push しない**。claim は残し、
リースが空いた後に全件揃えて送り直させる。

should_fix: 級別配信が broadcastMailToEvent の完了待ちで直列化（既存配信は PDF 変換
等で数十秒）→ Promise.allSettled で並行起動。管理画面の pendingGrade が最後の1操作
しか保持せず処理中の級のボタンが再度押せた → 処理中は全操作を無効化。

## このループから得た教訓（重要）

**外部 API への送信と DB 確定の間の障害は、レビュー1回では詰めきれない。**
R1→R5 で同じテーマ（二重配信 / 配信欠落）が形を変えて5回出た。順に
「catch が受理済み claim を消す」→「キーをその場の行集合から導く」→「timeout/5xx を
失敗扱い」→「部分再送でバッチ構成が変わる」→「並行プロセスがバッチを分け取る」。
LINE の retry key は**元リクエストと 1:1**でなければ意味がなく、バッチ送信では
「キー＝バッチ」の不変性を DB 側で担保する必要がある。

**timestamptz(μs) と JS Date(ms) の精度差**で ownership CAS が永久に不一致になる罠。
claim 時刻は date_trunc('milliseconds') で丸めて往復させる。
