---
name: ship-disable-overscroll-bounce
description: スクロール端のラバーバンド無効化
type: project
---

fix(ui): スクロール端のラバーバンド（ばね挙動）を無効化する — PR #456

- URL: https://github.com/poponta2020/kagetra_new/pull/456
- マージ: 成功（main へ merge、リモート/ローカルブランチ・worktree 削除済み）
- クローズした Issue: なし（/quickfix 起点・Issue なし）

## 症状と原因

画面を上下に引っ張ると端でゴムのように伸びて戻る（iOS/Android 既定の overscroll bounce / ラバーバンド）。リポジトリ内に `overscroll` 系の指定が一切なく（grep ヒット 0）、ブラウザ既定の挙動がそのまま露出していた。発生源は 2 系統ある — ドキュメント自体のバウンス（iOS Safari はスクロール不能なページでも document を弾ませる）と、実スクローラーである `<main>` 内側のバウンス。**片方だけ潰しても消えない**のがこの修正の勘所。

## 変更ファイル

- `apps/web/src/app/globals.css` — Baseline に `html, body { overscroll-behavior: none; }`。ドキュメント側のバウンスと、Android Chrome の引き下げリロード（pull-to-refresh）を無効化
- `apps/web/src/components/layout/mobile-shell.tsx` — `<main>` に `overscroll-none`（スクローラー内側のバウンス＋親へのスクロール連鎖）
- `apps/web/src/components/layout/mobile-shell.test.tsx` — `overscroll-none` の回帰ガード追加（8 tests green）
- `docs/design/design.md` — §3 グローバル構造にスクロール方針を追記
- コミット: cbc105f

## 既知の制約・残 DoD

- `overscroll-behavior` は **iOS Safari 16 以降**のサポート。それ以前の iOS では効かない（止めるには body を `position: fixed` にする構造変更が要る）
- ボトムシート系モーダルの内部スクローラーは今回対象外
- **残 DoD: 本番実機確認**（iOS Safari / ホーム画面 PWA / Android Chrome で上下に引っ張ってもばねが出ないこと）。静的解析とテストのみで検証しており実機未確認
- Tailwind v4.2.2 が `overscroll-none` → `overscroll-behavior: none` を出力することは dist から確認済み（未定義ユーティリティの無言握り潰し対策）

## レビュー

auto-review-loop 1R（initial のみ）/ verdict=pass / blockers 0・should_fix 0・nits 0 / model=gpt-5.6-sol effort=low / 累計 35,607 トークン。打ち切り・WONTFIX・未再レビューの修正はなし。CI は pending のままマージ（v0.9.0 方針。赤なら追修正）
