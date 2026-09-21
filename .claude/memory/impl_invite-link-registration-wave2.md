---
name: impl-invite-link-registration-wave2
description: invite-link-registration 名簿紐付け Wave2(T3+T4)
type: project
---

invite-link-registration 改修の Wave 2 = タスク3（#656 /register 組み込み）+ タスク4（#657 /self-identify 組み込み）を task-implementer 2並列で実装。worktree=C:/tmp/impl-invite-link-registration。コミット 88dcb14（T3）/ 253eb81（T4）。

**変更ファイル**
- T3: register/[token]/actions.ts（claimViaInvite 新設・会員用の同名衝突で hasRosterCandidateNamed なら suggestRoster。ゲスト分岐は不変）・page.tsx（会員用かつ候補1人以上で MemberRegisterEntry）・member-register-entry.tsx（新規。role=radio の自作2択＋補助文 aria-describedby）・register-form.tsx（onSwitchToRoster と「名簿から選ぶ」ボタン）・actions.test.ts / register-form.test.tsx（追加のみ）・page.test.tsx（新規。AC-2 は要素ツリーの MemberRegisterEntry の props.candidates のキーと DOM 本文の二段で検証）
- T4: self-identify/actions.ts（useActionState 型へ・claimRosterMember に委譲・エラーは state）・page.tsx（searchParams のエラー表示撤去・RosterClaimForm）・candidate-list.tsx 削除・actions.test.ts 書き換え・page.test.tsx 新規
- main: docs/spec/auth-admin.md（「名簿からの紐付け」を正典として新設、/register 分岐4・フロー・API に claimViaInvite）・docs/spec/players.md（self-identify は auth-admin の節を参照）

**受け入れ確認**: 両ワーカーとも仕様どおり。バリア後 main が対象9ファイル直列実行 → 1件失敗: self-identify の所属 ON テストで候補の birthDate が createUser 既定の null のため『生年月日を入力してください』が返った（仕様どおりの挙動・テスト側の前提漏れ）→ 候補に phone/birthDate を入れて修正。167件 green、check-types・eslint 通過。

**注意点（次に効く）**: createUser の既定は isInvited:true・lineUserId:null なので**招待の発行者も名簿の候補になる**。候補の件数・並びに依存するテストと、E2E の seedInvite の発行者には lineUserId を入れること（T5 で対応）。
