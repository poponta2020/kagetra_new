---
name: impl-mail-body-link-card-wave2
description: mail-body-as-image 改修 タスク3・4（配信差し替え＋公開ページ）
type: project
---

mail-body-as-image 改修の Wave 2 = タスク3（配信経路の差し替え）・タスク4（公開の全文ページ）。**両方 task-implementer に並行委譲**し、main は事前に middleware の matcher 追加とその単体テストだけ自分で持った（1行の書き間違いで LINE から開いた全員がサインイン画面に飛ぶ最大リスク箇所のため）。バリア後に main が直列でテスト実行。

## 成果（コミット）

- 8746cb9 タスク3 (#597): line-broadcast.ts の MessageRole を lead_text/body_link/attachment_link へ。includeBody=true で getOrCreateMailBodyShareToken → mailBodyShareUrl → buildMailBodyFlexMessage を1通 push（try/catch で包まない＝失敗は監査行 failed）。buildBodyImageMessages・attachmentImageUrl・sharp 動的 import・setCachedImage/splitForLine/buildBroadcastBody の使用・mail-body-image-render.ts(+test) を撤去
- f97e594 タスク4 (#598): app/mail-share/[token]/page.tsx（(app) の外・force-dynamic・robots noindex・トークン形式ガード＋期限 join・access_count 加算・stripMailFooter 済み本文を pre で表示・エラーは全て同一案内）＋ middleware matcher に mail-share/ 追加

## 設計上ハマりやすい点（次に触る人向け）

- ★**AC-21 の実装は「消し忘れ」に見える比較**: layoutShrunk の `existingAudit.sentImageCount > currentImageCount` は currentImageCount を**リテラル0固定**で残す。body_image ロールが消えたので `roles.filter(r => r === 'body_image')` に書き換えると意図が消える。旧形式（sent_image_count>0）の部分配信行を再送したとき全件再送に倒すための唯一の仕掛け
- プレースホルダ送信（「(本文・添付ともになし)」）は**到達不能になったので削除**。includeBody=true なら本文カードが必ず1通積まれるため messages.length>=1 が保証される
- 【訂正】は**カードだけ**に付ける。トークンは mail_message_id に1行しか持てないので、トークン行にフラグを持たせると「通常配信→別イベントへ訂正再配信」で先の配信のカードから開いたページまで訂正表記になる
- AC-18 は**ページ単体テストでは検出できない**（ページ関数を直呼びするので matcher の漏れに気づかない）。middleware.test.ts で config.matcher[0] を RegExp 化し、/mail-share/<token>=false かつ **/mail・/mail/123=true**（除外語を mail と書き間違えたら会員メール画面ごと未認証化する逆方向の回帰）を assert する

## 検証結果（main 実行）

- vitest 101件 green: line-broadcast 18 / mail-share ページ 11 / middleware 16 / line-broadcast-guidelines 6 / event-grade-broadcast 50（AC-23 の他経路回帰）
- `pnpm --filter=@kagetra/web exec tsc --noEmit` exit 0
- git grep で renderBodyImageToJpegs / buildBodyImageMessages / mail-body-image-render の残存 0 件（.claude/memory の履歴を除く）
- **未確認**: AC-16 の Cache-Control: no-store 実ヘッダ・AC-13 の「未ログインで 200」の実挙動（RSC 単体テストでは観測できない）。AC-25 の本番実機確認とあわせて出荷後に確認する
