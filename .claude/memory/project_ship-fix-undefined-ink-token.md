---
name: ship-fix-undefined-ink-token
description: 未定義トークン text-ink-1 の修正
type: project
---

**PR #531** fix(ui): 未定義トークン text-ink-1 を text-ink へ置換
https://github.com/poponta2020/kagetra_new/pull/531

Tailwind v4 は未定義トークンを無言で握り潰すため、globals.css に存在しない `text-ink-1` を指定していた **19 箇所 / 8 ファイル**は color 宣言が一切生成されず、親から継承した色で描画されていた。build / lint / typecheck / vitest はすべて green のままで、静的チェックでは検出できない失敗モード。定義済みインク系トークンは ink / ink-2 / ink-meta / ink-muted / ink-on-brand の 5 つのみ。対象は全て見出し・フォーム入力・一覧行の主テキストのため `text-ink` へ置換した。

**見た目の変化**: 17 箇所は変化なし（(app) 配下は mobile-shell が text-ink 指定、モーダル4つは createPortal で body 直下＝ --kg-fg = #1e1b13 = ink。継承色と一致）。残り 2 箇所（GradeGroupList / InviteCodeModal の閉じるボタン）は `text-ink-meta hover:text-ink-1` で **hover が死んでいた**ため、修正により hover で ink まで沈む挙動が有効化される（RegistrationInviteModal と同挙動に）。

**検証**: @tailwindcss/postcss で globals.css を実コンパイルして生成 CSS を照合。置換前は .text-ink-1 / .hover\:text-ink-1 が 1 件も生成されず、置換後は .text-ink / .hover\:text-ink が `color: var(--color-ink)` を出力。**生成 CSS は置換前後でバイト単位同一**（旧トークンが何も出力していなかった証左）。typecheck / lint pass、vitest は apps/web 全体 227 files / 3339 tests pass。

**リベースでの差分**: 着手時 main では 21 箇所 / 9 ファイルだったが、origin/main（834ff83）へのリベースで GroupToggleDialog.tsx が upstream 削除済み（8d60a63）となり該当 2 箇所が消滅。また settings/page.tsx の表示ロール切替ボタンが upstream で RolePreviewSection へ抽出された際に text-ink-1 を持ち越していたため追随修正した。guest-role は既に main へマージ済み。

**Codex レビュー**: 1R(initial) verdict=pass / blockers 0・should_fix 0・nits 0 / gpt-5.6-sol effort=low / 累計 90,283 トークン。R1 が最終形を網羅レビューして pass のため final 省略、/fix 呼び出しなし。**再レビューせずに修正した指摘はゼロ**。

**DoD**: D2 が初回 FAIL（src 変更あり docs 差分なし）→ トークン置換のみで仕様・挙動不変のため PR 本文に `Docs: no-change-needed` を明記して PASS。CI は pending のままマージ（赤になったら追修正）。

**残作業（本PRのスコープ外だった同種2件）は PR #532 で解消済** → [[ship-fix-undefined-warn-token]]。当時の記録: `warning` というトークンは定義に一切存在せず、`warn` も --color-warn-bg / --color-warn-fg のみでスカラーは無い。
- admin/mail-inbox/components/TournamentSeriesSelectSheet.tsx:165 `border border-warning/30 bg-warning/10` — **影響大**: 背景が出ず素の border で枠線が currentColor（≒黒）になり、警告ボックスが「黒枠・無地の箱」として描画される。正しくは border-warn-fg / bg-warn-bg
- admin/mail-inbox/[id]/page.tsx:349 `<Card className="border-warn bg-warn-bg">` — 枠線色だけ既定のまま。軽微

**★実機未確認**: 静的解析とテストのみ。hover が有効化される 2 箇所の実際の見え方は本番で要確認。

再発防止の掃討手順（生成CSS照合の全ツリー版・踏んだ罠4つ込み）は [[feedback-tailwind-v4-undefined-token-silent]] に記録済み。CI ガード化は未実施。
