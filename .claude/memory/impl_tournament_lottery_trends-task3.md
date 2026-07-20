---
name: impl-tournament-lottery-trends-task3
description: tournament-lottery-trends Task 3
type: implementation
---

Task #298 added mailbox-scoped roster candidate discovery and draft parsing.

- Mailbox now propagates from CLI through LiveMailSource to ImapClient, with INBOX as the default.
- Archive dry-run accepts mailbox, received-year bounds, and finite candidate/AI limits. It returns deterministic counts without DB writes, attachment extraction, or AI calls.
- Message-ID uniqueness remains the cross-mailbox idempotency key.
- Added roster_parse job payload validation, stale recovery, extract-only dispatch, and a runner that creates idempotent attachment/body drafts.
- Candidate classification uses subject, body, and filenames and excludes obvious blank forms.
- Excel parsing reuses the existing reader for xls/xlsx/xlsm and consumes every name-bearing sheet. PDF, Word, and body text stay pending review when text exists; unreadable sources are parse_failed.
- Duplicate normalized names within a grade preserve every entry and create a structured duplicate_name_grade validation issue in a pending-review draft.
- Per-source parse failures are isolated.
- Review found and fixed the duplicate-to-parse_failed contract mismatch.
- Verification: full mail-worker suite 38 files/446 tests before the review-only duplicate adjustment, then focused parser/runner 8 tests, mail-worker typecheck, focused ESLint, and diff check passed. The final full suite is deferred to the repository DoD pass.
- Dedicated database: kagetra_test_lottery_298. Production and real Yahoo Mail were untouched.
- Real archive behavior was covered by injected/fixture tests; legacy xls still depends on the existing LibreOffice path.
- Worktree: C:/tmp/impl-tournament-lottery-trends
