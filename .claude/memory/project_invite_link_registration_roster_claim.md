---
name: feature-def-invite-link-registration-roster-claim
description: invite-link-registration 改修: 名簿から選んで紐付け 要件定義(2026-09-21)
type: project
---

invite-link-registration の改修（2026-09-21・改修モード）。名簿に行がある会員（2026-09-08 一括投入の26名など・LINE未紐付け）が、同じ招待URLから「名簿から選ぶ」で自分を選んで紐付け、サークル所属＋学部区分・学部等名・学年だけを入力する。/self-identify にも同じ入力をつける。「新しく登録する」で名簿の候補と同名なら名簿へ誘導する。正典=docs/features/invite-link-registration/requirements.md（生きた仕様として書き換え。design-spec なし＝ユーザーがデザイン工程を省略し実装側に一任。画面の組み方は requirements 末尾）。

**主要な判断**
- 住所・電話・生年月日などは全日協へ届け出た値そのものなので、入力欄も出さず、画面にも出さない。
- 候補一覧でクライアントへ渡すのは id・氏名・電話/生年月日が空かどうかの真偽値だけ（誤選択で他人の PII が見えるのを防ぐ。級も出さない＝既存の self-identify の方針に揃えた）。
- 電話・生年月日は、サークル所属ON かつ DB が空のときだけ聞く（本番では佐々木涼花の電話のみ該当）。
- 更新してよい列をホワイトリストで固定（紐付け3列・サークル4列・空だった phone/birth・updated_at）。AC-4 は列挙でなくホワイトリストで書いた（role 等の取りこぼし防止）。
- 紐付けと保存は1回の送信で同時に行う（途中離脱で未入力のまま紐付く状態を作らない）。
- line_link_method は経路で分ける（招待URL=invite_link / self-identify=self_identify）。
- S2 は候補1人以上なら2択を先に出す（既定の選択なし）。候補0人なら従来のフォームだけ。
- 紐付け済み7名の学部・学年は Non-goal（管理者が一括編集で入れる）。表記ゆれ（山﨑/山崎）の同名検出も Non-goal。
- 技術面: migration なし。lib/roster-claim.ts で「候補条件つき FOR UPDATE → DB の空欄の印で検証 → 候補条件つき UPDATE」を1トランザクションで行う。validateBirthDate と電話の検証は lib/profile-validators.ts へ挙動を変えずに移す。A-flat 部品は components/register/flat-fields.tsx へ切り出す。self-identify の action は useActionState 型へ変え、既存の actions.test.ts は AC-8 に合わせて書き換える（承認済みの仕様変更）。E2E の seedInvite の発行者は、未紐付けだと候補に入ってしまうので lineUserId を入れて候補から外す（既存の登録ケースを無変更で通すため）。

**AC**: 16件すべて auto-test（変更点12・回帰4。E2E は CI）。
**Issue**: 親 #653 / 子 #654 T1 共通モジュール・#655 T2 フォーム部品（Wave1 並行）・#656 T3 /register 組み込み・#657 T4 /self-identify 組み込み（Wave2 並行）・#658 T5 E2E（Wave3）。
**背景の本番事実（2026-09-21 読み取り照会）**: users 33行のうち LINE 紐付け済みは7名。有効な招待リンクは0件（11件すべて期限切れか取消済み・ゲスト用は未発行）。サークル所属・学部・学年・サークル長・副連絡責任者は全員未設定。実装・出荷済み（PR #660・2026-09-21。記録=project_ship-invite-link-registration-roster-claim.md）。
