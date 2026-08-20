---
name: impl-entry-group-page
description: entry-group-page 実装（タスク1-6）
type: project
---

entry-group-page（親#496 / 子#497-502）を worktree C:/tmp/impl-entry-group-page・ブランチ feature/entry-group-page で実装しコミット6本＋push まで完了（PR 未作成）。

## Wave 構成（並行実装）
- Wave1: タスク1（純関数3本）＋タスク2（Server Action）を task-implementer 2体で同時実装 → 変更領域の重複ゼロ
- Wave2: タスク3（グループページ本体）は main が直接実装（認可・RSC payload・複数レイヤー跨ぎ）
- Wave3: タスク4（日ページ/編集フォーム整理）＋タスク5（着地点の張り替え）を task-implementer 2体で同時実装 → 重複ゼロ
- Wave4: タスク6（正典ドキュメント整合）は main

## ★計画からの逸脱2件（どちらも locked な design-spec / requirements が勝った）
1. **「希望者なし」を撤回し「申込なし」に畳んだ。** 実装手順書 確定事項1 は classify の no_applicants を entryStatus で割り直して8語目を作る想定だったが、design-spec §2/§8 と requirements §3.3 が語彙を7語に固定しており「この画面だけの造語を作っていない」に反する。情報欠落は起きない（同じ行の参加希望者数 0名 が理由を示す）
2. **進行管理で EventLifecycleSection を再利用しなかった。** design-spec §4 は「そのまま移設・見た目不変」と書いていたが、レイアウトの正である design-mock/page-admin.html §④ に操作コントロールが1つも無く、§3 も「進行管理の中に日ごとのトグルを置かない」と定めている。現行コンポーネントは eventId 必須・単一状態しか語れず・アクション props 必須でこの形を描けない。表示専用の GroupProgressSection を新設し、EventLifecycleSection / GroupToggleDialog / EventEditSubmit / GroupDayLinks は参照ゼロになったので削除した（requirements §6 の「計画的に壊れる既存テスト」一覧はこの4件が不足していた）

## 実装で判明した地雷
- **編集フォームから input を消すと保存で DB が null 上書きされる。** extractEventFormData は欠けたフィールドを null として読むので、updateEvent の SET から共通8キーを rest 分割で明示除外しないと、グループページで設定した締切・振込先が日ページの保存のたびに消える
- **級別グループ配信は event 単位**（event_grade_broadcasts.event_id・対象級は各日の eligible_grades）。代表イベントだけに畳むと複数日グループで他の日へ配信する手段が失われるため、LineBroadcastSection の gradeBroadcast prop を日ごとの配列へ拡張した（1日だけのグループの描画は従来と同一）
- 進行状態を動かす5アクションが /events/[id] しか revalidate していなかった。一括操作の入口がグループページへ移ったので revalidateAfterLifecycleChange で /admin/entries/[groupId] と /admin/entries も捨てる

## ★残作業（ローカルテストが1件も走っていない）
Docker Desktop のエンジンが起動せず（com.docker.backend は上がるが docker ps/info が無応答）テスト DB 127.0.0.1:5434 に接続できないため、**vitest を1件も実行できていない**。ユーザー判断で「未実行のまま進める」を選択済み。typecheck（tsc --noEmit）は exit 0、変更ファイルの eslint は全てクリーン。検証は CI に委ねる。
