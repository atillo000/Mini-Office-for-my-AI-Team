# Read Outlook and Teams in your signed-in browser

Use **Inbox → Outlook** or **Inbox → Teams**. These browser readers use real visible messages and real Codex review jobs. They do not require a Microsoft application registration. Normal sign-in, MFA and your organization's access restrictions still apply.

## First use

1. Start the backend with **npm start**, or both development servers with **npm run dev**. The browser reader needs installed Microsoft Edge on the backend PC. Docker and the configured Codex account are needed for AI reviews.
2. Open **Inbox → Outlook/Teams → Open browser**. Complete sign-in yourself in the dedicated Edge window. Its separate profile retains your session; it does not import credentials from your regular browser.
3. In Outlook, select a mail folder and choose **Rendered mail-list previews**, or open an email and choose **Opened email body**. In Teams, open one conversation so its messages are visible.
4. Choose **Capture rendered messages** to save locally. To request an AI report and useful reply drafts, enable **Share captured text with my AI analyst**, then choose **Read and ask my AI team**. This sends that captured text to the configured model and consumes its quota.
5. Read **AI reports**, the supporting quotes and **Read captured source**. Urgency labels are AI assessments for review. Missing or ambiguous sent times limit deadline interpretation; a capture's observation time is not its sent time.
6. Under **Local reply drafts**, edit and save, mark reviewed, then **Copy draft**. Paste and send it yourself in Outlook or Teams. Reviewing or copying never sends anything. Editing a reviewed draft returns it to draft status.

The notification bell opens the action inbox. New captured messages, important/urgent AI assessments, completed or failed review jobs and draft replies link to the relevant conversation or report. Optional desktop notifications require the office to remain open.

## Watching for updates

**Watch this view every minute** captures the selected view while the backend and its reader window remain open. With AI sharing enabled, new or changed messages queue another real review. Stop watching to change sharing or capture mode. Navigation, reload or a changed conversation stops the watch; select, capture and enable it again. Saved reports remain available after restarting, but watching must be enabled again.

Captures cover only rendered text: up to 50 rows/messages, 6,000 characters per message and 48,000 total. Mail-list captures are previews. Other folders, other chats, unloaded history, attachments, hidden content and text in images are not reviewed. There is no claim that the whole inbox or all Teams conversations were checked. Scroll or open another conversation yourself and capture it to review more. Repeated reviews preserve existing local drafts for unchanged source versions, including your edits and archived drafts.

The reader does not click provider controls, type credentials, extract tokens, create provider drafts or send messages. If organizational policy prevents sign-in or reading, it reports that condition. This is not a way to override denied permissions.

## Why not the C# Outlook library?

The library you remember is likely **Microsoft.Office.Interop.Outlook**, using the classic Outlook object model/MAPI session. Your installed new Outlook requires a different approach. Microsoft documents [the classic Outlook namespace API](https://learn.microsoft.com/en-us/dotnet/api/microsoft.office.interop.outlook._application.getnamespace?view=outlook-pia) and [new Outlook's lack of COM add-in support](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/one-outlook). The office therefore uses the signed-in browser view for both Outlook and Teams.

An optional read-only Microsoft Graph connector remains under **Connected applications → Optional Graph setup**. It requires its own application registration and allowed consent, and can paginate the entire Inbox folder. It never sends email. Zoho still needs its separate OAuth setup and exact approval before time-log submission; see [accounts and actions](accounts-and-actions.md).

## Local storage and verification

Captured text, reports and local drafts are stored in the selected SQLite database. Review requests and actual CLI receipts are retained under **.data/jobs/**. Edge's signed-in profiles are beside the database in **company.sqlite.browser/** by default. Protect these files as private account data; sign out in the managed window when you want to end its provider session. They are not copied into coding workspaces.

On November 5, 2026, live checks captured seven Outlook mail previews and nineteen messages from the selected Teams conversation. Two actual Codex review jobs completed and saved two reports and five local reply drafts. No Outlook email, Teams message or provider draft was created or sent. Automated browser tests use separate, explicitly labeled QA content and disposable databases.
