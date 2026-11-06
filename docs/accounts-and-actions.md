# Real AI team, Outlook and Zoho

Open the office and use **Start here → Connect Outlook and Zoho**, or the plug in the sidebar. The bell opens **Action inbox**: pending code approvals, video-idea reviews, Outlook messages, real team replies, failures and external-action receipts. Opening or marking a notification read never approves work. Selecting an item opens its relevant draft, job or conversation.

Office workers now display actual job activity. Schedule walking, gym/coffee routines and automatic simulated chat replies are disabled. Historical data is preserved. Sending a chat message queues a durable read-only Codex job, with a successful completed-turn receipt required before a teammate's response appears. A failed runner produces a failed job and notification, not a substitute response. Model usage consumes the configured account's quota.

Desktop notifications are optional, requested only from Action inbox, and show a generic count rather than email contents. The office must remain open for these browser notifications. Mail sync continues while the backend runs; there is no claimed service-worker or closed-app push service.

## Read Outlook and Teams without an application registration

Open **Inbox → Outlook/Teams → Open browser**, sign in normally, and select the messages to capture. Enable the explicit AI-sharing choice to request real urgency reports and local reply drafts. Review, edit and copy replies, then send them yourself in Outlook or Teams. The reader covers only rendered messages in the selected view; watching checks that view every minute and stops on navigation. See the [step-by-step browser reader guide](browser-readers.md).

The browser reader requires installed Edge on the backend PC. It uses a separate persistent profile, respects normal account access restrictions and never sends anything. It does not require an Entra app registration. The optional Graph connector below is a separate read-only route when application registration and consent are available.

## Optional read-only Outlook Graph setup

1. In Microsoft Entra **App registrations**, create **My AI Office**. For a work account, your organization's administrator may need to allow app registration or grant consent.
2. Register a **public/native desktop** redirect matching the exact callback shown in the app, normally **http://127.0.0.1:3001/api/accounts/outlook/callback**. Microsoft's portal currently rejects HTTP 127.0.0.1 in some redirect textboxes: add it in the Manifest instead. In the Microsoft Graph manifest format, merge the URL into **publicClient.redirectUris**; do not replace unrelated app settings. The old Azure AD Graph manifest uses **replyUrlsWithType** with native type. See [Microsoft's loopback restrictions](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#prefer-127001-over-localhost) and [public-client manifest settings](https://learn.microsoft.com/en-us/entra/identity-platform/reference-microsoft-graph-app-manifest#publicclient-attribute).
3. Add delegated **User.Read** and **Mail.Read**. The app also requests offline access for renewal. Copy the Application/client ID and, for a single-tenant company app, the Directory/tenant ID into the optional Outlook Graph setup form. No Microsoft client secret is required. No write or send scope is requested.
4. Save, choose **Sign in to Microsoft**, and authorize the account you use in Outlook. Return to the office. The initial inbox sync begins after authorization; **Inbox → Outlook API → Fetch/Resume** also starts it.

The initial sync follows every inbox next-page link, with no latest-message or date cutoff. Page progress and opaque delta cursors persist in SQLite, so an interrupted sync resumes instead of pretending it finished. Subsequent syncs use Microsoft's delta link every five minutes while the backend runs. This covers the Inbox folder, not all archive/sent folders. Attachments are not downloaded. Lists are paginated; full message bodies load only when opened.

Project numbers and registered project names/aliases match locally. Proposal/prototype wording flags Business Development for review. These are transparent matching rules, not invented AI analysis. An email or project number is not proof of approved project stage or time worked.

Select an email and explicitly choose **Ask my analyst to review this email** to send up to 16,000 body characters to the real Codex analyst. Unselected mailbox content is not automatically sent to a model. Truncated content is identified in the request.

Write a reply, save it locally and inspect the recipients, subject and body. Mark it reviewed and copy it for manual sending in Outlook. The backend rejects all Outlook write requests even if an older account grant included send permissions. No email is sent and no provider draft is created. Historical provider receipts remain available for audit.

## Connect Zoho and record your actual work

1. In the Zoho API console for your data center, create a **Server-based application**. Your screenshots use the .com data center.
2. Register the exact callback shown by the app, normally **http://127.0.0.1:3001/api/accounts/zoho/callback**. Use the local office URL as homepage.
3. Enter the client ID and secret in the app's Zoho setup form, save, then sign in. Never paste secrets into chat. Authorization requests the documented read scopes for portals/projects/task lists/tasks/issues/project users/time logs and **ZohoProjects.timesheets.CREATE**.
4. Open **Time logs → Load my Zoho portals**. Choose a live portal, category and project, then task/issue or supported general entry. Choose yourself from the live project users; neither the first user nor the portal owner is assumed to be you.

Your routing rules are:

| Actual work                                        | Destination                                         |
| -------------------------------------------------- | --------------------------------------------------- |
| Work on an approved numbered project               | That exact live project; confirm its project number |
| Work outside a project                             | SIN_TecSurge_General                                |
| Proposal-stage work or prototyping before approval | SIN_TecSurge_BusinessDevelopment                    |

Project active status does not establish proposal approval. Visible project numbers and task keys such as TS-535-T3 are labels; API requests use the corresponding live numeric IDs.

Enter the work date, actual minutes, optional matching start/end times, billing and description. Confirm the work actually occurred. Dates use your Asia/Manila context; check that supplied clock times correspond to your Zoho portal's time settings. Future dates/times and inconsistent durations are rejected. Email timestamps never become hours worked.

Save a draft, inspect it in the action inbox, and separately **Approve and submit time log**. Drafts can be edited or rejected. Editing changes their version/hash and invalidates prior review. The server checks live project/user/task availability, portal settings and existing entries before posting. It also blocks identical local submissions and overlapping specified local ranges. Existing provider logs are available through **Check my existing Zoho logs for this date**.

The optional **Time logs → Automatic Zoho approval** policy authorizes confirmed drafts for the saved account, portal and person after a 30-minute review window. It does not approve other action types or unconfirmed AI allocations. Each timer binds the exact draft version/hash; opening the editor pauses it, and saving valid changes restarts the window. Pause individual drafts or disable the policy to prevent timed submission. Before sending, current provider data and the daily work target are checked again. Policy versions and approval hashes are retained, and unknown outcomes are never retried automatically. See the [user guide](user-guide.md#automatic-zoho-approval-after-30-minutes).

Creation uses the current v3 JSON module object, owner ZPUID, bill status, date, notes and hours or start/end times. The service reads the resulting log back and compares its provider ID, project, user, date, duration, billing, module and notes. App approval is distinct from your organization's approval workflow, which may remain pending.

An accepted write without matching readback is **UNKNOWN_OUTCOME**, with no automatic retry or editable resend. Check the provider before deciding what to do next. Provider or organizational permission denials are surfaced; browser access does not bypass them.

## Credential storage and verification

Credentials are stored in a separate encrypted vault beside the selected database: company.sqlite.credentials for the default database. AES-256-GCM protects each entry with an authenticated name. Windows DPAPI protects the vault key for the current Windows user. Tokens and client secrets are absent from ordinary SQLite records, snapshots, logs and model workspaces. Non-Windows hosts require an explicit base64 32-byte OFFICE_VAULT_KEY environment value. Back up the database, job artifacts and vault together; a DPAPI key is tied to its Windows user.

OAuth uses short-lived, one-time browser-bound state; Microsoft additionally uses PKCE. Provider origins are allowlisted, remote paging links cannot redirect credentials to another host, and account changes invalidate old-context submissions. The callback is the only account API that can complete without the CEO bearer token, and still requires the matching state and browser cookie.

Automated tests use injected HTTP/model fixtures and isolated databases/vaults. Those fixtures are never production connectors. Run **npm run check** and **npm run test:browser**. The explicit live CLI check **node --env-file-if-exists=.env --import tsx scripts/chat-smoke.ts** uses a disposable database and never accesses mailbox/Zoho accounts. Real browser capture and model review were verified on November 5, 2026; see the reader guide. Graph and Zoho API verification still require their own registration and consent. No emails or time logs are sent as a setup test.

Official contracts: [Microsoft delegated OAuth](https://learn.microsoft.com/en-us/graph/auth-v2-user), [inbox delta](https://learn.microsoft.com/en-us/graph/api/message-delta), [reply semantics](https://learn.microsoft.com/en-us/graph/api/message-reply), [Zoho portals](https://projectsapi.zoho.com/api-docs/portals), [project users](https://projectsapi.zoho.com/api-docs/users/project_users), [time-log operations](https://projectsapi.zoho.com/api-docs/time_logs/time_log_operations), [time-log lists](https://projectsapi.zoho.com/api-docs/time_logs/bulk_time_logs), [portal restrictions](https://projectsapi.zoho.com/api-docs/time_logs/settings).
