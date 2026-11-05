# Current account integrations

Outlook and Zoho OAuth connectors, the action inbox, real team chat and reviewed time-log/reply writes are now implemented. See [current account setup and workflow](accounts-and-actions.md). The earlier phase notes below describe the local registry and legacy routing interface; they are not a statement that the new account connectors are missing. Simulation execution is disabled.

# Work intelligence: Phases 1 and 2

This extends the existing office; it does not replace the scene, employees, simulation, chat, meetings, or Codex queue. The first two phases in the extension brief are implemented. Later phases remain separate increments.

## Architecture and implementation plan

The audit found React panels/Zustand, authenticated Fastify routes, a generic SQLite records store, and the existing durable Codex queue. There was no corporate connector or project-knowledge service. All required dependencies (Zod, SQLite, React, TypeScript and Playwright for QA) were already installed.

1. Extend the existing SQLite store with an additive, versioned migration and transactions. Keep corporate work records separate from coding repository approvals and simulation state.
2. Introduce typed integration contracts, capability/authorization checks and a shared router; implement actual local/manual reads and explicit synthetic demonstrations.
3. Add the project registry, confirmed mappings, local classifier, manual work records, scoped corrections and separately confirmed reusable rules.
4. Expose authenticated routes and two office panels, then validate with synthetic API tests, persistence tests, production build and the existing browser suite.

| Area                                                       | Source                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Contracts and operation allowlists                         | `shared/work.ts`                                                                                          |
| Additive migration and transactions                        | `server/migrations.ts`, `server/db.ts`                                                                    |
| Shared router, bounded retries and execution history       | `server/integrations/engine.ts`                                                                           |
| Real local reads and isolated synthetic examples           | `server/integrations/local.ts`                                                                            |
| Input validation, classification, registry and corrections | `server/work/`                                                                                            |
| Office panels                                              | `src/components/Integrations.tsx`, `src/components/WorkKnowledge.tsx`                                     |
| Shared on-demand data loading                              | `src/components/useResource.ts`                                                                           |
| Tests                                                      | `tests/integrations.test.ts`, `tests/work.test.ts`, `tests/work-api.test.ts`, `scripts/browser-smoke.mjs` |

Existing files extended: `server/app.ts`, `server/db.ts`, `src/App.tsx`, `src/store.ts`, `src/main.tsx`, `src/components/Panels.tsx`, `src/components/Operations.tsx`, `scripts/browser-smoke.mjs`, and `README.md`. `src/work.css` supplies the new panel styling. Existing dependencies, original employees, simulation modules, and Codex execution code are retained.

Work data lives in the existing SQLite database. `schema_migrations` records forward-only migration versions; migration 1 adds indexes and three default `MANUAL_ONLY` configurations without altering existing records or jobs. It runs automatically at startup, transactionally and once. New record kinds are `knowledge_projects`, `work_mappings`, `work_rules`, `work_records`, `work_learning`, `work_audit`, `integrations`, `integration_health`, and `integration_runs`.

## Using the office

Open **Work knowledge** from the sidebar or daily CEO briefing.

- **Projects:** register aliases, your explicit role, client/department, stakeholders, responsibilities, technologies, status and optional link to an existing coding repository. A business project does not require Git. Your recorded role is never inferred from email volume.
- **Mappings:** save confirmed portal/project/task/issue IDs, module, billing rule, approved descriptions and source notes. Partial mappings are allowed; unknown IDs stay absent. They are labeled user-confirmed with remote verification pending. Changes invalidate previous remote verification.
- **Activities:** add actual work, attended meetings, or manually supplied email/message content. Date, duration and attendance remain unknown unless supplied. Duration can be calculated from explicit same-day start/end times. Communications cannot be saved as proven working time. Possible duplicate descriptions/times and overlapping supplied time intervals are flagged. Day and seven-day filters use your selected date.
- **Rules:** add or edit explicit phrase conditions, source, exact sender, project/mapping, labels, required fields, confidence weight and explanation. Match ALL/ANY phrases; arbitrary regex, scripts and commands are not supported. Disable a rule through Edit rule.
- **Learning:** corrections preserve original input, earlier classification, explanation and correction history. They initially affect one record only. Choose **Create reusable rule**, enter the intended conditions and separately confirm to apply it to future matching input. This is rule learning, not model retraining.

Saved classifications retain the rules/explanation used at that time. **Apply current rules** explicitly reevaluates an uncorrected record; CEO corrections are preserved. Conflicting project/role/mapping rules produce `NEEDS_REVIEW` with no automatic project/mapping choice. Local keyword hints are suggestions, not full semantic or multilingual understanding. No corporate input is sent to a model by these services, and no input text creates a coding job or runs commands.

Open **Connected applications** for Outlook, Teams and Zoho.

- Modes: `AUTO`, `API_ONLY`, `BROWSER_ONLY`, `MANUAL_ONLY`, `SIMULATION_ONLY`.
- Saving policy permission does not authenticate an account, grant scopes or install an adapter.
- Actual adapter health, authorization, scopes and capabilities are supplied by server adapters, never by client-submitted health flags. Disabled external methods are not contacted even to inspect health.
- AUTO prefers an independently authorized healthy API. Technical unavailability can fall back to an independently authorized browser, then local/manual input. A provider permission denial or uncertain authorization cannot justify browser fallback.
- Reads retry at most twice per method with bounded delays and a 15-second operation deadline. Long rate-limit delays are not ignored; a read may use another permitted method in AUTO. Permission/authentication errors and ambiguous outcomes are not retried. Connection policy changes stop subsequent attempts and discard in-flight results.
- Execution records preserve method, reason, attempts, failure events, timestamps and result provenance. A service restart marks unfinished operations `UNKNOWN_OUTCOME`.
- Simulation is used only when explicitly selected, labeled in every result, and never advances real success/synchronization timestamps or creates real work records.

**There are no live Zoho, Graph or corporate browser adapters in this increment.** Their state is “Not installed.” Tests inject synthetic adapters to exercise routing; these are not production connectors. No corporate operation is claimed successful. Local `VERIFIED` results mean the local operation completed, not that a corporate mailbox was synchronized. Local result envelopes always identify `MANUAL` provenance and limited completeness.

External sends and time-log submissions fail with `APPROVAL_REQUIRED`; they cannot be enabled by setting a connection mode or passing an approval field. Unsupported reads return `UNSUPPORTED`. There is no corporate credential/token/session collection or storage endpoint in these phases. OAuth, an encrypted credential vault, scope verification and protected browser profiles must accompany the future connectors.

## API

All routes inherit the existing CEO authentication, origin checks and input limits. Updates require the current `version`, preventing stale edits. Confirmation fields must be literal `true` where required. Work writes and audit events commit together.

| Method and path                          | Purpose                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/work`                          | Registry, mappings, rules, records, corrections, audit and missing/duplicate/overlap flags |
| `POST /api/work/analyze`                 | Local preview without saving                                                               |
| `POST /api/work/projects`                | Create an explicit work project                                                            |
| `PUT /api/work/projects/:id`             | Update with `{version, data}`                                                              |
| `POST /api/work/mappings`                | Save user-confirmed, possibly partial mapping                                              |
| `PUT /api/work/mappings/:id`             | Update with `{version, data}`                                                              |
| `POST /api/work/rules`                   | Save an explicitly confirmed rule                                                          |
| `PUT /api/work/rules/:id`                | Edit/disable with `{version, data}`                                                        |
| `POST /api/work/records`                 | Save and classify supplied input                                                           |
| `POST /api/work/records/:id/correct`     | Confirm a record-scoped classification correction                                          |
| `POST /api/work/records/:id/reclassify`  | Apply current rules to an uncorrected record                                               |
| `POST /api/work/learning/:id/rule`       | Separately confirm a reusable rule from feedback                                           |
| `GET /api/integrations`                  | Actual capabilities/health, routing policy and history                                     |
| `PUT /api/integrations/:application`     | Versioned mode/policy update; no credentials or health overrides                           |
| `POST /api/integrations/route`           | Explain route for an allowlisted application/operation                                     |
| `POST /api/integrations/run`             | Execute a supported read with validated local IDs/pagination                               |
| `POST /api/integrations/runs/:id/cancel` | Cancel a pending read                                                                      |

Manual Outlook supports `listMessages`, `getMessage`, `classifyMessages` and `prepareBriefing`. Manual Teams supports `getAuthorizedMessages` and `classifyMessage` over CEO-supplied messages only. Manual Zoho discovery lists registered projects and confirmed portal/task/issue mappings, explicitly without remote verification. No remote time logs or conversation history are invented. Paginated local reads accept `limit` (1–100) and the returned `cursor`.

## Run and verify

The **Start here** screen adds a local work profile and a separate AI video project. Work-profile confirmation and per-task sharing are separate: nothing in the registry is automatically sent to a model. Selected context contains the confirmed profile and whitelisted metadata for the current project (or knowledge projects linked to the selected coding repository). Messages, raw activity records, Zoho mappings and unrelated projects are excluded. Saved version numbers stop stale profile or project context from being reused silently.

Video brainstorming uses three sequential real Codex turns (Sarah → Olivia → Mia) in an empty read-only workspace. It needs no coding repository. The request persists a scoped CEO approval, execution policy, brief, optional profile snapshot and explicitly remembered feedback. CLI receipts and full logs are stored beside the job. Output is validated as exactly three unapproved ideas with complete scripts, scene durations and captions. A failure cannot produce a successful job report.

Idea approval binds the current version and content hash. Editing invalidates approval. Feedback becomes reusable only when explicitly selected; normal review comments do not automatically become preferences. Production-brief downloads contain text, not rendered videos. Rendering and YouTube/Facebook connections are unavailable; the publish endpoint rejects writes.

New routes: GET/PUT /api/work/profile; GET /api/studio; POST /api/studio/setup; PUT /api/studio/brief; POST /api/studio/generate (current brief version, exact context scope hash, explicit approval, optional confirmed-profile choice); PUT /api/studio/ideas/:id (version and content); POST /api/studio/ideas/:id/review (version, content hash, decision and optional remembered feedback). They use the same CEO authentication and SQLite audit records as other work routes. No destructive database reset or new dependency is required.

The browser suite also checks profile persistence, video-project setup, draft editing, approval invalidation and mobile review. npm run test:studio is an explicit live test with three real model turns in a disposable database; it consumes configured model quota. npm run test:studio -- --local-office instead sets up the requested project and saves its real, unapproved drafts in the running local office on port 3001. It never renders or publishes. Results and completed CLI receipts are saved under test-results/studio-*/receipt.json.

Requires Node 24+. No new packages, credentials or corporate authorization are needed for the working local features.

```powershell
Set-Location 'D:\Carl\Personal\AI Team'
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The API uses `http://127.0.0.1:3001`. Existing `.env` and Codex configuration remain intact.

```powershell
npx tsc -b
npm run lint
npm test
npm run build
npm run test:browser
```

`npm run check` combines lint, tests and the type-checked production build. For production locally, run `npm run build`, then `npm start`, and open `http://127.0.0.1:3001`.

Tests use synthetic content, injected test adapters and temporary databases. The browser suite exercises the local registry, confirmed meeting time, corrections, separate rule confirmation, routing modes and simulation labeling alongside the existing office/real-job separation checks. No corporate account is accessed and no destructive account tests run. Existing Codex live verification remains a separate, explicitly invoked `npm run test:execution` command.

## Next increments

Phases 3–8 are not represented as complete: multilingual drafting/communications, validated timesheet drafts and the dedicated office/workstations, real OAuth connectors, independently authorized browser workers, live Outlook ingestion, then specialist employees and orchestration. Browser access never substitutes for denied API permission. Add each only after the preceding increment passes its checks.

Future API work must validate live endpoints, scopes, schemas, pagination, regional domains and returned IDs against the [official Zoho Projects documentation](https://projects.zoho.com/api-docs) and [Microsoft Graph permission documentation](https://learn.microsoft.com/en-us/graph/permissions-overview). Tenant policy/admin rights are not assumed. External write adapters require exact-payload approvals, idempotency, reconciliation and verifiable provider identifiers before exposing send/submit controls.
