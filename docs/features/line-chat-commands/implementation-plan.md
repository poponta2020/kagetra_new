---
status: completed
---
# line-chat-commands 実装手順書

## 技術設計の要点

- **スキーマ変更・マイグレーションなし。** 新規テーブル・新規カラムは無い
- **状態遷移は既存ロジックを再利用する。** 支払側は `lib/events/apply-payments-paid.ts` が既に切り出し済み（`admin/entries/[groupId]/actions.ts` が第2の呼び出し元として実証済み）。**申込側は `events/[id]/actions.ts` にインラインのままなので、同じ形へ切り出すのがタスク2**
- **メンション判定**は `mentionees[].isSelf === true` を第一とし、無い場合は `mentionees[].userId === line_channels.webhook_destination_id` で判定する（両方が本番で成立することを実測済み）
- **語の判定はメンション文字列を除去してから行う。** Bot の表示名自体が対象語を含むと、メンションしただけで発火してしまうため（`mention.index` / `length` で範囲が取れる）
- **返信は1メッセージイベントにつき1回だけ。** LINE の replyToken は単発。申込と支払の両方が返信対象になった場合は、**1回の reply に複数メッセージを載せる**（`LineReplyClient.reply` は配列を受け取る契約）。成功時は返信しないので replyToken は未使用のまま捨てる（「念のための no-op reply」を足さない）

## 実装タスク

### タスク1: チャットコマンドの解釈（純関数）
- [x] 完了
- **目的:** 発言テキストとメンション情報から「申込」「支払」の意図・否定の有無・Bot 自身がメンションされたかを判定する純関数を用意する
- **対応AC:** AC-8, AC-9, AC-10
- **主な変更領域:** `apps/web/src/lib/line-chat-command.ts`（新規）、`apps/web/src/lib/line-chat-command.test.ts`（新規）。DB にも LINE API にも触らない純関数として切る（`entry-fee.ts`（pure）と `entry-fee-tally.ts`（DB）の分離と同じ流儀）
- **依存タスク:** なし
- **必要なテスト:**
  - 語リストの全パターン（申込: 申込 / 申し込み / 申込完了 / 申込済 / 申し込みました / 申し込んだ、支払: 振込 / 振り込み / 振込完了 / 振り込みました / 入金しました / 支払いました / 払いました）
  - 否定形（「まだ申し込んでません」「振り込んでいない」「未入金」等）で `negated: true` になる
  - 両方の語を含む発言で申込・支払の両方が立つ
  - メンションが無い（`mention` が `null`）と成立しない
  - `isSelf` が無くても mentionee の `userId` が Bot の `webhook_destination_id` と一致すれば成立する
  - 他人へのメンションだけの発言では成立しない
  - **メンション文字列を除去してから語判定する**（Bot 表示名に「申込」が含まれるケースで誤発火しない）
- **完了条件:** vitest green・`tsc --noEmit` 通過
- **対応Issue:** #607

### タスク2: 申込 flip の lib 切り出し（挙動不変のリファクタ）
- [x] 完了
- **目的:** `setEntriesApplied` のインライン実装を `lib/events/apply-entries-applied.ts` へ移し、Server Action と webhook の双方から同じコードを呼べるようにする
- **対応AC:** AC-1 の土台, AC-14
- **主な変更領域:** `apps/web/src/lib/events/apply-entries-applied.ts`（新規）、`apps/web/src/app/(app)/events/[id]/actions.ts`（移設後の呼び出しへ置換）
- **依存タスク:** なし（**ただし `events/[id]/actions.ts` を触るのはこのタスクだけ**）
- **設計:** `apply-payments-paid.ts` と同じ形にする — `applyEntriesApplied(db, ids, opts)` と `applyEntriesAppliedInTx(tx, ids, entryGroupId)` の2段。トランザクション境界を呼び出し側が選べるようにする
- **★移設は verbatim。次を1つも変えない:**
  - 旧状態ガード付きの1件ずつ UPDATE（`WHERE entry_status='not_applied' AND entry_group_id=?`）
  - `cancelled` の再ガード（状態変更は記録するが claim 対象から除外する）
  - 同一 tx 内での2種類の独立 claim（`entry_applied` / `entry_applied_treasurer`）
  - **コミット後 push のエラー処理の非対称性** — 会計向けは throw 時に claim 済み行を `failed` で finalize し、参加者向けは握りつぶす。これは意図的な差（会計向けは文面組立が DB を引いて throw しうるため、finalize しないと通知が恒久的に失われる）。**「揃える」整理をしない**
  - `lockEventRowsAscending` による昇順ロック（revert 経路）
- 文面ビルダ `buildParticipantAppliedMessage` / `buildTreasurerAppliedMessage` も同時に移す（現状 `actions.ts` のモジュール private）。`buildPaymentPaidMessage` も webhook から使うので同様に共有可能な場所へ出す
- **必要なテスト:** 新規テストは書かない。**既存の `event-lifecycle-notify.test.ts` / `lifecycle-actions.test.ts` が無改変で green であることが回帰ハーネス**（文面はバイト互換で固定されている）
- **完了条件:** 上記既存テストを1行も変えずに green・`tsc --noEmit` 通過
- **対応Issue:** #608

### タスク3: LINE 発言者の認可解決
- [x] 完了
- **目的:** `source.userId`（LINE userId）から会員とロールを引き、アクションごとの実行可否を fail-closed で判定する
- **対応AC:** AC-3, AC-4
- **主な変更領域:** `apps/web/src/lib/line-chat-authz.ts`（新規）、同 `.test.ts`（新規）
- **依存タスク:** なし
- **設計:** `users.line_user_id`（UNIQUE）で1件引き、`deactivated_at IS NULL` を必須にする。許可表は「申込＝admin のみ／支払＝admin・vice_admin」。**`is_treasurer` は認可に使わない**（既存方針。`travel-report` の `authz.ts` が同じ規律のコメントを持っているので参照する）
- **必要なテスト:** admin / vice_admin / member / guest / `line_user_id` 未紐付け / `deactivated_at` あり の6系統。見つからない場合に必ず false を返すこと
- **完了条件:** vitest green・`tsc --noEmit` 通過
- **対応Issue:** #609

### タスク4: webhook への配線と返信
- [x] 完了
- **目的:** 大会グループの発言を解釈して実際に状態を進め、必要なときだけ返信する
- **対応AC:** AC-1, AC-2, AC-5, AC-6, AC-7, AC-11, AC-12, AC-13
- **主な変更領域:** `apps/web/src/lib/line-webhook-handler.ts`（招待コード分岐の後ろに追加）、`apps/web/src/lib/line-chat-command-reply.ts`（返信文面・新規）、`apps/web/src/lib/line-webhook-handler.test.ts`（統合テスト追加）
- **依存タスク:** タスク1, タスク2, タスク3
- **★グループの検証は新規のルックアップが要る:** `applyWebhookEvents` は `channelId` / `purpose` しか受け取っておらず、`event_line_broadcasts` を読んでいない（`handleInviteCode` は自前で引いている）。コマンド経路でも同じように broadcast 行を引き、**`status='linked'` かつ `line_group_id === event.source.groupId`** を必須にする（`handleInviteCode` の group-mismatch ガードと同じ規律）
- **処理順（★実装時に訂正した。旧順は AC-3/4/12 に反する）:** ①6桁招待コード（既存・先）→ ②`purpose='event_broadcast'` でなければ終了 → ③メンション判定 → ④語判定（意図の集合を作る）→ ⑤broadcast 行の検証（不成立なら**無言で終了**）→ ⑥アクションごとの認可 → ⑦認可されたアクションが0件なら**無言で終了** → ⑧否定表現の判定（あれば返信して終了）→ ⑨対象イベント解決（`entry_group_id` の `cancelled` でない全日の**事前スナップショット**）→ ⑩実行 → ⑪返信要否の判定
  - **★否定判定を認可の後ろへ移した理由:** 旧順（否定 → broadcast 検証 → 認可）では、一般会員が「@Bot まだ申し込んでません」と送ると「判定できなかった」と返信してしまい、`linked` でないグループでも同様に返信する。要件 §3.2.5 は「権限が無い / メンションが無い / 語を含まない」を**完全に無視（返信しない）**と定めており、AC-3 / AC-4 / AC-12 は「返信もされない」を検証する。認可を先に通すことでこれらが同時に満たされる
  - **★認可はアクションごとに絞る:** 副管理者が「申し込んで振り込みました」と送ったら、支払だけを実行し、申込については**何も返信しない**（要件 §3.2.3 の権限表と §3.2.5 の「権限が無い＝無視」の合成）
  - **★実行前スナップショットが必須:** `applyEntriesApplied` / `applyPaymentsPaid` の戻り値だけでは「すでに完了」（AC-7）と「対象が無い」（全日 `not_applying` / 事前払いゼロ）を区別できない（どちらも flip 0件）。⑨で各日の `id / eventDate / status / entryStatus / paymentType / paymentStatus` を控え、**スナップショット × flip 結果**で返信分岐を決める。AC-6 の「対象外の日」ラベルにも `eventDate` が要る
  - **★Bot の userId は `payload.destination` をそのまま渡す:** `loadChannelByDestination` が `webhook_destination_id` と突合している値そのものなので、チャネルの再ルックアップは不要
- **★`not_applying` の日は触らない。** 「全開催日が対象」だが、既存ガード `WHERE entry_status='not_applied'` により「今回は申し込まない」と決めた日は自然に除外される。**この WHERE を広げない**。全日が `not_applying` のグループでは「対象なし」の返信になる
- **必要なテスト:**
  - 管理者＋申込語 → 全日 applied・**返信ゼロ**（AC-1, AC-2）
  - 副管理者＋申込語 → 変化なし・返信ゼロ（AC-3）
  - 一般会員／未紐付け → 変化なし・返信ゼロ（AC-4）
  - 副管理者＋振込語 → advance の日だけ paid（AC-5）
  - 現地払い混在 → advance だけ paid ＋ 対象外を明示した返信（AC-6）
  - 全日 applied 済み → 変化なし・「すでに完了」返信（AC-7）
  - `grade_broadcast` チャネル → 何も起きない（AC-11）
  - `linked` でない／`line_group_id` 不一致 → 何も起きない（AC-12）
  - `cancelled` の日は通知対象から外れる既存挙動の維持（AC-13）
  - 申込・支払の両方が返信対象になったとき **reply は1回**（複数メッセージ）
- **完了条件:** vitest green・`tsc --noEmit` 通過・既存の招待コードのテストが無改変で green
- **対応Issue:** #610

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1, タスク2, タスク3** — 互いに依存なし。タスク1・3 は新規ファイルのみ、タスク2 だけが `events/[id]/actions.ts` を触るので変更領域は重ならない
- **Wave 2: タスク4** — Wave 1 の3つすべてに依存

## 出荷後

AC-15（本番の大会グループで実際にメンションして申込済みになることの確認）は manual。出荷後に本番で確認する。
