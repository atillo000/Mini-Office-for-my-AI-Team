# Little Company

A local, interactive AI office built with React, TypeScript, Vite, React Three Fiber, Drei, Three.js, Zustand, Tailwind, Fastify, WebSockets, and SQLite. All office artwork is original procedural geometry; no game assets or external fonts are required.

## Launch locally

Requires Node.js 24+ and npm. From PowerShell:

```powershell
Set-Location 'D:\Carl\Personal\AI Team\Mini-Office-for-my-AI-Team'
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on **http://127.0.0.1:3001**. SQLite data is saved in `.data/company.sqlite`. No cloud deployment is needed.

Development startup waits for the API's health response before starting Vite. You should see **Waiting for API**, then **API ready. Starting office UI.** The proxy uses `API_URL` when supplied, otherwise the backend `HOST`/`PORT` from `.env` (default 127.0.0.1:3001). Optional `DEV_UI_PORT` selects a different frontend port. If the API cannot start within 60 seconds, the frontend reports the failure; inspect the `[API]` output or run `npm run dev:server` alone. A brief connection refusal from older startup code means the API was still starting, not that mailbox sign-in failed.

For the production build served by Fastify:

```powershell
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Build before starting; restart the server after a new build.

## Explore

Click **Start here** beside the office heading (or the compass in the sidebar). **My work profile** holds your description, responsibilities, routines, communication preferences and goals. Confirm it before opting to share it with an AI task. Coding assignments and real discussions offer a profile checkbox; their saved context includes only knowledge projects linked to the chosen repository.

**Start here → Video ideas** sets up **AI Video Studio** without a Git repository. Its brief asks the team to propose original horror, comedy, drama and other ideas with broad Filipino appeal (“patok sa masa”); you do not need to choose a niche. The clearly labeled starter example shows the review process. Approve a brainstorming request to run Sarah, Olivia and Mia sequentially through the real isolated Codex runner. Their discussion, run receipts and three scripts/scene plans are saved as drafts.

Read and edit an idea, then **Approve idea**, **Request changes** or **Reject**. “Remember this feedback” explicitly adds that comment to future brainstorming requests. Editing clears any prior approval. Approved ideas can be downloaded as production briefs. This is persistent context and feedback, not automatic model training or background monitoring.

**Video rendering and YouTube/Facebook posting are not implemented or connected.** Idea approval cannot publish. Production and a separate exact-post approval are required before any future upload integration. Your local project and existing coding jobs remain separate.

- Drag to orbit, right-drag to pan, and scroll to zoom. Touch: one finger orbits; two fingers pan/zoom.
- Use the room menu or click a room floor to focus the camera. The fit button returns to the whole office.
- Click a teammate or their card for chat, personality, schedule, work history, and task assignment.
- People, Projects, Inbox, Meetings, Activity, Settings, and the daily briefing are in the surrounding controls.
- Worker activity comes from actual jobs; inactive workers do not invent work or scheduled routines.
- Weather uses Open-Meteo with a ten-minute cache, explicit cached/offline labels, provider timestamp, rain, and cloud-dependent lighting. Configure coordinates and timezone in Settings. Offline temperature is a clearly labeled sample, not a live reading.
- Day/night follows the configured timezone. A manual lighting change disables automatic lighting until re-enabled in Settings.
- Settings offers a 2D floorplan. Reduced-motion devices start with that view; WebGL initialization failures also fall back to 2D. View preferences persist locally.

## Real team and action inbox

After-shift Zoho planning uses your signed-in Sprout attendance reader and real AI allocation reviews. The default is eight work hours plus one unpaid lunch hour. Clock-out prepares a proposed allocation for review; Zoho submissions still require exact approval. Video brainstorming now uses a free-only Flow policy with four or five scenes and a 50-credit ceiling. See [shift planning and video budget setup](docs/shift-planning-and-video-budget.md).

The office now reflects real saved jobs. Schedule simulations, synthetic chat replies and synthetic integration execution are disabled. Sending a message runs a durable read-only Codex chat; replies require a completed CLI receipt. The 3D view remains a visual interface to actual work.

The bell opens a unified action inbox for approvals, real AI replies, Outlook messages, failures and provider receipts. Click an item to open its exact review or conversation. Optional desktop notifications work while the app is open. Opening an alert never approves an action.

Outlook and Teams have real read-only browser readers: sign in in their dedicated Edge windows, select messages, and explicitly share a capture for a real AI urgency report and local reply drafts. Watching checks the selected view every minute. Only rendered messages are covered; other chats and unloaded history are not checked. Review and copy replies, then send them manually. The app cannot send Outlook or Teams messages. See the [browser reader guide](docs/browser-readers.md).

Optional Microsoft Graph setup supports paginated read-only Inbox sync and local project-number matching. Zoho OAuth supports live project/task discovery and time-log submission after exact-draft approval. Time routing follows numbered approved projects, SIN_TecSurge_General and SIN_TecSurge_BusinessDevelopment for proposal-stage prototyping. No work duration is inferred from emails. See [account setup, workflow, API sources and verification limits](docs/accounts-and-actions.md).

## Work knowledge and connected applications

The extension's **Phase 1 (integration foundation)** and **Phase 2 (work knowledge)** are available from the office sidebar and daily CEO briefing. Register work projects and your role, confirm Zoho mappings, enter activities or supplied messages, classify locally, correct individual decisions and separately approve reusable rules. Connected Applications exposes saved routing modes, actual capabilities, operation history. Simulation execution is disabled.

Outlook and Teams browser readers use normal user sign-in without an Entra app registration. Optional Outlook Graph and Zoho API connectors require separate OAuth setup; neither is claimed connected before authorization. Classification uses local data. Confirmed work profiles and selected linked project descriptions can be shared with a real AI task only through its explicit context choice; unrelated messages, time logs and mappings are excluded. Replies remain local for manual sending; Zoho time-log submissions require exact-draft approval. See [implementation, supported operations and run commands](docs/work-intelligence.md).

## Real agents

Direct chat uses real Codex execution. Development jobs additionally require staged CEO approvals, isolated source changes and verified tests.

1. Start Docker Desktop with Linux containers and run `npm run agent:build`. The image pins Codex CLI 0.166.0 and includes trusted artifact and sandbox inspection utilities.
2. Copy `.env.example` to `.env`. Prefer a dedicated `CODEX_API_KEY`. Alternatively, run `npm run agent:login` to provision a dedicated Docker login volume and set `CODEX_AUTH_VOLUME=little-company-codex-auth`. For private, trusted projects only, `npm run agent:login -- --from-local-login` explicitly copies your existing CLI login into that volume without printing it. Protect that volume like a password; it is never mounted into tests or source artifacts. Model use consumes account quota or API credits.
3. Restart the backend and use **Settings ? Check execution service**. Readiness verifies actual read-only and writable sandbox boundaries, tool network denial and hidden credentials; account/model access is checked on the real request.
4. Connect a canonical local Git repository root with a commit. Only committed source is exported. Select automatic test detection, npm tests, or Node tests. Disabling tests blocks development completion.
5. Assign a task. A durable SQLite **DRAFT** exists immediately. **Approve planning** records the instruction, source path, pinned Git commit, test profile and execution policy before anything runs.
6. Review the real plan and **Approve implementation**. Specialists edit only that job's isolated copy. Their messages are stored as **reported**, without claiming verified completion.
7. Review captured changes and the exact test scripts. **Approve tests** executes project code in a separate network-disabled container without model credentials. When needed, dependency downloads require an additional checkbox; only npm registry packages from a lockfile are supported, with install scripts disabled.
8. Review the result, passing test output, changed files, patch, source archive and SHA-256 manifest. **Accept verified result** records CEO acceptance. It does not merge, deploy or contact external systems.

Discussion jobs use read-only mounts and return actual CLI responses. They may complete as discussions, with tests explicitly marked not applicable; that never claims coding work was performed.

### Evidence and honest status

Each attempt has an isolated workspace under `.data/workspaces/` and an evidence directory under `.data/jobs/<job>/attempt-<n>/`. These persist full redacted JSONL logs, scoped approval records, CLI thread/completion receipts, source snapshots, tests and downloadable artifacts. The UI keeps a bounded log preview; the full process log remains downloadable. Persist/backup the SQLite database, evidence and workspaces together.

An exit code of zero or an employee's final message is insufficient. The CLI must emit a successful completed turn. Development results require nonempty captured changes, a supported runner reporting at least one passing test, and identical source hashes before and after tests. Missing tests, empty changes, or test-induced source edits become **UNVERIFIED**; failed tests become **FAILED**. Artifact hashes are rechecked before acceptance and download. Automated checks establish the recorded files and test outcome, not full requirement coverage: the CEO must review the implementation and tests.

**AWAITING_APPROVAL** pauses implementation or tests. Approval requests bind a unique request ID and scope hash; stale or repeated requests are rejected. FIFO execution is sequential, with eight plan steps and three attempts maximum. Retry creates a new workspace and preserves earlier evidence. Active work becomes **INTERRUPTED** after restart, and its containers are removed before queue recovery. No offline progress is invented. Older development claims without evidence become **UNVERIFIED**. A process lock prevents multiple service instances from owning the same database.

### Execution boundaries

- The original working tree is never written. A fixed-argument Git archive exports the approved commit; no agent-owned Git configuration or project scripts run on the host.
- CEO approval gates planning, planned edits, test scripts, dependency downloads, and final acceptance. Runtime permission elevation is denied. Production deployment, automatic merging, external messaging and access to other host workspaces are not supported actions.
- Non-root containers retain 1 CPU, 1 GB memory, 128 PIDs, dropped capabilities, no privilege escalation, read-only roots and bounded temporary storage. Only the task copy is mounted for the agent; evidence storage is mounted only in trusted inspection containers.
- Codex uses named filesystem profiles derived from read-only/workspace modes with network disabled. The credential directory and process environment are hidden from tools. Project-local configuration, user config and exec rules cannot broaden permissions; web search is disabled.
- The agent uses a Docker seccomp allowlist with the namespace calls required by Bubblewrap. Tests and utility containers retain Docker's default profile. See [the reviewed profile and rationale](server/agents/SECCOMP.md). No host security policy is changed and sandbox failures never trigger an unrestricted fallback.
- Codex calls time out after ten minutes, preparation after five, other containers after three, and each stage after thirty. Git indexing has a two-minute budget for Windows bind mounts; utility commands have a one-minute budget. Per-process output is capped at 4 MB; exceeding limits fails the job. Cancellation removes the named container.
- Source preflight and artifact capture enforce shared limits of 5,000 files, 256 MiB total and 32 MiB per file. Oversized source, symlinks and submodules are rejected before archive extraction. Capture also rejects common secret filenames and unsupported file types. Keep secrets out of tracked source and prompts; log redaction cannot identify every unknown secret.
- The initial image supports Node projects. Supported summaries are Node TAP, Vitest and Jest. Other languages or runners remain unverified until a reviewed adapter/image supports them. Tests and dependency installation may fail honestly when native build steps or network access are required.

See the [official non-interactive Codex documentation](https://learn.chatgpt.com/docs/non-interactive-mode), [permission profiles](https://learn.chatgpt.com/docs/config-file/config-reference), and [Docker seccomp documentation](https://docs.docker.com/engine/security/seccomp/).

## Access and data

Local access binds to loopback by default. To bind a remote interface, configure a long random `CEO_TOKEN` first, and use a TLS reverse proxy for transport security. API actions require the bearer token; enter it in Settings. It is stored only in the browser tab’s session storage. This is a single-owner application, not a multi-user identity or role system.

Same-origin requests are enforced, WebSockets require expiring one-time tickets, input is validated, and secrets are never returned in configuration responses. Keep both development servers on loopback. For remote use, serve the production build through Fastify, not the Vite dev server.

Optional variables: `HOST`, `PORT`, `CEO_TOKEN`, `DOCKER_BIN`, `CODEX_AUTH_VOLUME`, `CODEX_API_KEY`, `AGENT_IMAGE`, `COMPANY_DB`, `WEATHER_LAT`, `WEATHER_LON`. `API_URL` changes Vite’s API proxy. `.env` loads automatically for the backend.

Company messages, captured external messages, reports and local drafts are stored in SQLite. Explicitly shared captures are also retained in review-job artifacts and sent to the configured model. Managed Edge profiles beside the database retain normal sign-in state. Protect the database, profiles, credential vault and job artifacts as private account data.

## Source map

```text
src/
  world/          original furniture, avatars, camera, rooms, rain, lighting
  simulation/     behavior states, routine planning, grid navigation, resource reservations
  components/     employee, conversation, project, meeting, CEO panels
  store.ts        Zustand view state and saved preferences
  api.ts          authenticated local API client
server/
  agents/         Codex adapter and durable sequential job queue
  integrations/   optional email provider boundary
  app.ts          validated API, authentication, WebSockets, static serving
  db.ts           native Node SQLite persistence
  process.ts      bounded, cancellable child processes and log redaction
  weather.ts      Open-Meteo cache and offline behavior
shared/           TypeScript contracts, original team and room definitions
tests/            simulation, API, and queue tests using isolated databases
scripts/          isolated real-browser workflow verification
```

## Verification

```powershell
npm run lint
npm test
npm run build
npm run test:browser
```

Browser tests use installed Microsoft Edge in headless mode. Set `BROWSER_CHANNEL=chrome` for installed Chrome. They allocate their own ports, create disposable SQLite databases and a Git fixture under ignored `test-results/`, and close their processes afterward. Screenshots include desktop, mobile, night, and 2D views. The browser and unit tests do not invoke a live model.

Run `npm run test:execution` separately for a **live**, quota-consuming Codex check. It creates a disposable private Git fixture, durably saves a job, approves each stage for that fixture, verifies the test and artifact outcome, checks the original source is unchanged, and reopens the database to verify persistence. Evidence is retained under ignored `test-results/execution-*/`. It fails honestly if Docker, authentication, sandbox enforcement or the model is unavailable.

For preparation timeouts, run `npm run test:workspace -- "D:\Projects\your-project"`. This checks the source limits, creates a disposable isolated copy, establishes its Git baseline and verifies artifact capture using one diagnostic file added only to that copy. It never calls Codex, runs project scripts, modifies the original repository or changes real job approvals. The receipt and logs are retained under `test-results/workspace-*/`. Rebuild `npm run agent:build` after changing the trusted worker or its shared limits. An exhausted three-attempt job retains its audit history; start a new task draft rather than resetting its attempts.

Verified on November 4, 2026: a real signed-in Codex job edited the private fixture, passed its existing Node test, produced hash-verified downloads, required every staged approval, and survived a database reopen. Browser checks passed on desktop and mobile with no JavaScript errors.

## Current scope

The scene uses original procedural assets and displays actual saved job activity; schedule simulation is disabled. Real development jobs, communications reviews, video-idea drafts and work knowledge persist independently. Browser readers cover the selected rendered view only. Automatic email/chat sending, video rendering or posting, social relationship modeling, remote TLS, multi-owner access, automatic merging/deployment and parallel jobs are outside this version.
