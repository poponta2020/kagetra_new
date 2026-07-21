---
name: impl-tournament-lottery-trends-task1
description: Task 1 schema, migration, decisions, and verification
type: implementation
---

# Task 1: tournament lottery source schema

- Added versioned rosters, selection outcomes/exemptions, confirmed-roster publications, active edition/grade lottery facts, roster import drafts, competition categories, and the roster_parse job kind.
- Generated and rehearsed migration 0041 against a pre-migration schema while preserving legacy roster data as version 1.
- Kept source pointers nullable with ON DELETE SET NULL for audit continuity; edition-owned facts/publications cascade.
- Added schema, DB constraint, cascade/set-null, enum, and worker job tests plus canonical DB design updates.
- Review input: explorer mappings confirmed migration 0041 and existing conventions; advisor recommended version uniqueness, publication union semantics, short PostgreSQL identifiers, and approval-layer source validation.
- Edge cases resolved: persisted source_kind prevents attachment/body draft uniqueness collision after attachment deletion; explicit short FK names avoid PostgreSQL identifier truncation for new constraints.
- Verification: shared 23 tests, lottery schema DB 6 tests, mail-worker jobs 11 tests, shared/web/mail-worker typechecks, root lint, and migration rehearsal all passed.
- Worktree: C:/tmp/impl-tournament-lottery-trends
