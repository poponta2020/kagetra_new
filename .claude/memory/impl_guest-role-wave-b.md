---
name: impl-guest-role-wave-b
description: guest-role Wave B・完了
type: project
---

# guest-role Wave B（タスク6・7・8）+ 完了記録

worktree: `C:/tmp/impl-guest-role`・branch `feature/guest-role`。全8タスク完了・push 済み。

- タスク6（#486・f482724）申込作業からの除外 E1〜E5 ★核
- タスク7（#487・93dec2f）ホーム
- タスク8（#488・52432aa）ロール変更4択化
- AC-27/AC-30 の追加テスト（374c865）

## ★バリアで main が直した/足したもの

1. **`listAddableMembersAction`（申込書の手動追加ピッカー）にもゲスト除外を追加**。ワーカーが「AC-17 の文言は attend=true 限定・主な変更領域にも無い」としてスコープ外報告してきたが、**「ゲストは申込書に載らない」は経路ではなく成果物に対する要件**なので、自動抽出だけ塞いでも手動で選べば同じ xlsx に載る。E1 に含めた。
2. **AC-22 の後半（会員は名簿ベースのまま）にテストが無かった**。ワーカーのテストは「名簿会員1＋ゲスト1」だけで、**抽選に落ちた会員（名簿に載らない attend=true）**が居ない。合流を role で絞らず「名簿に居ない attend=true」で拾う実装だと落選会員が確定パスに復活するが、その回帰は元のテストを素通りする。落選会員ケースを追加。
3. **AC-23 のテストが誰の担当にもならなかった**（main のタスク6プロンプトが `events/**` を禁止領域に入れてしまったため。プロンプト側のミス）。main が `events/page.test.tsx` に一覧・アーカイブ両方のケースを追加。
4. **ホームのゲスト印がコントラスト不足**。チップ背景は `bg-surface-alt` で、隣の級添字は「10px では ink-meta (4.16:1) が足りないので neutral-fg (6.71:1)」とコメント付きで使い分けている。ゲスト印だけ ink-meta だったので揃えた。**大会詳細の参加者欄は `bg-surface` なので ink-meta のままでよい**（背景が違うので色が違うのが正しい）。
5. **`（0名）` は描画されない**（EntryBoardClient は `attendCount > 0 &&`）。ゲストのみ大会のテストが `toContain('（0名）')` で落ちたので `not.toMatch(/（\d+名）/)` へ。
6. **`HomeEntrant` に必須プロパティを足すと既存テストのリテラルが TS で落ちる**（typecheck は main のバリアでしか走らない）。

## ★共有 vi.fn() を `not.toHaveBeenCalled()` で見るとヒープが落ちる

AC-30 のテストで `broadcastMailToEventMock` を beforeEach でクリアせずに `not.toHaveBeenCalled()` を書いたところ、**同ファイルの先行テストが積んだ呼び出し引数（LINE 配信 payload）を pretty-print しようとして `RangeError: Invalid string length` → `FATAL ERROR: JavaScript heap out of memory` でプロセスごと落ちた**。テスト単体（`-t`）では通るのでファイル全体を回さないと出ない。**ファイル共有モックに対する否定アサーションは必ず mockClear とセットで書く。**

## AC の owner が手順書に無かったもの（main が担当）

AC-27（会員一覧のロール表示）・AC-28（通知）・AC-29（退会済みゲスト）・AC-30（管理系Action直呼び）・AC-36（JWT更新経路）はいずれも**実装変更ゼロ**で、既存の構造（roleViewLabel が正典・宛先クエリが admin アローリスト・node-jwt-callback がセッションごと無効化・requireAdminSession・selectableRoles）が担保している。テストで固定しただけ。

## ゲスト判定の一貫性

`isGuestRole()` 経由が49箇所、生の `role === 'guest'` は**コメント1箇所のみ**（実判定はゼロ）。許可リストの監査可能性を保つため今後もこの形を維持する。
