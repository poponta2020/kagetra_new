---
name: impl-tournament-lottery-trends-task7
description: Aggregate-only lottery trend UI, incomplete-state handling, and long-series rendering decisions
type: implementation
---

Task 7 added a client-side A-E grade selector to the existing series detail page.

- Keep the public metrics payload aggregate-only; never pass names, user/player/roster IDs, or source metadata into the component.
- For incomplete facts, render missing-reason labels only and suppress partial numeric values.
- Render the A-grade capacity boundary only when appearance history is complete.
- Thin x-axis edition labels to at most roughly eight labels for long-running series.
- Preserve the existing participant trend and edition links as independent sections.
