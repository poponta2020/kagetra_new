---
name: impl-tournament-lottery-trends-task8
description: Mailbox-year resume cursor, deterministic report semantics, and production approval gates
type: implementation
---

Task 8 added resumable mailbox-year lottery roster backfill reporting and read-only source coverage.

- Use --resume-after-uid with the prior report nextAfterUid; a fetch/parse failure blocks cursor advance past that UID.
- successfulClassifications means deterministic grade and roster-type metadata only, never approval or publication.
- --lottery-coverage-report treats unknown categories and missing confirmed/result sources as incomplete without guessing.
- Production migration, non-dry-run fetch, bulk draft creation, and draft approval require separate explicit approvals.
- Canonical operating procedure: docs/data-quality/tournament-lottery-backfill.md.
