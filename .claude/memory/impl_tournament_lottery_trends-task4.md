---
name: tournament-lottery-trends-task4
description: Atomic roster draft adoption and version-preserving correction boundaries
type: implementation
---

Roster draft adoption is atomic and version preserving.

- Lock the pending draft, then edition/event state, before materializing roster rows, publications, and grade facts.
- Corrections close only the explicitly selected active roster/fact revision. Additional confirmed publications coexist.
- A result approval links an actual-result class only when the grade has one class and no active link. Replacing an existing link is a separate stale-safe action.
- One mail can contain multiple roster sources, so adopting or rejecting one roster draft must not mark the whole mail processed.
- Structured validation issues remain visible for review and block adoption until the source is corrected.
