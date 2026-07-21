---
name: impl-tournament-lottery-trends-task5
description: tournament-lottery-trends Task 5
type: implementation
---

Task #300 added the internal appearance-count query.

- A single batched SQL query accepts either player IDs or member user IDs and returns counts, completeness, missing edition/grade reasons, and rule version.
- Association years use April 1 through March 31 in Asia/Tokyo. Only official and new-year editions count.
- The count is the DISTINCT edition/player union of confirmed publications and active actual-result facts. Confirmed, carried-up, post-confirmation cancelled, and explicitly confirmed applicant-roster entries count; rejected, waitlisted, and carry-up-declined entries do not.
- Publication and actual-result reference-date cutoffs are independent, so a roster published before the cutoff counts even when its event is later.
- Current active roster/result corrections are reflected without persisted aggregates.
- Review found and fixed the applicant-roster publication gap and the future-event publication cutoff boundary.
- Verification: 12 focused DB tests, web typecheck, focused ESLint, diff check, and exact production-query EXPLAIN index assertions passed.
- Dedicated database: kagetra_test_lottery_300. Production was untouched.
- Residual assumption: editions without any event or result date cannot be assigned to an association year.
- Worktree: C:/tmp/impl-tournament-lottery-trends
