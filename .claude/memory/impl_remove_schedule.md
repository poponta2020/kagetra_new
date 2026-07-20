---
name: remove-schedule
description: remove-schedule implementation
type: implementation
---

# remove-schedule implementation

- Removed the schedule tab, dashboard placeholder, `/schedule` route pages, and schedule form helpers.
- Kept `schedule_items` and `schedule_kind` in Drizzle only as a documented legacy schema. Production cleanup must wait for backup restoration verification and a maintenance window; no migration was generated.
- Member deletion now ignores a legacy schedule item and relies on its FK `ON DELETE SET NULL`; dedicated action test covers this.
- Verification: targeted web tests, shared tests, lint, and typecheck passed. The full web suite hit a Vitest worker memory/IPC failure after many passing files.
