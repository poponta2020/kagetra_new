---
name: feedback_bottom_sheet_url_bar_hidden
description: "ボトムシートの下端ボタンがモバイルで隠れる → createPortal(body)＋.modal-overlay-h(svh最終勝ち)で根治。dvh/max-hだけでは直らない"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a1ccf5e9-21f0-4a98-9e6c-2563bc6c0210
---

**モバイルのボトムシートで下端（適用/OK ボタン等）が画面外に隠れる**不具合。原因は**2つ重なる**ので、両方潰さないと直らない（dvh 修正だけでは実機で再発する）。

**原因1（stacking context の閉じ込め）:** シートが `<main>` 内の `sticky z-10` ヘッダ等の**stacking context / containing block** の中に描画されていると、`fixed z-50` がその文脈内でしか効かず、ボトムナビ等の兄弟要素の手前に出られない／位置基準がずれる。実機で「背後のボトムナビが暗転せずシート手前に見える」= この症状。

**原因2（iOS dvh 罠）:** iOS Safari は `viewport-fit=cover` だと **`100dvh` を下部 URL バー込みの高さ**で返す（シェルが PR#67 で踏んだ既知罠＝[[feedback_ios_safari_dvh_url_bar]]）。`h-[100dvh]` のオーバーレイは可視領域より下まで伸び、`items-end` のフッター（ボタン）が UA クローム裏に落ちる。**`dvh` では直らず `svh`（UA クローム表示時の最小高）が必要。**

**How to apply（両方やる）:**
- **Portal 化**：`createPortal(<overlay/>, document.body)` で body 直下へ描画し祖先の stacking context / containing block を脱出。`open`/`payload` はクリック起点でしか true/非 null にならないので SSR で portal は走らない（`import { createPortal } from 'react-dom'`）。
- **svh カスケード**：globals.css の `.modal-overlay-h { height:100vh; height:100dvh; height:100svh; }`（`.mobile-shell-h` と同手法・最後に理解できる宣言=svh が勝つ。Tailwind の同プロパティ utility は出力順不定なので**必ず CSS 側に書く**）を overlay に当て、`h-[100dvh]` を置換。
- パネルは `max-h-full overflow-y-auto`＋安全領域下パディング `pb-[calc(1rem_+_env(safe-area-inset-bottom))]` 維持。[[feedback_flex_min_h_0_for_overflow]]／[[feedback_tailwind_arbitrary_underscore_space]]。
- 挙動/ロジック不変・CSS＋描画位置のみ。テストが `screen`（document 全体検索）なら Portal 化で回帰なし。

**経緯（重要な教訓）:** PR#253(`3231fbe`)→#254(`e6d450c`) で `h-[100dvh]`＋`max-h-full` を当てたが**実機で直らなかった**（dvh 罠＋stacking の二重原因を見落とし・スクショで判明）。**PR#262(`8af40f0`,2026-07-03)** で全7シート（RankingFilterBar/StatsPeriodFilter/InviteCodeModal/RegistrationInviteModal/ManualLinkModal/account-menu/ExistingEventLinkSheet）を **Portal＋`.modal-overlay-h`(svh)** に置換して根治。**新規ボトムシートは最初からこの形で書く**。`grep 'fixed inset-0.*items-end'` や `h-\[100dvh\]` で旧パターン混入を検知。
