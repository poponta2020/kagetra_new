---
description: Show the running kagetra web app live in the in-app Browser pane, logged in, without tripping the redirect-loop bug.
argument-hint: "[local|prod] [route]  e.g. `prod /tournaments`"
---

# /show-app — view the app in the in-app Browser pane

Goal: render the authenticated kagetra web app **live in the in-app Browser pane**.
Args: `$1` = data source `local` (default) or `prod`; `$2` = route (default `/dashboard`).

## THE GOLDEN RULE (why this command exists)

The in-app Browser pane **cannot follow a top-level HTTP redirect** — it re-requests
the same URL until the browser aborts with `ERR_TOO_MANY_REDIRECTS`, leaving a broken
`(non-http)` page (screenshot times out, `document.cookie` denied). This app redirects
on `/` (unauth → `/auth/signin`; authed → `/dashboard`). So:

- **NEVER navigate the pane to `/`** or any redirecting URL.
- Always land the pane on a **direct 200 page** (`/sw.js`, `/auth/signin` when logged out,
  or any `/dashboard`, `/tournaments`, `/players`, … once a session cookie is set).
- In-app **bottom-nav clicks are client-side (no redirect) and safe**; use them to move around.
- The server itself is fine (curl/Playwright follow the redirect normally) — this is purely
  an in-app-pane limitation.

## Steps

0. Confirm the dev server can start: `.claude/launch.json` `web` entry uses
   `cmd /c corepack pnpm dev` (the preview runner's PATH lacks the pnpm global bin —
   plain `pnpm` fails). Don't "fix" it back to bare `pnpm`.

1. **If `$1` == prod** — point web at the production DB first (see the
   `reference_prod_db_tunnel_connect` memory for full detail). Otherwise skip to step 2.
   - Tunnel: if `netstat -ano | grep 127.0.0.1:5435` shows nothing, start it in the background:
     `ssh -i ~/.ssh/id_ed25519_oracle -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L 127.0.0.1:5435:127.0.0.1:5432 ubuntu@new.hokudaicarta.com`
   - `.env.local`: if `apps/web/.env.local`'s active `DATABASE_URL` is not already on `:5435`,
     switch it to `postgresql://kagetra:<PW>@127.0.0.1:5435/kagetra?sslmode=disable`
     (comment the original for revert). Get `<PW>` at runtime — never hardcode it:
     `ssh -i ~/.ssh/id_ed25519_oracle -o BatchMode=yes ubuntu@new.hokudaicarta.com 'sudo docker exec kagetra-postgres printenv POSTGRES_PASSWORD'`
   - ⚠️ Tell the user: this is **session-scoped and read-WRITE against production** — the tunnel
     dies with the session and `.env.local` must be reverted afterward.

2. **Start the dev server**: `preview_start` with name `web`. It auto-opens the `seed` tab
   (which loads `/` → redirect → will show the loop; ignore it, we override in step 4).

3. **Mint a session cookie** for an existing user (never inserts — prod-safe):
   ```
   pnpm --silent --filter @kagetra/web dev:session -- --role=admin 2>/dev/null | tail -n1 | tr -d '\r\n'
   ```
   Use `--silent` + `tail -n1` or pnpm's banner mashes into the token. Capture the token.
   (For a fresh LOCAL DB with no users, `dev:cookie` seeds one — but NEVER run `dev:cookie` against prod.)

4. **Land the pane on a scriptable 200 page** (not `/`):
   `navigate` the `seed` tab to `http://localhost:3000/sw.js` (static file, excluded from
   auth middleware → always 200, no redirect).

5. **Inject the cookie + verify** via `javascript_tool` on the `seed` tab:
   ```js
   document.cookie = "authjs.session-token=<TOKEN>; Path=/; Max-Age=604800; SameSite=Lax";
   (async () => (await fetch('/api/auth/session',{credentials:'same-origin'})).text())()
   ```
   Expect JSON with the user (not `null`). `document.cookie` can set it because there's no
   pre-existing HttpOnly session cookie (JS can't overwrite one; if session isn't null here,
   sign out first via `/api/auth/signout` or clear cookies).

6. **Navigate the pane directly to the target 200 page**: `http://localhost:3000$2`
   (default `/dashboard`). With the session set this returns 200 (no redirect) and renders.

7. **Screenshot** the `seed` tab to confirm, and report. Remind the user: click the bottom
   nav to browse; never open `/`; ask you to jump to a specific page if needed.

8. **If `$1` == prod**, remind the user to run the revert when done: stop the SSH tunnel and
   restore `apps/web/.env.local`'s original `DATABASE_URL` (uncomment the saved line).
