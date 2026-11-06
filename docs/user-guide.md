# Your Mini AI Office: step-by-step

Use this order for your workday:

**Connections → My projects → Inbox → Notifications → Time logs.**

The 3D office is a visual view of the team. You can do your work through the labelled navigation without interacting with the characters.

## 1. Start the office

1. Open a terminal in the project folder containing package.json.
2. Run `npm run dev`.
3. Wait for “API ready. Starting office UI.” Open http://127.0.0.1:5173.
4. If you configured a CEO access token, enter it in Settings.
5. Start Docker Desktop when you want actual AI reviews, brainstorming or coding work. Those use your configured Codex account and consume its quota.

The backend normally uses port 3001. The frontend waits for it before starting. A persistent API error should be investigated from the terminal's [API] output; changing your Outlook password will not fix a local startup error.

## 2. Check Connections once

Open **Connections** and select one account tab at a time.

### Zoho

If your Zoho account is already connected, keep it. Your connection successfully read projects, portal settings and existing time entries during verification on November 6, 2026.

For a new connection, follow the displayed Zoho OAuth setup: register the exact local callback, enter the client ID/secret in this app and sign in. Never paste account secrets into team chat. See accounts-and-actions.md for the registration details.

### Outlook and Teams

Choose the relevant tab and enable **Let my team open, navigate and check this account automatically when the app starts**. Enable the separate AI-review checkbox for reports and local reply drafts. The team opens the dedicated Edge window, reuses its saved sign-in and navigates work views. Open browser and conversation-selection clicks are not required during automatic operation. Password, MFA or consent prompts still need you; a notification identifies that condition. Organization access restrictions still apply.

The Outlook Graph setup is optional and requires its own registration/consent. You can use the signed-in browser reader without it.

## 3. Tell the team which projects matter

Open **My projects**.

1. Choose **Load my Zoho portals** and select the portal you normally use.
2. Choose **Sync accessible projects**. This reads the projects available to your connected account.
3. Keep **Only projects I select** if you want a narrow focus. Select project **20260109**, for example. Alternatively choose **All accessible numbered projects**.
4. Enter your full name exactly as shown in Teams. You may enter more than one name, one per line, if Teams uses different forms of your name.
5. Choose **Save my work focus**.

Project 20260109 was verified in your live accessible project list on November 6. General and Business Development are excluded from numbered-project message matching. They remain valid time-log destinations.

Outlook work reviews now require a matching selected, accessible project number. Another random project number in an email does not make it your project. Teams reviews look for meeting/call evidence involving your name, an explicit personal invitation/join event, or a selected project. A project-related meeting is a **candidate** for review, not proof you attended it.

Sync again when your project access changes. Accessible in Zoho does not prove that a project is commercially approved, that you performed work, or how long you worked.

## 4. Use Inbox for messages and reports

**Inbox is where you read the actual source material.** Select Outlook, Teams or AI team.

For Outlook or Teams:

For normal automatic operation, leave the automatic reader enabled. It starts with the backend and checks periodically. Outlook checks inbox previews and selected project searches. Teams visits a limited set of visible conversations, prioritizing selected projects. Only new or changed matching work messages are sent for AI review. Coverage shows which views succeeded; unloaded history and unvisited conversations remain outside the check. Use **Pause automatic reader** to stop it.

Optional manual operation:

1. Expand **Reader connection and capture**.
2. Open the dedicated reader and select the folder, opened email or Teams conversation yourself.
3. For Outlook, choose list previews or the opened email body. A list preview is not the full message.
4. Choose **Capture rendered messages** to save text locally. Enable the explicit sharing checkbox and choose **Read and ask my AI team** for an actual AI review.
5. Choose **Watch this view every minute** for ongoing checks. It monitors that selected view while the backend and reader are open. Navigation or reloading stops the watch; capture the new view and enable it again.
6. Use **Reports**, **Messages** or **Draft replies** to view one kind of content at a time.
7. Check the evidence quote and captured source before relying on an AI finding.

**Show only my work** hides unrelated earlier captures. You can uncheck it to inspect saved history. Changing this display filter does not authorize broader model sharing; My projects controls work-review focus.

Only rendered text is available. The reader does not automatically visit all Teams chats, open every email, retrieve unloaded history, read image text or download attachments. Select and capture the relevant conversations. A missing report can mean no captured item matched your focus; it does not mean the whole mailbox has no important messages.

### Replies

Open **Draft replies**, edit and save the text, mark it reviewed and choose **Copy draft**. Paste and send it yourself in Outlook or Teams. The app does not create provider drafts or send these messages. Editing a reviewed reply resets its review status.

### AI team chat

Choose AI team and a teammate to ask a question. This starts a real read-only Codex job. It does not automatically inspect accounts or perform coding changes. A failed job produces an error rather than an invented response.

## 5. Use Notifications for things needing attention

**Notifications is the attention list, not another mailbox.** It contains approvals, important findings, review results and errors. Opening an item takes you to the relevant source, draft or task in another screen.

Expand a named section: **Urgent**, **Zoho time logs**, **Other approvals**, **Problems to resolve**, **Outlook emails**, **Teams messages**, **My AI team**, or **Reports and completed work**. Each section shows its item count. Use **Search notifications** for a project, person, date or phrase; matching sections expand. **Unread only** and **Notification type** narrow the list further.

In Inbox, **Search captured inbox** filters messages, reports and reply drafts for the selected source. Messages are grouped by conversation; reports and drafts expand individually. AI-team chat groups older messages by date and has its own conversation search. Time-log drafts are collapsible and searchable by date, project or description.

- Opening or marking a notification read does not approve, submit or send anything.
- Review the exact item after opening it.
- Reading a notification does not stop an enabled time-log countdown. Pause the draft or switch off **Automatic Zoho approval** to prevent its timed submission.
- Optional desktop alerts are under **Desktop alert settings**. They require the office page to stay open.

You may see a notification about an Outlook message and the same message in Inbox. They refer to the same work: the notification points you to it, and Inbox contains its source and reply draft.

## 6. Check what is already logged in Zoho

Open **Time logs → Check dates**.

1. Confirm the portal and **My Zoho user**. A previously selected user may be filled in from your own saved time-log draft; change it if necessary.
2. If needed, load portals and project users, then select yourself. A project user list is not proof that the first user is you.
3. Select the date range, up to 32 dates.
4. Choose **Check Zoho dates**.
5. Read the “Checked” timestamp. Expand a date to see provider entries and separate local drafts.

This reads actual Zoho records, including entries you entered manually in Zoho. **You do not have to train the AI to remember which dates you submitted.** Refresh the provider check after adding, editing or deleting a log elsewhere.

| Result            | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Logged            | Zoho returned entries; there is no completed Sprout shift to compare for that date.            |
| Complete          | Recorded minutes match the work target calculated from a captured completed shift.             |
| Partial           | Some minutes are recorded, but fewer than the captured shift target.                           |
| Missing           | A completed shift exists and a complete provider check returned no entries for that user/date. |
| Over target       | Recorded minutes exceed the captured target; review, do not delete automatically.              |
| No shift evidence | No entries and no completed shift evidence. This is not a claim that you missed work.          |
| Needs review      | A duration could not be interpreted reliably.                                                  |

Drafts in this app are **not submitted time**. An unsuccessful or incomplete provider read is an error, not a missing-time result. All results apply only to the selected portal, user and dates. Organization approval status is separate from the existence of the time log.

## 7. Let Sprout trigger after-shift planning

Open **Time logs → After shift → Shift settings**.

1. Keep the work target at **480 minutes** and unpaid lunch at **60 minutes** for your normal nine-hour attendance window.
2. Enable automatic planning and explicitly authorize sharing relevant captured work context with the analyst.
3. Choose **Open Sprout browser**, sign in yourself and open **My Biologs / My Attendance Logs**.
4. Keep that window and the backend running. The PC must be awake. After an app restart, reopen the reader.
5. Clock in and out through your normal Sprout channel. The office never presses Clock In or Clock Out.

The reader refreshes recent dates using Search and Expand All, then reads your dated IN/OUT rows. An actual OUT after IN triggers a durable AI review. Nine elapsed hours, Teams going offline or closing a browser tab does not establish clock-out.

The team proposes meeting/project allocations using the saved work evidence. Durations and attendance still need your confirmation. Missing evidence remains unallocated; it is not padded to eight hours. The notification links to the plan. Use **Check attendance now** to run an immediate read.

## 8. Confirm mappings and submit only real work

### Automatic Zoho approval after 30 minutes

In **Time logs → Automatic Zoho approval**, you can enable or disable the 30-minute rule. It applies only to confirmed time-log drafts for the connected Zoho account, portal and person selected in your latest confirmed time log. Existing eligible drafts get a fresh 30-minute window when you enable it; new drafts start their window when saved. The countdown and scheduled time appear inside each draft.

Use **Pause automatic submission** to keep one draft for manual review. **Restart 30-minute timer** gives it a fresh window. Opening the editor pauses a scheduled draft immediately; saving valid changes starts the full 30 minutes again. A draft you paused manually stays paused when edited. You can still approve immediately or reject the draft yourself. Opening or marking its notification read does not stop the timer.

When the timer expires, the backend rechecks the exact draft, connected account, project/task access, current Zoho entries and the daily work target before submission. A failed check stops the timer and creates a notification. An uncertain provider write is never retried automatically. A successful submission includes a verified Zoho receipt and records your standing time-log policy as the approval source.

Keep the backend running. After downtime, overdue timers are rechecked when it starts again. The timer does not convert an unconfirmed AI allocation or missing activity evidence into actual work. Email, Teams and coding-job approvals keep their existing rules.

### Prepare a confirmed allocation

In **More tools → Work knowledge**:

1. Use **projects** to register your work project and role.
2. Use **mappings** to associate the work with actual Zoho portal/project/task or issue IDs. These are API IDs, not display keys such as TS-535-T3.
3. Confirm the billing rule and category:
   - Approved numbered project: the actual project and confirmed project number.
   - Nonproject work: SIN_TecSurge_General.
   - Proposal/prototype work before approval: SIN_TecSurge_BusinessDevelopment.
4. Use **activities** to add work you actually performed or meetings you attended, with the real date and duration. Confirm those facts. An email or chat alone does not establish hours worked.

Return to the after-shift plan. Correct/remove proposed rows, choose mappings, choose yourself from live Zoho users and confirm the actual allocation. **Confirm allocation and prepare Zoho drafts** creates local drafts.

Open **Time logs → Drafts**. Review date, user, project, task, duration, billing and description. **Check before submission** performs read-only validation. You can approve the draft immediately, pause its timer, or let the enabled 30-minute policy submit it after successful checks. Editing restarts the window for a scheduled draft.

For a manually entered log, use **Manual entry** instead: load your portal, select category/project/task and yourself, enter the real date and minutes, save a draft, then review it under Drafts. You are not required to use AI to enter time.

Before any submission the app checks existing provider entries to prevent matching duplicates. If you already entered the work directly in Zoho, refresh Check dates and review the local draft rather than submitting the same work again.

## 9. Understand errors and receipts

The previous HTTP 500 was caused by the existing-history filter, before a submission was sent. The query is corrected. Your saved draft passed the complete read-only submission check on November 6; it was not submitted during verification.

New provider errors identify the provider, method and affected endpoint. A 500 does not by itself establish a consent problem. If a write's outcome is unknown, check Zoho first; the app does not automatically resend it. A verified submitted receipt is distinct from your organization's time-log approval workflow.

## 10. Optional tools

| Feature                        | What it is for                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Office / People                | Visual workspace, teammates and real saved job activity.                                                                                                                         |
| My work profile                | Responsibilities, routines and preferences. Confirm it before sharing with an AI task.                                                                                           |
| Work knowledge: rules/learning | Correct one classification, then separately approve a reusable rule if desired. This is saved context and matching, not continuous model retraining.                             |
| Projects / New task            | Software coding jobs in approved isolated Git workspaces. Approve planning, edits, tests and final acceptance. These coding projects are separate from Zoho work-project access. |
| Meetings                       | Internal AI-team discussions. They do not certify attendance in a real Teams meeting.                                                                                            |
| Activity / CEO briefing        | Saved job history, current status and outstanding work.                                                                                                                          |
| Video ideas                    | Real brainstorming, scripts, prompts and idea review for your personal content project. Keep this separate from employer work and time logs.                                     |
| Settings                       | Access token, runner readiness, timezone, appearance and the 2D fallback.                                                                                                        |

For video ideas, choose the free-tool budget: four Flow scenes at ten credits leave ten for a retry; five use the fifty-credit ceiling. Verify the real model cost and remaining free balance first. Three ideas are alternatives, not permission to render all three. The office currently drafts production plans; Flow rendering and YouTube/Facebook publishing are not connected. Codex brainstorming still consumes its own account quota.

## Your daily checklist

Morning: start the app, confirm project focus and open Sprout. Enabled Outlook/Teams automatic readers reopen their saved sessions and navigate work views; intervene only for sign-in/access prompts. Manual capture and watch controls remain optional.

During work: review Inbox findings and Notifications. Record missing activity/meeting facts in Work knowledge. Send any copied replies yourself.

After clock-out: review the proposed shift allocation, check Zoho dates, correct mappings/durations, prepare drafts and explicitly submit only entries that are actually missing.

API references: [Zoho time-log history](https://projectsapi.zoho.com/api-docs/time_logs/bulk_time_logs), [time-log operations](https://projectsapi.zoho.com/api-docs/time_logs/time_log_operations). More technical setup is in accounts-and-actions.md, browser-readers.md and shift-planning-and-video-budget.md.
