---
name: feedback_bottom_sheet_url_bar_hidden
description: "ボトムシート(fixed inset-0 + items-end)は下端ボタンがモバイルURLバー裏に隠れる → h-[100dvh]追従＋max-h-full overflow-y-auto で直す"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a1ccf5e9-21f0-4a98-9e6c-2563bc6c0210
---

**モバイルのボトムシートで下端（適用/OK ボタン等）が画面外に隠れる**不具合の定番原因と直し方。

**Why:** 外側オーバーレイを `fixed inset-0`（＝レイアウトビューポート基準の全画面）にし、パネルを `flex items-end` で下端固定するパターンは、モバイルブラウザでは**レイアウトビューポート下端が URL バー/ツールバーの裏＝可視領域の外**に来るため、下端に貼ったパネルの一番下（＝ボタン群）が画面外に隠れる。パネルに高さ上限・スクロールが無いと、内容が高いとき（条件で増える欄など）に一層はみ出す。※`items-end` は「内容がVPより高いと上にはみ出す」問題とは**別**で、こちらは位置基準（可視外の下端）の問題。

**How to apply:**
- 外側コンテナを**可視ビューポート高に追従**させる：`fixed inset-0` → `fixed inset-x-0 top-0 h-[100dvh]`（`items-end` の貼り付き先が可視領域の下端になる）。[[feedback_ios_safari_dvh_url_bar]] の 100dvh 系。
- パネルに `max-h-full overflow-y-auto` を付与（内容が可視領域を超えたらパネル内スクロール＝ボタンに到達可能）。安全領域下パディング `pb-[calc(1rem_+_env(safe-area-inset-bottom))]` は維持。[[feedback_flex_min_h_0_for_overflow]]／[[feedback_tailwind_arbitrary_underscore_space]] にも注意。
- CSS のみで直り挙動/ロジックは不変。テストが className に依存していなければ回帰なし。

**実例:** PR#253(`3231fbe`,2026-07-02) で統計の絞り込みシート `RankingFilterBar.tsx`＋`StatsPeriodFilter.tsx` を修正。**同じ脆弱パターンの未修正モーダルが他にもある**（`InviteCodeModal`/`RegistrationInviteModal`/`ManualLinkModal`/`account-menu` 等＝`fixed inset-0 flex items-end sm:items-center`）。内容が短いので顕在化しにくいが、下端要素を足すと同じ不具合が出る。新規ボトムシートは最初からこの形にする。
