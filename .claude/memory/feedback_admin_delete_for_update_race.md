---
name: feedback_admin_delete_for_update_race
description: 「参照ゼロを確認してから削除」は READ COMMITTED で race る。親行を FOR UPDATE ロックして直列化
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5ed5165b-5b38-47e8-88b8-40611e385967
---

「子テーブルに参照が無いことを確認してから親行を hard delete する」処理は、tx 内でも PostgreSQL 既定の READ COMMITTED では穴がある。参照チェック(SELECT 群)と DELETE の間に別 tx が CASCADE / SET NULL 対象の参照行を挿入でき、その後 DELETE が走ると「参照があれば拒否」の仕様に反して履歴が静かに消える。

**Why:** SELECT は確認時点のスナップショットしか見ず、行ロックを取らない。子への FK 挿入は親行の FOR KEY SHARE を取るだけで、親の SELECT とは競合しない。

**How to apply:** tx 冒頭で対象の親行を `FOR UPDATE` でロックしてから参照チェック→DELETE する。FK 挿入は FOR KEY SHARE を要求するため FOR UPDATE と競合して DELETE コミットまで待機し、コミット後は FK 違反で弾かれる。Drizzle では `tx.select({id}).from(t).where(...).for('update')` で 0 行ならその時点で拒否。Codex auto-review PR #147 R2 で実害指摘。詳細は [[impl_admin_member_create]]。
