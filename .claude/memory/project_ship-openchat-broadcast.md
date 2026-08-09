---
name: ship-openchat-broadcast
description: openchat-broadcast 出荷
type: project
---

**PR #469** feat(openchat): 大会オープンチャットの抽出・LINE 配信 — https://github.com/poponta2020/kagetra_new/pull/469
マージ成功（2026-08-09。main = 9467e24）。親 Issue #457 と子 #458〜#468 は closing keyword で自動クローズ済み。

## 何を出したか
主催者メールから当日用 LINE オープンチャットの招待 URL を**決定的に**（AI なし）抽出し、管理者が確認・確定してから大会別 Bot グループへ **Flex 1通**で配信する。LINE を見逃した会員は大会詳細から同じ URL を辿れる。

- migration **0056**: `entry_group_open_chats`（UNIQUE(entry_group_id, url)・sort_order が表示順の正）と `entry_group_open_chat_broadcasts`（**UNIQUE を持たない追記専用ログ**）
- 抽出3段: Tier1 直リンク / Tier2 短縮URL（未検証印） / Tier3 QR（sharp→jsqr。PDF・Word はページ画像化を既存経路で再利用）。改行で割れた URL の復元つき、**fetch を呼ばない**ことをテストで担保
- 保存単位は申込グループ。級・開催日・自由ラベルの3属性＋パスワード。**最終ラベルの重複を保存前に禁止**（部門別で同名ボタンが並ぶ Flex を防ぐ）
- ★**`event_broadcast_messages` には一切書かない**（§6 の契約）。同表の UNIQUE(event_line_broadcast_id, mail_message_id) は「1メール=1配信」を強制し「再配信は毎回全件」と両立しないため

## レビュー（auto-review-loop 2回起動）
1回目は R2 で Codex 利用上限により中断。クォータ回復後に再実行し **5R(i+d2+f+fd) で pass**。blockers 累計 **9件（R1）+ 2件（R2）+ 3件（final）= 14件**を修正、WONTFIX 4件。
詳細は [[auto-review-round-pr469]]。とくに重要だったのは:
1. `'use server'` から export した読み取りヘルパーに認可ガードが無く、未ログインで任意グループの招待 URL・パスワードが取れた
2. **UI 経路でしか出ない不具合を2度踏んだ** — 再配信が保存済み URL の再 INSERT で必ず UNIQUE 違反（R1）→ 直したが失敗経路だけ抜けていた（final）
3. 過大な Flex ペイロード → LINE 400 → 復旧処理が**正常な紐付けを revoke** → 以降のメール配信まで停止。文字数上限では抜けられ、実 JSON の**バイト長**検証が必要だった
4. 信頼できない添付画像の RGBA 展開で 1GB 超確保 → Web プロセス停止
5. コンポーネント再利用で大会Aの保存済みを見ながら大会Bへ全件配信できた

**「修正したが再レビューしていない指摘」は無し**（final-delta まで通して pass）。

## 検証
ローカル 630 passed / 31 files・check-types（全4パッケージ）・lint green。**CI は pending のままマージ**（v0.9.0 方針。赤くなったら追修正）。

## ★残 DoD（本番で消化する。放置すると実害化する）
- **AC-15**: 本番相当環境で QR 入り PDF を実際に通す。素材＝本番 mail#134/#136（京都大会「下記QRコードから」）または #176（高校選手権「右QRコードより参加可能」）の添付。読めなければ**失敗として記録し**、`renderPdfToJpegs` への DPI 引数追加か zxing-wasm 差し替えを**別 Issue** に起票する（本 PR では既存レンダリング経路を触っていない）
- **AC-46**: **検証用グループ**（本番の会員グループではない）へ1回 push し、Flex の表示・ボタンタップでオープンチャット参加画面へ遷移・パスワード行が読めることを確認する。**長いラベルのケースも含めること** — `LABEL_MAX_LENGTH=20` は LINE の公称上限が未検証のため保守側に倒した値で、実際の上限をここで確かめる
- 忠実度チェックリスト「375px で URL が1行省略され横スクロールが出ない」は **コード照合のみで実描画は未確認**
- LINE Flex に等幅フォント指定のプロパティが無いため、パスワード行のモノスペースは**プラットフォーム制約により未達**（色・背景は再現済み）
