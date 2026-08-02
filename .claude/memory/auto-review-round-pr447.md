---
name: auto-review-round-pr447
description: auto-review PR #447
type: project
---

PR #447 (mail-inbox-mailer 統合処理フォーム) の auto-review-loop 記録。

## 結果: token-budget で中断（未収束）
- 総ラウンド 3 / 上限 10。構成 = initial 1 + delta 2
- 累計トークン 528,238 / 上限 500,000（R4 の 3-0 事前チェックで中断）
- 最新の結果 JSON は r3 = needs_changes。**gate-dod C1 が ship を機械的に止める状態**

## R1 (initial / 全差分網羅)
- gpt-5.6-sol / effort=high（構造的高リスクパス: packages/shared/**/schema*・drizzle/。sol 較正でも high 維持）
- 5,771行 / 26ファイル。既定除外 9ファイル（docs 7 + drizzle/meta 2）
- verdict=needs_changes / blockers=5 / should_fix=0 / nits=0 / tokens=393,565
- トリアージ: 修正2（団体戦グループのサーバー検証・遅延配信の再検証）/ WONTFIX 3（undo の削除範囲=要件どおり・AI排他=**誤検知**・carrier 設計=手順書で決定済み）
- 修正コミット 19522dc

## R2 (delta)
- gpt-5.6-terra / effort=medium / 208行 2ファイル / tokens=76,906
- verdict=needs_changes / blockers=1: 遅延配信の再検証が処理世代を識別していない（取り消し→同じ大会へ再処理で triage/linked が再一致し旧予約が復活）
- ユーザー承認済み「軽量版で修正」の範囲内と判断して再確認せず修正。triaged_at を世代トークンに。コミット c41c5d2

## R3 (delta)
- gpt-5.6-terra / effort=medium / 143行 2ファイル / tokens=57,767
- verdict=needs_changes / blockers=1（**R2 と同一 file::title = ping-pong 検出**）: triaged_at を JS Date に落とすと PostgreSQL のマイクロ秒がミリ秒へ丸められ同一ミリ秒内の別世代を区別できない
- schema 変更なしで塞げるため `triaged_at::text` の文字列比較へ変更。コミット cab8550
- ★この修正は**レビュー未検証**（R4 が予算で開始できず）。テスト 162件 green・typecheck/lint green

## 学び
- R2→R3 は同じ blocker が精度の粒度を下げて再掲され続ける典型の ping-pong。fingerprint が `same` を返した
- 「軽量版で直す」とユーザーが決めた範囲内の手直しは再確認せず進めたが、それが 2 ラウンド連鎖した。timestamp を世代トークンに使う設計自体が精度の議論を呼び込むので、最初から専用トークン列か、あるいは見送りの選択肢を提示すべきだった
- 予算配分: R1 の全差分 high が 393k（全体の 75%）。高リスクパスを含む大型 PR では initial だけで予算の大半を使う
