---
description: Show the running kagetra web app live in the in-app Browser pane, logged in, without tripping the redirect-loop bug.
argument-hint: "[local|prod] [route]  e.g. `prod /tournaments`"
---

# /show-app — view the app in the in-app Browser pane

Goal: render the authenticated kagetra web app **live in the in-app Browser pane**.
Args: `$1` = data source `local` (default) or `prod`; `$2` = route (default `/dashboard`).

> **Fast path — do these in order, no detours (this ordering is the point):**
> ① reconcile `.env.local` ↔ `$1` → ② make DB reachable → ③ **mint cookie = DB probe** →
> ④ `preview_start web` → ⑤ land on `/sw.js` **and verify `origin` is http** →
> ⑥ inject cookie + verify session → ⑦ navigate to the route → ⑧ prove with `read_page`.
> Every slow run so far came from discovering a **wrong/dead DB *after*** starting the server.
> Steps ①–③ front-load that failure so it costs seconds, not the whole pane dance.

## THE GOLDEN RULE (why this command exists)

The in-app Browser pane **cannot follow a top-level HTTP redirect** — it re-requests the same
URL until the browser aborts with `ERR_TOO_MANY_REDIRECTS`, landing on a dead
`chrome-error://chromewebdata/` page (`location.origin === "null"`, `document.cookie` throws
`Access is denied`). This app redirects on `/` (unauth → `/auth/signin`; authed → `/dashboard`). So:

- **NEVER navigate the pane to `/`** or any redirecting URL — and never a **bare
  `http://localhost:3000`** (that *is* `/`). Always include an explicit non-redirecting path.
- Always land the pane on a **direct 200 page** (`/sw.js`, `/auth/signin` when logged out, or any
  `/dashboard`, `/tournaments`, `/players`, … once a session cookie is set).
- In-app **bottom-nav clicks are client-side (no redirect) and safe**; use them to move around.
- The server itself is fine (curl/Playwright follow the redirect normally) — this is purely an
  in-app-pane limitation.
- **A `screenshot` timeout is NOT a reliable failure signal** — it times out both on the dead
  chrome-error page AND on perfectly healthy pages (pane capture quirk). Never diagnose from a
  screenshot; check `location.origin` / `document.readyState` and use `read_page` instead.

## Ignore preview-runner "dev server failed" errors that aren't about `web`

`.claude/launch.json` also defines `design-live` (the `/design-screen` prototype server on 3100) and
`postgres` (port 5433, permanently owned by the docker DB). When the pane opens, the harness may try
them and surface generic **"dev server failed"** popups naming `port 5433 in use` (postgres — docker
already holds it; expected and unfixable here).

- **These are NOT about `web`.** `preview_start web` starts cleanly on 3000 with those entries
  present (verified 2026-07-13). Do **not** investigate them as part of this command.
- `design-live` used to fail too, with `cwd must be a relative path` — the preview runner rejects an
  absolute cwd. Fixed 2026-07-26: the entry now points at `.design-live/apps/web`, a gitignored
  junction to `C:/tmp/design-live-kagetra`. Don't "fix" it back to an absolute path.
  **The junction is per-machine and not in git** — on a fresh clone (or the other of the two dev
  machines) create it once before using `/design-screen`:
  ```
  cmd /c mklink /J ".design-live" "C:\tmp\design-live-kagetra"
  ```
  The target is the kagetra design worktree — **not** `C:/tmp/design-live`, which belongs to a
  different repository (match-tracker) that grabbed the name first.

## Steps

1. **Pre-flight: reconcile the DB target — BEFORE anything else.**
   Read `apps/web/.env.local`'s active (uncommented) `DATABASE_URL`:
   - `@127.0.0.1:5435` → currently **prod** (a leftover tunnel from a past `/show-app prod` that
     was never reverted — see `feedback_ship_dod_residual_check` / `reference_prod_db_tunnel_connect`).
   - `@…:5433` → currently **local** (docker).
   - **If the current target ≠ `$1`, STOP and ask the user which data they want.** A plain
     `/show-app` inheriting a prod `.env.local` is the exact ambiguity that derailed the last run.
     Don't silently revert (discards their prod setup) and don't silently use prod (contradicts the
     command). Proceed only once the source is agreed.

2. **Make `.env.local` match the agreed source, and make the DB reachable** (the reachability
   proof happens in step 3):
   - **local**: active `DATABASE_URL` = the `:5433` line (uncomment it, comment `:5435`). Confirm
     docker db is up: `netstat -ano | grep ':5433' | grep LISTENING`.
   - **prod**:
     - **Tunnel**: if `netstat -ano | grep '127.0.0.1:5435'` shows no LISTENING line, start it in
       the **background** and wait for the listener:
       ```
       ssh -i ~/.ssh/id_ed25519_oracle -o BatchMode=yes -o ExitOnForwardFailure=yes -N \
         -L 127.0.0.1:5435:127.0.0.1:5432 ubuntu@new.hokudaicarta.com
       ```
       then poll: `for i in 1 2 3 4 5; do netstat -ano | grep -q '127.0.0.1:5435.*LISTENING' && echo UP && break; done`
     - **`.env.local`**: if the active `DATABASE_URL` isn't already `@127.0.0.1:5435`, switch it to
       `postgresql://kagetra:<PW>@127.0.0.1:5435/kagetra?sslmode=disable` (comment the original for
       revert). Fetch `<PW>` at runtime — never hardcode:
       `ssh -i ~/.ssh/id_ed25519_oracle -o BatchMode=yes ubuntu@new.hokudaicarta.com 'sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD'`
     - ⚠️ Tell the user: **read-WRITE against production**, session-scoped — the tunnel dies with
       the session and `.env.local` must be reverted afterward (step 9).

3. **Mint the session cookie — this doubles as the DB reachability probe, so run it BEFORE
   `preview_start`.** `dev:session` connects to the DB directly (no web server needed) and only
   SELECTs an existing user (never inserts → prod-safe):
   ```
   pnpm --silent --filter @kagetra/web dev:session -- --role=admin 2>/dev/null | tail -n1 | tr -d '\r\n'
   ```
   `--silent` + `tail -n1` keep pnpm's banner out of the token.
   - **If the output is empty or doesn't start with `eyJ`, the DB is unreachable** — re-run
     WITHOUT `2>/dev/null` to read the error (`ECONNREFUSED :5435` = prod tunnel down;
     `:5433` = docker db down). Fix step 2 and retry. **Do NOT proceed without a valid `eyJ…`
     token** — a missing token is precisely what makes the later cookie step fail.
   - (Fresh LOCAL DB with no users: `dev:cookie` seeds one — but NEVER run `dev:cookie` against prod.)

4. **Start the dev server**: `preview_start` with name `web` (starts on 3000; **note the returned
   `tabId`** and use it for every pane call below). It auto-opens a tab at `/` → redirect → dead
   `chrome-error` page; we override it in step 5.
   - Confirm `launch.json`'s `web` entry still uses `cmd /c corepack pnpm dev` — the runner's PATH
     lacks the pnpm global bin, so bare `pnpm` fails. Don't "fix" it to bare `pnpm`.

5. **Land the pane on a scriptable 200 page — and VERIFY you actually escaped the error page.**
   `navigate` the tab to `http://localhost:3000/sw.js` (static file, excluded from auth middleware
   → always 200). Then confirm with `javascript_tool`:
   ```js
   JSON.stringify({ href: location.href, origin: location.origin })
   ```
   **Expect `origin === "http://localhost:3000"`.** If `origin` is `"null"` (still the chrome-error
   page — the first navigate off it often doesn't stick), `navigate` to `/sw.js` **again** and
   re-check. **Do not inject the cookie until origin is confirmed http** — otherwise
   `document.cookie` throws `Access is denied` and you waste a round-trip.

6. **Inject the cookie + verify** via `javascript_tool` on the same tab:
   ```js
   document.cookie = "authjs.session-token=<TOKEN>; Path=/; Max-Age=604800; SameSite=Lax";
   (async () => (await fetch('/api/auth/session',{credentials:'same-origin'})).text())()
   ```
   Expect JSON with the user (not `null`). JS can set the cookie only because there's no
   pre-existing HttpOnly session cookie; if the session isn't null here, sign out first
   (`/api/auth/signout`) or clear cookies, then re-inject.
   - **If the session stays `null` after injecting on `/sw.js`, inject on an HTML page instead.**
     Observed 2026-07-26 (port 3100): `document.cookie = ...` on the `/sw.js` document reports
     success but the cookie never reaches the server, so every later navigate hits the redirect
     loop. Fix: `navigate` to `/auth/signin` (HTML, 200 while unauthenticated — do this **from a
     healthy page**, not from the dead chrome-error page), inject there, verify
     `/api/auth/session` returns the user, then continue to step 7. `curl` with an explicit
     `Cookie:` header is the quick way to prove the token itself is valid before blaming it.

7. **Navigate to the target route**: `route = $2 || "/dashboard"`; `navigate` to
   `http://localhost:3000` + `route`. **Assert `route` starts with `/` and is not `/`** (a bare host
   = `/` = redirect loop). With the session set this renders a 200.

8. **Prove it + report.** Primary proof = `read_page` (a11y tree) plus a `javascript_tool` read of
   `location.href` / `document.title` / heading text. Try one `screenshot` for a visual, but
   **treat a screenshot timeout as a non-issue when the DOM is `complete` and the console is clean**
   — don't retry-loop on it. Remind the user: click the bottom nav to browse; never open `/`; ask
   to jump to a specific page.

9. **If `$1` == prod, remind the user to revert when done**: stop the SSH tunnel (kill the
   background ssh) and restore `apps/web/.env.local`'s original `DATABASE_URL` (uncomment the
   `:5433` line, re-comment `:5435`).
