---
name: impl-tournament-lottery-trends-task2
description: Task 2 implementation decisions, tests, and verification
type: implementation
---

# Task 2: versioned roster parsing and member links

- Extended roster parsing to consume every worksheet with a name table, infer A-E grades from explicit sheet names, preserve accepted/waitlisted/rejected and selection-exempt fields, ignore self-reported appearance counts, and reject duplicate normalized names within a grade using a structured validation error.
- Added OOXML .xlsm support without executing macros; legacy .xls continues through LibreOffice conversion.
- Replaced destructive roster re-import with event-locked monotonic versions and explicit initial/correction(target)/additional modes. Corrections supersede exactly one target; additional publications coexist.
- Added publishConfirmedRoster so an applicant roster can be explicitly reused as a confirmed publication and later publications can coexist without cloning.
- Direct event upload targets the latest displayed active roster, preserves old rows, and refuses to bypass the review/correction flow once a roster is adopted by an active fact or publication.
- Added a shared exact unique-name member linker used by roster and result materialization. It synchronizes players.user_id and roster-entry user_id, including clearing stale links after normalized-name ambiguity.
- Event details query non-superseded rosters ordered by version and defensively display only the newest version per type.
- Explorer mapped the old first-sheet parser, destructive DELETE, missing players.user_id update, and unordered event query. Advisor required explicit correction targets, event locking, separate additional/publication semantics, and stale-link clearing; these boundaries shaped the implementation.
- Tests: 48 web targeted tests and 3 reader tests passed; web/mail-worker typechecks and root lint passed. Database tests use kagetra_test_lottery_296 with the pnpm-v9 diagnostic shim.
- Assumption: players.user_id links are automatically derived; there is no manual-link provenance flag, so ambiguous matches may be cleared.
- Worktree: C:/tmp/impl-tournament-lottery-trends
