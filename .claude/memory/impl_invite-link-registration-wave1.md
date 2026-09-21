---
name: impl-invite-link-registration-wave1
description: invite-link-registration 名簿紐付け Wave1(T1+T2)
type: project
---

invite-link-registration 改修（名簿から選んで紐付け）の Wave 1 = タスク1（#654 共通モジュール）+ タスク2（#655 フォーム部品）を task-implementer 2並列で実装。worktree=C:/tmp/impl-invite-link-registration、branch=feature/invite-link-registration。コミット 9bd12c1（T1）/ ae476f8（T2）。

**変更ファイル**
- T1: apps/web/src/lib/profile-validators.ts(+test)・roster-claim-input.ts(+test)・roster-claim.ts(+test)、register/[token]/actions.ts（validateBirthDate/電話検証を lib へ移し、会員用・ゲスト用の2か所を差し替え。挙動不変）
- T2: apps/web/src/components/register/flat-fields.tsx（A-flat 部品をマークアップ不変で切り出し）・RosterClaimForm.tsx(+test)、register-form.tsx（import 置換のみ）

**受け入れ確認**: 両ワーカーとも仕様どおり。T1 は候補条件が FOR UPDATE の SELECT と UPDATE の両方にあり、set は明示列挙、所属 OFF で学部等に触れない。T2 が足した未使用の placeholder prop は main が削除。バリア後に main が対象6ファイルを直列実行 → 2件失敗:
1. roster-claim.test の期待集合に phone が抜けていた（テスト側の誤り。電話が空の候補なので phone も変わる）→ 修正
2. **RosterClaimForm でエラー後にラジオの checked が外れる** — React 19 は <form action> の完了後に form.reset() をかけ、react-dom は controlled の checked を defaultChecked に反映しない（initInput がマウント時にだけ設定）ため、ラジオ・チェックの見た目がマウント時の値へ戻る。テキストは value 属性が同期されるので残る。放置すると所属 OFF のまま再送信され得る → onSubmit + preventDefault + startTransition(() => formAction(fd)) に変更して解消
修正後 35 件 green、check-types・eslint 通過。

**発見した既存不具合 → 同じ PR で修正（c071e7a）**: 既存の RegisterForm も同じ仕組みで、エラー後に級ラジオ・サークル所属チェックが見た目だけ外れ、再送信で grade=null・所属 OFF の行ができていた（一時テストで実測）。名簿の候補と同名→名前を直して再送信が主要導線になるため別タスクにせず同梱。会員用・ゲスト用とも onSubmit + startTransition へ。回帰テストは修正前コードで落ちることを確認済み。

**Wave 編成メモ**: 並行中は T2 が T1 の新規ファイル（roster-claim-input.ts）を import type するため、T2 に検証コマンドを渡さず『そのファイルは作らない・未解決でも止まらない』と明記して衝突なし。電話・生年月日の必須条件は requirements どおり isCircleMember && needsX（手順書の記述は所属条件が抜けていた）。

**環境**: Docker Desktop が停止していたので main が起動（テスト DB は kagetra-db-test）。worktree には .env・packages/shared/.env・apps/web/.env.local をコピーし pnpm install 済み。
