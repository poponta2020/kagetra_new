---
name: Auth.js v5 JWT strategy では user.id を OAuth sub に使わない
description: Auth.js v5 (JWT strategy, adapter なし) の user.id はサインイン毎のランダム UUID。OAuth sub は account.providerAccountId から取る
type: feedback
originSessionId: c3bdb6d6-a365-4060-b042-9b9416fce4c2
---
Auth.js v5 を JWT strategy + DB adapter なしで使うとき、sign-in コールバックに渡ってくる `user.id` は**毎回ランダムに生成される UUID**であり、OAuth provider の stable sub (LINE の U... / Google の sub 等) とは別物。

**Why:** 2026-04-23 に kagetra_new で実際に踏んだ。LINE ログインが毎回 `/self-identify` ループする問題を診断した結果、`token.lineUserId = user.id` が書かれていたため。観測:
- `id_token.sub` = `Ufcb14b319d87d2d44611beca524c138d`（正しい LINE ID）
- `account.providerAccountId` = 同上 ✅
- `user.id` = `fe7cbc03-...`（毎回違うランダム UUID）❌

**How to apply:**
- Auth.js v5 で OAuth provider の stable ID を使いたいときは `account.providerAccountId` を参照する（or `account` の `id_token` を手動 decode）
- `user.id` は adapter がある場合にのみ DB の internal user ID を指す — JWT-only 構成では未定義値扱い
- signIn / jwt callback のシグネチャで `user` は OAuth profile の結果を含むが、id フィールドは当てにならない。name/email/image は OK
- LINE provider に custom `profile()` を追加するアプローチは避ける（Auth.js が id を上書きする挙動が確認しにくい）。素直に `account.providerAccountId` を使うのが安全
- テストの edge mock も同じ原則で書く: 本番コードが `account.providerAccountId` を読むなら mock も同じ経路を再現する

関連 fix: PR #8 `fix/auth-line-user-id-from-account` (kagetra_new, 2026-04-23)
