---
name: ship-attachment-open-download
description: 添付ファイルの「開く・保存」導線と Excel プレビュー廃止
type: project
---

# 添付ファイルに「開く・保存」導線を追加し Excel のページ画像プレビューを廃止

**shipped: PR #581**（https://github.com/poponta2020/kagetra_new/pull/581 · merged 2026-09-04 · squash なし merge commit `9430517`）
クローズ: 親 #575 / 子 #576-#580（PR 本文の closing keyword で自動クローズ）

## 何を出したか
添付ビューア3画面（`/mail/attachments/[id]`・`/admin/mail-inbox/attachments/[id]`・`/roster-files/[id]`）に **OS へファイルを渡す「開く・保存」** を追加し、**Excel（xls/xlsx/xlsm）はページ画像プレビューを廃止**した。

- 新種別 `spreadsheet` を `attachment-preview.ts` に追加。xls/xlsx を `OFFICE_CONTENT_TYPES`・`DOCUMENT_EXTENSIONS`・`OFFICE_EXTENSION_BY_TYPE` の**3箇所すべてから削除**したので `conversionExtension()` が Excel を弾く。3本の preview route は `!== \x27document\x27` で 404 なので自動的に止まる。
- `components/attachment/OpenSaveButton.tsx`（client・3画面共有）: fetch → File → `navigator.canShare` → 共有シート / `<a download>` / 素のリンク の3段ラダー。
- **サーバー route は無変更**（fetch は Content-Disposition を無視するため）。`attachment-route-parity.test.ts` 無傷。
- 3画面から但し書き「iPhone のアプリ内からは…PC からダウンロード」を削除。

## レビュー（/auto-review-loop）
3ラウンド（initial sol/medium → delta terra/medium → final sol/medium）。累計 393,976 トークン（別途クォータ枯渇で失敗した1回分 145,401）。
- R1 blocker 1件 → **要件 §4.4 の実装漏れ**（共有もダウンロードも不可な環境への素のリンク）。修正 `3c43dcd`・AC-9c 追加。
- R3 blocker 1件 → **ユーザー判断で見送り（WONTFIX）**: `download` を持ちながら無視するブラウザ（LINE アプリ内ブラウザ等）を対応済みと誤判定する。実効性は原理的に検出不能でリンク常時表示しか手がなく、UI コストに見合わないと判断。
- 最終 verdict=cutoff（reason=user-wontfix）。**再レビューせずに修正した指摘は 0 件**。

## CI
`Lint / Typecheck / Test` が **15分ジョブ上限で cancelled**（アサーション失敗ではない。Lint ✓ Typecheck ✓、Vitest が 13:44 で切断）。同ブランチの1つ前のコミットでは Vitest 7:01 で完走していたため疑って**ローカルで全スイートを完走**させ、**247ファイル / 3559 passed・1 skipped・0 failed（9分00秒・exit 0）** を確認したうえで CI 完了を待たずマージした（v0.9.0 方針）。★このリポジトリの web スイートは 15分上限に対して余裕が小さい（ローカル9分・CI 7〜14分）。今後もランナー次第でタイムアウト打ち切りが起きうる。

## 残 DoD（出荷後にユーザーが実機で確認）
- AC-16 iPhone ホーム画面 PWA: Excel 添付 →「開く・保存」→ 共有シート → Excel で開く / ファイルに保存
- AC-17 Android Chrome で同様
- AC-18 PC ブラウザでそのままダウンロードされる
共有シートはローカルにも CI にも存在せず、テストで固定できたのは**ラダーの分岐だけ**。

## ship 時のトラブル
`/define-feature` の成果物をローカル main に直接コミットしていた（`66eab1d`）ため、マージ後に **ローカル main が origin/main と分岐**して `git pull --ff-only` が失敗した。並行セッション（PR #582）の未コミット変更も作業ツリーにあったので、退避 → `git reset --hard origin/main` → 復元で解消した。★worktree は origin/main 基点で切られるので、成果物をローカル main にコミットしても worktree には入らない（意味がないうえに分岐を生む）。/implement の worktree 側で cp+commit するだけでよい。
