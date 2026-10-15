# Hydraulic Tuning Plan

A web app for producing Australian hydraulic-services water tuning reports from
BMS meter data. This repository holds the full Netlify deployment: a single-page
app plus a small serverless backend for storing shared projects.

## Structure

| Path | What it is |
| --- | --- |
| `public/index.html` | **The app.** Self-contained single-page app (Chart.js, jsPDF, SheetJS are vendored inline, so it also runs by just opening the file). This is the canonical source — edit it here. |
| `netlify/functions/projects.ts` | Serverless API for shared projects (`/api/projects`): list / create / read / update / delete, with optional password-locking and short-lived edit tokens. |
| `db/schema.ts` | Drizzle schema for the `projects` table (Netlify DB / Postgres). |
| `db/index.ts` | Drizzle client. |
| `drizzle.config.ts` | Drizzle Kit config (generates migrations into `netlify/database/migrations`). |
| `netlify/database/migrations/` | SQL migrations applied on deploy. |
| `netlify.toml` | Netlify build / functions / database configuration. |
| `.export-version` | Version counter for downloaded builds (see below). |

## Running

- **Just the app:** open `public/index.html` in a browser. Everything works
  except the cloud "shared projects" feature, which needs the backend.
- **Full stack locally:** `npm install`, then `netlify dev` (requires the
  Netlify CLI and a provisioned Netlify DB). The app calls `/api/projects`.
- **Deploy:** push to the connected Netlify site; it builds from this repo,
  publishes `public/`, and runs the functions + database migrations.

## Cloud "shared projects"

Each row in `projects` is one building/client project; `snap` is the full app
snapshot (JSON). A project can be password-locked: anyone can read it, but
saving, deleting or changing the password requires the password, enforced with
an HMAC edit token signed by the project's own password hash (so changing the
password invalidates every issued token). Large projects fall back to a trimmed
snapshot (no daily breakdown or action photos) to stay under the function
request limit — keep a `.htpj` project file for the complete data.
