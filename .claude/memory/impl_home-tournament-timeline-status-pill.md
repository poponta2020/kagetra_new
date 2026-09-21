---
name: impl-home-tournament-timeline-status-pill
description: home-tournament-timeline 大会ピル4値化 実装(タスク1-3)
type: project
---

home-tournament-timeline 改修（大会ピルの4値ステータス化・親 #649）のタスク1〜3を main が直接実装した（委譲なし＝3タスクとも小径 or 複数レイヤー跨ぎ）。worktree: C:/tmp/impl-home-tournament-timeline（branch feature/home-tournament-timeline。出荷済みの旧同名ブランチは ensure-worktree.sh が origin/main から作り直した）。

- タスク1 (#650, 30714a6): `home-timeline-utils.ts` に `deriveHomeEventStatus`（名簿確定 > 申込済 > 締切済 > 参加受付中）と `HOME_EVENT_STATUS_PILL`、`home-timeline-types.ts` に `HomeEventStatus`
- タスク2 (#651, 396ca0c): confirmed-roster-signal §3.2.5・confirmed-roster.ts 冒頭コメント・design-spec §4/§6/§8 を新仕様へ
- タスク3 (#652, 3e62b74): `upcoming-entrants.ts` に `entryStatus` を追加（出場者判定・外部APIは不変）、page.tsx で `loadConfirmedRosterStates` を1回呼んで status 導出、HomeTimeline の Pill 2箇所、`confidence`/`EntrantConfidence`/`confidenceLabel` 撤去、docs/spec/events-attendance.md のホーム画面節にステータスピルの段落

注意点・発見:
- ★「名簿確定」は「確定」を部分文字列に含む → `textContent` の `not.toContain('確定')` は原理的に書けない。旧文言不在（AC-11）は testing-library の exact マッチ（`within(row).queryByText('確定')`）で判定する。getByText は要素の**自分の**テキストノードだけで照合するので、チップ `<span>希望<span>C</span></span>` は `queryByText('希望')` に当たる → テスト会員の姓「希望」は「回答」へ改名した
- page.test の統合テストで締切を7日以内にすると未回答アラート行にも同じ大会名が出て `rowOf`（getByText）が複数一致で落ちる → 閲覧者を `isInvited: false` にしてアラートを止めた。1テスト5件以上の大会は「もっと見る」で隠れるので4件以下に分割
- ★視覚リスク（AC-17 未確認）: `info-bg #d2dee9` と `neutral-bg #d8dde2` はほぼ同色で fg も同じ #3d4958 → 「申込済」と「締切済」はトーンでは読み分けにくい可能性。トーンはユーザー決め打ち（requirements §7）なので実機で確認して要調整なら別途
- ローカル検証: Docker Desktop 未起動で DB 統合テスト（page.test.tsx 等）は未実行＝CI で確認。純関数・表示テストは globalSetup/setupFiles を外した一時 vitest 設定（apps/web 直下に置いて実行後削除）で green、tsc・eslint green
- Bash ヒアドキュメントに TS テンプレ（`'...'` と `%s` 混在）を入れると `unexpected EOF` で壊れた → Write ツールで scratchpad に .py を置いて実行（[[reference_design_mock_verification]] と同じ罠）
- ユーザー判断(2026-09-21・PR作成前): info/neutral 同色問題は「このまま進める」。success は brand と同色(#bdddff)・danger は朱禁止で、既存トーン内に4色目は無い。AC-17 の本番実機確認で見づらければ別の小改修で調整する
