---
name: impl-mail-inbox-mailer-unified-form
description: mail-inbox-mailer 統合処理フォーム 実装
type: project
---

mail-inbox-mailer 2026-08-02 改修（メール詳細の統合処理フォーム）を全6タスク実装。親 Issue #440 / 子 #441-446。worktree=C:/tmp/impl-mail-inbox-mailer・ブランチ feature/mail-inbox-mailer（初版の同名ブランチが merged 状態で残っていたので origin/main へ reset して再利用）。

## 実装（Wave 構成と委譲）
- タスク1（main 単独）: mail_kind enum + mail_messages.mail_kind、event_broadcast_messages.include_body。migration 0055。★実装手順書は Wave1={T1,T2} だったが、スキーマ変更+drizzle 生成は profile の conventions で main 担当なので T1 を単独に切り出した（Wave 編成の修正）
- Wave={タスク2, タスク6}: task-implementer(sonnet) 2並列。受け入れ確認で差分・テストとも問題なし。ワーカーにはテストコマンドを渡さず（worker_verify: none）、バリア後に main が直列実行
- タスク3（main 単独）: line-broadcast の includeBody
- タスク4（main 単独）: processMail / undoTriage 拡張 / adoptRosterFileTx 抽出
- タスク5（main 単独）: MailProcessForm / GroupPickerSheet / 詳細ページ差し替え / e2e 2本更新

## 設計上の要点（後から効く判断）
- **adoptRosterFile は export を維持**した。processMail 経由に置き換わって UI 呼び出しは無いが、adoptRosterFileTx のグループ検証契約テスト30件（同一行AND・級集合・cutoff・団体戦のみ）の入口。死にコードに見えるが消すとその契約の直接テストが失われる
- **代表イベント（linked_event_id）は「cutoff 以降 ∧ 非 cancelled」の日だけから選ぶ**。selectRepresentativeEvent は cancelled/cutoff を見ないので、グループ単位の候補判定を代表1件の validateLinkableEvent で代用すると候補に出ているグループを弾く
- **lineLinked の述語は loadActiveBinding と完全一致**（status='linked' ∧ lineGroupId 非空）。SQL の IS NOT NULL ではなく TS 側の truthy 判定に合わせる
- **include_body は prefix-skip 経路（!force ∧ 既配信あり）で args より保存値を優先**。args を信じると再送で列が変わり読み飛ばし位置がずれて本文が永久に欠落する。監査行に保存するのも「実際に列を組んだ値」。この回帰テストは変異検証済み（保存値優先を外すと sentImageCount 1→0 で落ちる）
- **空メッセージ列の skipped は監査行を terminal に落としてから返す**。CAS upsert で既に sending になっているので、落とさないと15分の stale reclaim まで行がロックされる（binding_changed の先例と同じ形）
- **AC-19 は linked_event_id の NULL 判定だけでは足りない**。「このメールの添付が別グループへ採用済みでないこと」も tx 内で検証（undoTriage が添付集合で削除するのと同じ不変条件の両端）
- process-candidate-utils.ts は client-safe leaf。toRosterAdoptGroup が団体戦の日を落として adoptRosterFile の級集合と母集団を揃える

## 忠実度ゲート
design-spec §忠実度チェックリスト全11項目を静的照合。1件（選択済み大会チップの2行目に申込状態）が未達だったので実装で修正（formatGroupEntryStatus を純関数へ切り出して候補行と共用）。実機の375px 目視は未実施。

## 意図的な仕様上の判断（レビューで指摘されうる）
- 級チップは A〜E の5個を出すが、グループの対象級以外は disabled にした（design-spec は「5個」としか書いていない。押せるとサーバーが必ず弾くため）
- 発表日は mock の placeholder 入り text ではなく type=date + 説明文にした
- 「試合結果の取込」はフォーム外（処理済み/draft進行中）でも mail_kind が未選択なら出す。フォーム内だけにすると処理済みメールから結果取込ができなくなる退行になる
- 名簿種別で採用可能な添付があるのに未選択のときは実行を止める（サーバーは許容するが「採用したつもりで何も採用されない」を防ぐ）

## テスト
mail-inbox 一式 + line-broadcast + events/[id] actions = 14ファイル357件 green。web typecheck / 対象 eslint とも green。E2E は CI 委譲（ローカル未実行）。
★タスク4のコミット単体では web typecheck が通らない（mail/[id]/page.tsx と撤去コンポーネントがタスク5で差し替わるため）。ブランチ HEAD では green。
