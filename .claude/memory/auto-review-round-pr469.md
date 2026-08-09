---
name: auto-review-round-pr469
description: auto-review PR #469
type: project
---

PR #469 (openchat-broadcast) の auto-review-loop 記録。**収束（pass）**。

## 経緯: 2回起動している
1回目は R1（全差分・high）で blockers 9 → 修正7/見送り2 まで進めたが、**R2 で Codex の利用上限に到達して中断**（result=codex-error）。ユーザー判断でクォータ回復を待ち、2回目を最初から回した。以下は2回目（正典）。

## ラウンド構成: i + d + f + fd（4ラウンド）
| R | PHASE | model / effort | 差分 | verdict | B/S/N |
|---|---|---|---|---|---|
| 1 | initial | gpt-5.6-sol / high | 5621行 30ファイル | needs_changes | 4/2/0 |
| 2 | delta | gpt-5.6-terra / medium | 848行 7ファイル | needs_changes | 2/0/0 |
| 3 | delta | gpt-5.6-terra / medium | 189行 3ファイル | **pass** | 0/0/0 |
| 4 | final | gpt-5.6-sol / high | 6038行 30ファイル | needs_changes | 3/0/0 |
| 5 | final-delta | gpt-5.6-terra / medium | 248行 | **pass** | 0/0/0 |

effort=high は構造的高リスクパス（schema・drizzle）起因のため initial / final とも維持（sol 較正の対象外）。
既定除外: docs 5件・drizzle meta snapshot・_journal.json・pnpm-lock.yaml。

## 見送り（WONTFIX・ユーザー判断。全ラウンドで再掲禁止として申し送り済み）
- push 前の永続的な配信試行記録（sending→sent の2段書き込み）— 管理者が実質1名で、push 受理直後に落ちる確率が極めて低く実害も「カードが2回届く」程度
- 再配信確認の TOCTOU / **ラベル重複検査・保存の行ロック**— 管理者は基本1人で同時操作の可能性が極めて低い
- 配信履歴テーブルの複合インデックス — 年間数百行規模で migration を切るコストに見合わない
- LINE の 4xx をペイロード起因とそれ以外で区別して復旧処理へ渡し分ける — 保存前・push 直前の Flex バイト長検証で過大ペイロードを送らないことにより実質塞いだ

## ★このループで見つかった重要な穴（すべて修正済み）
1. **'use server' からの export は全て公開エンドポイント** — 読み取りヘルパーに認可ガードが無く、未ログインで任意グループの招待 URL・パスワードが取れた
2. **UI 経路でしか出ない不具合を2度踏んだ** — 再配信が保存済み URL の再 INSERT で必ず UNIQUE 違反（R1）→ 修正したが失敗経路だけ抜けていた（final）。Action 単体テストは green のまま
3. **過大ペイロード → LINE 400 → 復旧処理が正常な紐付けを revoke** → オープンチャットだけでなく以降のメール配信まで停止。固定の文字数上限だけでは多バイト URL で抜けられ、実際に組んだ Flex の**バイト長**検証が必要だった
4. **信頼できない添付画像の RGBA 展開で 1GB 超確保** → Web プロセス停止。sharp の既定上限（2.68億px）では防げない
5. **コンポーネント再利用時の状態持ち越し** — 大会Aの保存済みを見ながら大会Bへ全件配信できた

## 学び（次回に効く）
- **Codex は同じ PR を2回通すと別の層のバグを見つける**。R1（実装直後）は認可・データ整合、final（修正後）は UI の状態遷移に指摘が寄った。final を省略していたら 5 の事故が残っていた
- **Codex の指摘が常に正しいわけではない**: R2 の「未使用 import が lint を失敗させる」は、指摘（未使用）は正しいが結論（lint/CI が落ちる）は誤り — 実際に eslint・check-types とも green だった。実行して確かめてから直すこと
- **high effort × 5000行超は1回で数分〜8分**。10分の Bash タイムアウトでは完走しないことがあり、run_in_background + 結果ファイル待ちが必要
- テスト DB（Docker）が落ちていると DB を使わない純関数テストまで global-setup で落ちる
