---
name: impl_a2026_result_backfill
description: 2026年の協会HP掲載済み未取込16大会を本番へ backfill(2026-08-25)。t1601-1616・参加者4933・対戦10326・opp_null増分0。parseResultExcel の4つの落とし穴を実データで確認
metadata:
  type: project
---

# 2026年 未取込結果の本番 backfill（2026-08-25 実施）

協会HPに結果掲載済みでアプリ未取込だった **A群16大会（member-download 18ファイル）** を本番投入。
突合の経緯と未取込一覧は [[project_result_import_reality_audit]] と同日の調査（scratchpad `未取込大会_2026.md`）。

## 結果

- 新規 **t1601–t1616**（16行）/ classes +112 / participants +4,933 / matches +10,326 / players +467
- 本番件数 1,496→**1,512** tournaments、823,897→**834,223** matches
- **opp_null_normal は 773 のまま増分0**＝新規10,326対戦の相手を全件解決
- 高校選手権(個人戦) #48 の edition が無かったので **edition 1243 を新規作成**（他15件は既存 edition へ link）
- 30周年記念大会だけ **edition_id = null**（系列マスタに該当なし・一回性イベントのため作らない判断）
- 2026年の取込は 53→**69大会**、最新 event_date は 2026-06-27→**2026-08-11**

## ロールバック（INSERT のみ・既存行は無改変）

`DELETE FROM tournaments WHERE id > 1600`（cascade）/ `DELETE FROM tournament_series_editions WHERE id > 1242` /
players は `id > 48367` が新規（他大会から参照され得るので削除は要確認）。

## ★ parseResultExcel の落とし穴（実データで確認・恒久対処は未実施）

1. **相手セルの「不戦」** — 千葉4C 22件・中学生38 94件。`parseScoreCell` は**枚数セル**の不戦しか見ないので、
   相手セルに「不戦/不戦勝」が入る様式では status='normal' の**架空の相手への勝ち**になる。
   → 取込前に walkover へ正規化した。[[project_prod_result_health_audit]] の session8 と同じ種類の穴で、
   単字「不」に加え**相手列の不戦**が残っていた。パーサ本体の恒久修正は未着手。
2. **タブ名が中身と違う** — 高校48 D級ファイルの3枚目はタブ「C3級」なのに row0 は "D3"。
   className をタブ名から取るので C 級として入る（かつ 19128 の本物 C3 と衝突）。row0 を根拠に D3 へ補正。
3. **級カラムを級分割と誤認** — 中学生38 選抜の部は「級」列＝**選手個人の級**。パーサはこれをクラス分割と読み、
   さらに同名 className を跨シート merge するので **学年3ブラケットが A/B 2クラスに融合**した。
   → 「級」列を落として1シート1クラス（選抜3年/2年/1年・一般3年/2年/1年）に。相手未解決 14.3%→0%。
4. **同名 className の跨シート merge** — 30周年記念は「対戦結果（A級4段の部/5段/6段以上）」が全部 className "A" に
   潰れて1クラス237人へ融合（B・C も 8/8+8/9 が融合）。merge 自体は設計意図（級が複数シートに割れる様式のため）
   だが、**別ブラケットが同じ級名を持つ様式では誤融合**する。→ シート単位に明示ラベル（A(4段)/B(8/8) 等）。

## 原本側の不整合（捏造せずそのまま取込）

- 東京東会80 B級: カブリド泉愛の3回戦の相手 中山拓海 側に対応行が無い（原本の記載漏れ）。片側のみ記録。
- 高校48 C1級: 吉田瑞月の1回戦の相手セルに見出し文字列 "C1" が混入 → 相手側の行から一意に確定できるため
  「岸本 明莉」へ補正（`opponentFix`）。

## 検証（独立系統＝SSH psql で読み返し）

- 16件すべて classes/parts/matches が dry-run 計画と一致・orphan classes 0
- 対戦の対称性チェック（round+ペアで2行・勝者1）で異常は上記1件のみ
- 大会報告シートの入賞者と突合: 大分54 A級 優勝 中山拓海 5-0 / 堀本秋水 5-0・準優勝 野添美依奈 5-1、
  30周年 A(4段) 優勝 中川浩希・楊弘毅・鹿島夕希 各6-0 — いずれも一致。参加者数も報告書と一致（大分160・30周年581）
- 多室級（優勝が複数出る級）は `derived_bracket` が null＝導出不能の既定動作で正

## 使ったもの（すべて git 外／使い捨て）

- 原本: `c:/tmp/dq/a2026/{mdl_id}.{xlsx,xls}` + `index.csv`
- `scripts/diagnostics/_a2026_xls_grids.py` — **このマシンに LibreOffice が無く** readXlsBuffer が動かないため、
  python-calamine で .xls 2件のグリッドを reader.ts と同じ形へ抽出（[[feedback_libreoffice_ja_fonts]] は本番ホストの話）
- `scripts/diagnostics/_a2026_dryparse.mts` / `_a2026_inspect.mts` / `_a2026_inspect2.mts` / `_a2026_ingest.mts`
- ★ scripts/diagnostics に置いたスクリプトから `pg`/`drizzle-orm` は**解決できない**（root node_modules に無い）。
  `createRequire('<repo>/apps/web/package.json')` で drizzle を、db/materialize は apps/web への相対 import で解決。
  実行は `pnpm --filter @kagetra/web exec tsx ../../scripts/diagnostics/_a2026_ingest.mts`。

## 残り（今回対象外）

- **B群=団体戦3件**（各会対抗39・高校48団体・中学生28団体）: `tournament_series.kind` に team が1件も無く構造的に未対応
- **C群=名人位・クイーン位決定戦**: 結果がページ本文の「大会速報」テキストのみ（Excel/PDF なし）
- 開催済みだが協会HP未掲載の8月後半分は掲載後に再取込が必要
