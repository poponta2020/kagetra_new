---
name: feature-def-home-status-pill
description: ホーム大会ピル4値ステータス化 要件定義(2026-09-21)
type: project
---

home-tournament-timeline 改修: ホーム(/dashboard)の大会ピルを「確定／希望」→4値ステータス(参加受付中/締切済/申込済/名簿確定)へ。要件承認 2026-09-21。

- 正典: docs/features/home-tournament-timeline/requirements.md（改修モードで新設。それまで design-spec が要件成果物で requirements.md は無かった）
- 判定（上から優先）: 名簿確定=申込グループが確定名簿あり(confirmed-roster.ts の4材料・entry_status 不問) → 申込済=entry_status='applied'(会内締切前でも) → 締切済=COALESCE(internal,entry)<today → 参加受付中(締切当日含む・両締切nullも)
- ★名簿確定はボードと同じ4材料（ユーザー判断「その大会が名簿確定フェーズに移ったら」）。名前チップの出所は不変なので、メール/手動フラグ/原本ファイルだけで名簿確定になったグループはピル=名簿確定・チップ=出欠ベース（落選者が混ざりうる）を承知の上で採用
- not_applying は新ステータスを作らず日付どおり・母集団不変（ユーザー判断）
- トーン: 名簿確定=brand/申込済=info/参加受付中=warn/締切済=neutral。design-screen は回さない（ユーザー判断）。朱は未回答アラート専用のまま
- 外部API(match-tracker)の confidence は不変（route が項目を明示詰め替え→upcoming-entrants へ entryStatus 追加は公開契約に出ない）
- confirmed-roster-signal の AC-14（出場者判定不変）は維持。§3.2.5 の「ホームでは希望表示」の文だけ同PRで書換
- AC 17件（auto-test 16 / manual 1=本番375pxの見分け）
- Issue: 親 #649 / 子 #650(T1 純関数) #651(T2 docs同期) #652(T3 配線・旧撤去)
- Wave1=T1+T2 並行、Wave2=T3(T1依存)。スキーマ変更なし
- ★page.test の superseded テストは会員の姓が'希望'でチップに希望が出る→旧文言不在の判定と衝突するので要注意
- 実装未着手（/implement home-tournament-timeline）
