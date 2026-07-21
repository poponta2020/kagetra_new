---
name: tournament-lottery-trends-pr304
description: PR #304 delivery notes for tournament lottery trends, backfill safety, and review fixes
type: implementation
---

PR #304 implements tournament lottery trends across the shared schema, mail worker, administrator roster review, and authenticated series metrics UI.

- Eligibility/completeness comes from authoritative event grade scope; missing grade scope and partial grade coverage remain incomplete rather than being inferred from existing sources.
- A-grade cutoff calculations require an effective rule and rule-evidence reference. Under-capacity editions do not require a selection-result roster.
- Archive backfill draft staging is explicit (`--stage-roster-drafts --once`), bounded, idempotent, and holds the resume cursor at the failed source.
- Roster approval rejects mixed explicit and unresolved grades for multi-grade configurations and records an audited competition-category verification.
- Review rounds: r1 found seven correctness gaps; r2 passed after the staging-failure cursor regression test. CI passed before the final test-only commit; the final CI run must be green before shipping.
- Production migration and non-dry-run archive backfill were intentionally not executed by this implementation workflow.
