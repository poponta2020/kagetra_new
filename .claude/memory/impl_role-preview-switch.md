---
name: impl-role-preview-switch
description: role-preview-switch 全5タスク実装
type: project
---

role-preview-switch（管理者が UI から表示ロールを副管理者/一般会員へ落として実機で会員視点を確認する機能）の全5タスクを実装完了（2026-07-26）。worktree=C:/tmp/impl-role-preview-switch / ブランチ=feature/role-preview-switch。

## 実装したもの
- タスク1 #328 (64f884c): apps/web/src/lib/role-preview.ts（純関数）+ role-preview.test.ts + next-auth.d.ts（Session.user.realRole / JWT.viewAsRole）+ test-utils/auth-mock.ts（realRole 既定値）
- タスク2 #329 (e50ebda): auth.config.ts の session コールバックで実効ロール生成 + jwt の update 許可リストへ viewAsRole 追加 + auth-config-callbacks.test.ts
- タスク3 #330 (7f44365): app/(app)/role-preview-actions.ts（切替 Server Action）+ テスト
- タスク4 #331 (b1a011c): (app)/layout.tsx / mobile-shell / app-bar-main / account-menu の UI 配線 + テスト
- タスク5 #332 (5abeace): env テンプレート3つ + docs/spec/auth-admin.md + requirements.md の本番手順

## Wave 構成
Wave1=タスク1(main単独) → タスク2,3(main単独・逐次。認証認可の核なので委譲しない) → Wave3=タスク4,5 を task-implementer(sonnet) 2並行。変更領域の重複なし・排他宣言ミスなし。worker_verify:none のためワーカーはテストを書くだけ、実行は main が直列で実施。

## 実装中に判明した重要事項（次に効く）
1. **auth.config.ts の冒頭コメントが嘘**: 「Per-route rules (role checks) are enforced in middleware.ts」と書いてあるが、middleware.ts は req.auth のセッション有無と user.id しか見ておらずロール判定は一切していない。/403 ゲートは各 admin ページ・Server Action 側にある。要件の「middleware 変更不要」は正しかったが、コメントを信じると設計を誤る
2. **submit ボタンに onClick={close} を付けると送信が発火しない**: クリック処理中に setState → createPortal ごと form が DOM から外れると、ブラウザは既定動作（フォーム送信）を中止する。ワーカーの初版がこれを踏んでいた。シートを閉じるのはサーバー再描画後の prop 変化を useEffect で検知する形にした。既存の Link onClick={close} は Next の Link が自前で遷移するので無事だった
3. **unstable_update の引数は Session 型だが実体は JWT パッチ**: viewAsRole は Session の公開契約に無いので `as unknown as Parameters<typeof unstable_update>[0]` のキャストが要る（既存の lineUserId 更新箇所は Session に載っている型なのでキャスト不要だった）
4. **resolveEffectiveRole は realRole 未解決（token.role undefined）をそのまま素通しする**必要がある。'member' などへ丸めると /self-identify 前ユーザーの既存挙動が変わる（AC-18 の回帰）
5. **returnTo のオープンリダイレクト**: 切替後に現在パスへ redirect する（stale cookie 対策）ため returnTo をフォームで受けるが、//evil.com と /\evil.com を弾く sanitizeReturnPath が必須
6. 合成テスト（auth-config-callbacks.test.ts）で、既存の管理者専用 Server Action releaseChannel と管理画面 line-grade-groups/page.tsx をプレビュー中セッションで直接呼び、実際の会員と同じく拒否されることを実測（AC-7/AC-8）。推論で済ませていない

## 残
本番の残 DoD = /opt/kagetra/.env.production に ROLE_PREVIEW_USER_IDS を追記 → web 再起動 → 実機で AC-14/15/17 確認。手順は requirements.md §8。
並行作業: feature/entry-management が未マージ。mobile-shell.test.tsx が競合しうるのでマージ後にリベースする。
