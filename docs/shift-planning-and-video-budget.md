# After-shift Zoho drafts and free video planning

## Sprout and Zoho

Open **Time logs → Shift settings**. The defaults for your workflow are **480 work minutes** and a **60-minute unpaid break**: nine hours between clock-in and clock-out normally produces an eight-hour work budget. Shorter attendance produces a smaller budget; missing time is never padded to eight hours. Overtime is not included automatically.

Enable **Automatically plan after Sprout clock-out** and explicitly allow sharing the selected work context with the AI analyst. Open the dedicated Sprout browser, sign in yourself at **https://tecsurge.hrhub.ph/LogIn.aspx**, and open **My Biologs / My Attendance Logs**. Your company redirects to its **tecsurge-v2** tenant. Set a recent work-date range, Search and expand the day's entries. Your Sprout clock-in/out actions remain yours; the office never clocks you in or out.

Attendance checks run every minute while the backend and dedicated browser remain open. On the current My Attendance Logs screen, the reader updates the date range to the last three local dates, uses Search and Expand All, then reads the rendered entries. It never presses Clock In, Clock Out or attendance-edit controls. Complete, dated IN/OUT pairs trigger durable Codex review jobs for clock-outs within 36 hours, including shifts across midnight. An open shift does not trigger a finished-day claim. On restart, reopen the Sprout reader. Captured punches and plans persist.

The end-of-shift signal is a dated **OUT** entry after your **IN** entry in Sprout. Nine elapsed hours, Teams presence, closing the office tab or signing out of Windows do not trigger it. After restarting the app, choose **Time logs → Open Sprout browser**, verify My Attendance Logs is visible, and keep that window and the backend running. Clock out normally through your usual Sprout channel. The next successful minute check sees the OUT, saves the completed interval and queues one review for that shift version. Use **Check attendance now** for an immediate check. If the reader is closed, sign-in expires, or Sprout cannot load the records, monitoring cannot see the clock-out; the UI shows the reader error rather than assuming your day ended. Zoho work still waits for your review.

In **Inbox → Teams**, capture or watch the conversations relevant to your work. The shift analyst receives relevant saved captures and work records, project knowledge and confirmed Zoho mappings. It cannot read other chats or unloaded history automatically. Add confirmed activities and meeting participation in **Work knowledge** when the chat does not establish what you actually did. A meeting invitation or someone else's call does not prove your attendance or duration.

The notification bell links to the proposed allocation. Review every meeting, date and duration. Unsupported time remains unallocated. Edit or remove rows and choose confirmed mappings. In **Work knowledge → Zoho mappings**, set actual live portal/project/task IDs, the billing rule and category:

- **Approved numbered project:** confirm its project number.
- **SIN_TecSurge_General:** work outside a project.
- **SIN_TecSurge_BusinessDevelopment:** proposal-stage work or prototyping before approval.

Choose yourself from live Zoho project users, confirm the actual allocation and prepare Zoho drafts. Review and separately submit each exact draft through the existing Zoho approval flow. Nothing is submitted at clock-out. Zoho OAuth must be connected before live discovery or draft validation. Corrected attendance, changed settings/mappings and duplicate preparation are checked. Interrupted preparation retains any local drafts already created.

## Free video production policy

**Start here → Video ideas → Free-tool production plan** controls future brainstorming:

| Plan                              | Estimated first-pass credits | Retry reserve |
| --------------------------------- | ---------------------------- | ------------- |
| Four scenes, one output per scene | 40                           | 10            |
| Five scenes, one output per scene | 50                           | 0             |

The default is five scenes. This assumes **Flow Veo 3.1 Lite at 10 credits per generation** and a **50-credit daily ceiling**. Four scenes do not cost exactly 50; the remaining ten are reserved for one retry. Three brainstormed ideas are alternatives: only one selected video fits that shared daily budget. Multiple outputs, retries and extensions each consume budget.

Google currently documents 50 daily Flow credits and different costs by model: Lite is 10 for non-Ultra users, Fast is 20 and Quality is 100. Costs are per generated output, not per request, and may change. Check the selected model, actual remaining free balance and refresh date in the account before generation. Never buy top-ups, subscribe, switch to paid credits or silently exceed the cap. Unused daily credits do not roll over. [Google's official credit guide](https://support.google.com/flow/answer/16526234?hl=en).

The team now receives this policy in all three brainstorming/writing stages and generated ideas must match the selected scene count. Short source clips can be assembled with free local tools such as FFmpeg, using cuts, narration and holds to fit the final script. Asset licenses still need checking. Changing the plan invalidates a queued request's old drafting consent.

**This adds production instructions and budget validation, not a connected Flow renderer.** Brainstorming uses the configured Codex account and its quota; “free-only” refers to the video production tools. The office does not spend Flow credits, render clips, or publish to YouTube/Facebook. Existing ideas remain intact; older scene layouts may need revision to fit the new plan.

## Live verification

On November 5, 2026, the signed-in Sprout reader refreshed the recent date range and parsed five dated punches: three clock-ins and two clock-outs. A real Codex job reviewed the recent completed shift and saved a draft plan. With no captured work evidence for that work date, it correctly left 480 minutes unallocated. Today's open shift did not create a completed-day job. No Zoho time log was submitted and no Flow credits were spent.

Sprout reference: [My Biologs is the employee view for validating attendance logs](https://guide.sprout.ph/how-to-clock-in/out-using-the-clock-in-homepage).
