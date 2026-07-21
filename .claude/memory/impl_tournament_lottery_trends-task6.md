---
name: tournament-lottery-trends-task6
description: Two-query privacy-safe series lottery aggregation boundaries
type: implementation
---

Series lottery metrics use two set-based queries regardless of edition count.

- Core ratios read only the active grade fact's applicant and selection-result roster pointers. Later confirmed publications, event-wide capacity, actual results, and latest-roster discovery are excluded.
- A-grade appearance counts are batched by target edition and reference date. The reference date is application start minus one day; association year is derived from that reference date, including the April 1 boundary.
- Organizer/exempt applicants consume capacity as a separate first segment. A within-band cutoff exists only when cumulativeBefore < capacity < cumulativeAfter; equality is a between-band line.
- Ratio completeness and A-cutoff completeness are independent. Missing identity, outcome matching, verification, rule version, capacity, or historical sources suppresses the cutoff.
- Public types contain aggregates only and exclude names and player/user/roster/fact/mail/attachment/source identifiers.
