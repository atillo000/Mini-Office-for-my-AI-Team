import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const root = process.cwd();
await mkdir('test-results', { recursive: true });
const runId = Date.now();
const databasePath = path.resolve('test-results', 'browser-' + runId + '.sqlite');
// Explicit QA records in the disposable database only; never in the user's office.
const fixtureDb = new DatabaseSync(databasePath);
fixtureDb.exec(
  'CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))',
);
const fixturePut = (kind, id, data) =>
  fixtureDb
    .prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?)')
    .run(kind, id, JSON.stringify(data));
const fixtureText = 'QA-only message: please review the proposal today.';
fixturePut('captured_messages', 'qa-teams-message', {
  id: 'qa-teams-message',
  provider: 'teams',
  sourceId: 'qa-rendered-row',
  scope: 'QA project chat',
  sourceUrl: 'https://teams.cloud.microsoft/v2/',
  text: fixtureText,
  author: 'QA colleague',
  sentAt: '',
  preview: false,
  firstSeenAt: runId,
  observedAt: runId,
  version: 1,
});
fixturePut('communication_reports', 'qa-communication-report', {
  id: 'qa-communication-report',
  jobId: 'qa-review-job',
  snapshotId: 'qa-capture',
  provider: 'teams',
  scope: 'QA project chat',
  summary: 'QA-only report for one captured message.',
  coverage: 'Only one rendered QA message was checked.',
  createdAt: runId,
  assessments: [
    {
      messageId: 'qa-teams-message',
      urgency: 'URGENT',
      reason: 'QA-only urgency classification',
      evidence: 'review the proposal today',
      draftReply: 'QA-only reply draft',
      sourceText: fixtureText,
      sourceObservedAt: runId,
    },
  ],
});
fixturePut('local_reply_drafts', 'qa-local-draft', {
  id: 'qa-local-draft',
  provider: 'teams',
  sourceMessageId: 'qa-teams-message',
  reportId: 'qa-communication-report',
  scope: 'QA project chat',
  body: 'QA-only reply draft',
  status: 'DRAFT',
  origin: 'AI',
  version: 1,
  createdAt: runId,
  updatedAt: runId,
});
fixtureDb.close();
const projectPath = path.resolve('test-results', `project-${runId}`);
await mkdir(projectPath);
await writeFile(path.join(projectPath, 'README.md'), '# Browser QA fixture\n');
for (const args of [
  ['init', projectPath],
  ['-C', projectPath, 'add', 'README.md'],
  [
    '-C',
    projectPath,
    '-c',
    'user.name=Browser QA',
    '-c',
    'user.email=qa@example.invalid',
    'commit',
    '-m',
    'Create isolated QA fixture',
  ],
]) {
  const result = spawnSync('git', args, { shell: false, windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr.toString());
}
const freePort = () =>
  new Promise((resolve) => {
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1', () => {
      const port = listener.address().port;
      listener.close(() => resolve(port));
    });
  });
const apiPort = await freePort();
const clientPort = await freePort();
const processes = [];
const serverLogs = [];
function start(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    shell: false,
    windowsHide: true,
    stdio: 'pipe',
  });
  processes.push(child);
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      serverLogs.push(data.toString().slice(-2000));
      if (serverLogs.length > 20) serverLogs.shift();
    });
  return child;
}
start(['--import', 'tsx', 'server/index.ts'], {
  PORT: String(apiPort),
  HOST: '127.0.0.1',
  CEO_TOKEN: '',
  COMPANY_DB: databasePath,
  OFFICE_OFFLINE: '1',
});
start(['--import', 'tsx', 'scripts/dev-client.ts'], {
  API_URL: `http://127.0.0.1:${apiPort}`,
  DEV_UI_PORT: String(clientPort),
});
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* server starting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server did not start: ${url}`);
}
let browser;
let qaPage;
const errors = [];
const checks = [];
try {
  await Promise.all([
    ready(`http://127.0.0.1:${apiPort}/api/health`),
    ready(`http://127.0.0.1:${clientPort}`),
  ]);
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  qaPage = page;
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text) => {
          window.__qaCopiedDraft = text;
        },
      },
    }),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${clientPort}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.locator('.avatar-label').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.locator('.avatar-label').count(), 9);
  assert.equal(await page.locator('.worker-badge[data-activity] .activity-state').count(), 9);
  const label = await page.locator('.avatar-label').first().boundingBox();
  assert(label.width < 150 && label.height < 80, '3D labels must retain readable screen size');
  checks.push('3D canvas, nine avatars, correctly sized labels');
  await page.screenshot({ path: 'test-results/office-desktop.png', fullPage: true });
  await page.locator('.floor-selector > button').click();
  await page.locator('.room-menu button').filter({ hasText: 'Your office' }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'test-results/office-executive.png', fullPage: true });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Fit office', exact: true }).click();
  await page.waitForTimeout(1800);
  checks.push('Room focus, eased camera zoom, and whole-office framing');
  await page.locator('.team-card').filter({ hasText: 'Alex Morgan' }).click();
  await page.getByRole('heading', { name: 'Alex Morgan' }).waitFor();
  await page.getByTestId('execution-status').getByText('No coding job running').waitFor();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Browser QA: hello Alex');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.locator('.chat-message.mine').filter({ hasText: 'Browser QA: hello Alex' }).waitFor();
  assert.equal(await page.locator('.chat-message:not(.mine)').count(), 0);
  checks.push('Real chat job queued without a fabricated assistant reply');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByText('Analytical, patient, quietly witty').waitFor();
  checks.push('Employee profile and availability from actual job records');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Browser QA project');
  await page
    .getByLabel('Absolute path to an existing Git repository', { exact: true })
    .fill(projectPath);
  await page.locator('.connect-project input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Connect approved workspace' }).click();
  await page.locator('.project-info').filter({ hasText: 'Browser QA project' }).waitFor();
  await page
    .locator('.section-heading.inner')
    .getByRole('button', { name: 'New task', exact: true })
    .click();
  await page
    .getByLabel('What would you like to build?')
    .fill('Create a small, tested greeting function.');
  await page.getByRole('button', { name: 'Create task for review' }).click();
  await page.locator('.job-list > button').first().click();
  assert(await page.getByRole('button', { name: 'Approve planning' }).isDisabled());
  await page.locator('.job-heading .status').filter({ hasText: 'draft' }).waitFor();
  checks.push('Approved Git workspace, task draft, unavailable execution stays gated');
  await page.getByRole('button', { name: 'Start here', exact: true }).first().click();
  const startPanel = page.locator('.start-panel');
  await startPanel.getByRole('button', { name: 'Set up my video project', exact: true }).click();
  await startPanel.getByRole('heading', { name: 'AI Video Studio', exact: true }).waitFor();
  await startPanel.getByLabel('Video scene budget').selectOption('4');
  const budget = await (
    await page.request.get('http://127.0.0.1:' + clientPort + '/api/studio')
  ).json();
  assert.equal(budget.production.sceneCount, 4);
  assert.equal(budget.production.allowPaidTopUps, false);
  checks.push(
    'Free-only four-scene production plan persists with 50-credit ceiling and no paid top-ups',
  );
  assert(await startPanel.getByRole('button', { name: 'Ask team for 3 drafts' }).isDisabled());
  await startPanel.getByRole('button', { name: 'My work profile', exact: true }).click();
  assert(
    (await startPanel.getByLabel('What I do', { exact: true }).inputValue()).includes(
      'video content project',
    ),
  );
  await startPanel
    .getByLabel('My routines', { exact: true })
    .fill('I review video ideas after work.');
  await startPanel
    .getByLabel('I reviewed this profile and confirm it describes my preferences.')
    .check();
  await startPanel.getByRole('button', { name: 'Save my profile', exact: true }).click();
  await page.getByText('Work profile saved', { exact: true }).waitFor();
  await startPanel.getByRole('button', { name: 'Video ideas', exact: true }).click();
  await startPanel.locator('.studio-ideas > button').first().click();
  const ideaReview = startPanel.getByRole('article', { name: 'Review video idea' });
  await ideaReview
    .getByLabel('Your feedback', { exact: true })
    .fill('Use a clear hook in the first scene.');
  await ideaReview.getByLabel('Remember this feedback for future idea requests.').check();
  await ideaReview.getByRole('button', { name: 'Approve idea', exact: true }).click();
  await ideaReview.getByRole('button', { name: 'Download approved production brief' }).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await ideaReview.getByRole('button', { name: 'Download approved production brief' }).click();
  assert.equal((await downloadPromise).suggestedFilename(), 'approved-video-brief.txt');
  await ideaReview.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await ideaReview.getByLabel('Title', { exact: true }).fill('The voice note: revised for review');
  await ideaReview.getByRole('button', { name: 'Save draft edits', exact: true }).click();
  await startPanel.locator('.studio-ideas .status').filter({ hasText: 'draft' }).waitFor();
  assert.equal(
    await startPanel.getByRole('button', { name: 'Download approved production brief' }).count(),
    0,
  );
  await page.screenshot({ path: 'test-results/office-video-studio.png', fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start here', exact: true }).first().click();
  await page.getByRole('button', { name: 'My work profile', exact: true }).click();
  assert.equal(
    await page.getByLabel('My routines', { exact: true }).inputValue(),
    'I review video ideas after work.',
  );
  const studioState = await (
    await page.request.get('http://127.0.0.1:' + clientPort + '/api/studio')
  ).json();
  assert.equal(studioState.ideas[0].status, 'DRAFT');
  assert.equal(studioState.ideas[0].approval, undefined);
  assert.deepEqual(studioState.rememberedFeedback, [
    'APPROVED: Use a clear hook in the first scene.',
  ]);
  checks.push(
    'Video project setup, persistent confirmed profile, gated generation, remembered feedback, exact idea approval and approval invalidation after edits',
  );
  await page.getByRole('button', { name: 'Work knowledge', exact: true }).click();
  const workPanel = page.locator('.management-panel .work-center');
  await workPanel.getByRole('heading', { name: 'Work knowledge', exact: true }).waitFor();
  await workPanel
    .locator('.panel-tabs')
    .getByRole('button', { name: 'projects', exact: true })
    .click();
  await workPanel.getByRole('button', { name: 'New work project', exact: true }).click();
  await workPanel.getByLabel('Project name', { exact: true }).fill('QA Apollo');
  await workPanel.getByLabel('Aliases (comma-separated)', { exact: true }).fill('QA-AP');
  await workPanel.getByLabel('My role', { exact: true }).selectOption('TECHNICAL_LEAD');
  await workPanel.getByRole('button', { name: 'Save project', exact: true }).click();
  await workPanel.locator('.work-row').filter({ hasText: 'QA Apollo' }).waitFor();
  await workPanel
    .locator('.panel-tabs')
    .getByRole('button', { name: 'activities', exact: true })
    .click();
  await workPanel.getByRole('button', { name: 'Add activity or input', exact: true }).click();
  await workPanel.getByLabel('Record type', { exact: true }).selectOption('MEETING');
  await workPanel.getByLabel('Title or subject', { exact: true }).fill('QA project review');
  await workPanel
    .getByLabel('Work description or supplied content', { exact: true })
    .fill('Attended the QA-AP project review meeting.');
  await workPanel
    .getByLabel('Activity date (leave blank if unknown)', { exact: true })
    .fill('2026-11-04');
  await workPanel.getByLabel('Start time (optional)', { exact: true }).fill('09:00');
  await workPanel.getByLabel('End time (optional)', { exact: true }).fill('10:00');
  await workPanel.getByLabel('I confirm this work actually happened', { exact: true }).check();
  await workPanel.getByLabel('I confirm I attended this meeting', { exact: true }).check();
  await workPanel.getByRole('button', { name: 'Save and classify', exact: true }).click();
  const workRecord = workPanel.locator('.work-record').filter({ hasText: 'QA project review' });
  await workRecord.getByText('QA Apollo', { exact: false }).waitFor();
  assert((await workRecord.innerText()).includes('60 min'));
  await workRecord.getByRole('button', { name: 'Correct classification', exact: true }).click();
  while (await workRecord.locator('.work-labels input:checked').count())
    await workRecord.locator('.work-labels input:checked').first().uncheck();
  await workRecord.getByLabel('general', { exact: true }).check();
  await workRecord.getByLabel('Work project', { exact: true }).selectOption('');
  await workRecord
    .getByLabel('Correction explanation', { exact: true })
    .fill('Keep this review as general work.');
  await workRecord.getByLabel('Confirm for this record only', { exact: true }).check();
  await workRecord.getByRole('button', { name: 'Save correction', exact: true }).click();
  await workPanel
    .locator('.panel-tabs')
    .getByRole('button', { name: 'learning', exact: true })
    .click();
  await workPanel.getByRole('button', { name: 'Create reusable rule', exact: true }).click();
  await workPanel.getByLabel('Rule name', { exact: true }).fill('QA review classification');
  await workPanel
    .getByLabel('Matching phrases (comma-separated)', { exact: true })
    .fill('QA project review');
  await workPanel
    .getByLabel('Apply this explicit rule to future matching input', { exact: true })
    .check();
  await workPanel.getByRole('button', { name: 'Save rule', exact: true }).click();
  await workPanel.getByText('Reusable rule confirmed', { exact: true }).waitFor();
  checks.push(
    'Persistent project knowledge, confirmed meeting time, explicit correction and separate rule approval',
  );
  await page.screenshot({ path: 'test-results/office-work-knowledge.png', fullPage: true });
  await page.getByRole('button', { name: 'Connected applications', exact: true }).click();
  await page.getByRole('heading', { name: 'Connected accounts', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Outlook browser reader', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Teams browser reader', exact: true }).waitFor();
  await page.getByText('Optional Outlook read-only Graph setup', { exact: true }).click();
  const microsoft = page.locator('.account-setup').filter({ hasText: 'Microsoft Outlook' });
  const zoho = page.locator('.account-setup').filter({ hasText: 'Zoho Projects' });
  await microsoft.getByLabel('Application client ID', { exact: true }).fill('browser-qa-client');
  await microsoft.getByRole('button', { name: 'Save connection settings', exact: true }).click();
  await microsoft.getByRole('button', { name: 'Sign in to Microsoft', exact: true }).waitFor();
  assert((await microsoft.innerText()).includes('Not connected'));
  await zoho.getByLabel('Application client ID', { exact: true }).fill('browser-qa-zoho');
  await zoho
    .getByLabel('Zoho client secret', { exact: true })
    .fill('fixture-secret-not-a-real-credential');
  await zoho.getByRole('button', { name: 'Save connection settings', exact: true }).click();
  await zoho.getByRole('button', { name: 'Sign in to Zoho', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/office-account-setup.png', fullPage: true });
  checks.push('Guided Microsoft/Zoho setup stores config without claiming connected accounts');
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await page.locator('.panel-tabs').getByRole('button', { name: 'Teams', exact: true }).click();
  await page.getByRole('heading', { name: 'Teams browser reader', exact: true }).waitFor();
  const localDraft = page.getByRole('article', { name: 'Local reply draft' });
  await localDraft.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
  await localDraft.locator('.status').filter({ hasText: 'reviewed' }).waitFor();
  await localDraft.getByRole('button', { name: 'Copy draft', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__qaCopiedDraft), 'QA-only reply draft');
  await localDraft.getByLabel('Local reply text').fill('QA-only revised draft');
  await localDraft.getByRole('button', { name: 'Save edits', exact: true }).click();
  await localDraft.locator('.status').filter({ hasText: 'draft' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Approve and send/ }).count(), 0);
  await page.screenshot({ path: 'test-results/office-reader-drafts.png', fullPage: true });
  checks.push(
    'Browser-reader controls, evidence-backed report UI, local review/copy and edit invalidation; no send control',
  );
  await page.getByRole('button', { name: 'Time logs', exact: true }).click();
  await page.getByRole('heading', { name: 'Time logs', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'After-shift planning', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Shift settings', exact: true }).click();
  assert.equal(await page.getByLabel('Unpaid break (minutes)', { exact: true }).inputValue(), '60');
  assert.equal(await page.getByLabel('Work target (minutes)', { exact: true }).inputValue(), '480');
  await page.getByLabel('Automatically plan after Sprout clock-out').check();
  await page.getByRole('button', { name: 'Save shift settings', exact: true }).click();
  const shiftState = await (
    await page.request.get('http://127.0.0.1:' + clientPort + '/api/shifts')
  ).json();
  assert.equal(shiftState.settings.enabled, true);
  assert.equal(shiftState.settings.shareWithAI, false);
  assert.equal(shiftState.reader.open, false);
  checks.push(
    'Shift target and unpaid lunch configuration persist without inventing a Sprout connection or sharing consent',
  );
  await page.getByLabel('Work category', { exact: true }).selectOption('BUSINESS_DEVELOPMENT');
  assert(await page.getByRole('button', { name: 'Save time log for approval' }).isDisabled());
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const approval = page
    .locator('.action-items article')
    .filter({ hasText: 'Create a small, tested greeting function.' });
  await approval.locator('.action-open').click();
  await page.getByRole('button', { name: 'Approve planning', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Approve planning', exact: true }).isDisabled());
  checks.push(
    'Unified notification opens the exact pending job; disconnected time logs stay gated',
  );
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await page.getByRole('button', { name: 'Bring the team together' }).click();
  await page.getByLabel('Meeting title').fill('Browser QA catch-up');
  await page.getByLabel('What’s on the agenda?').fill('Review the next small step.');
  await page.getByRole('button', { name: 'Schedule meeting', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser QA catch-up' }).waitFor();
  checks.push('Meeting scheduling and participant selection');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  assert.equal(await page.locator('.simulation-controls').count(), 0);
  checks.push('Schedule simulation controls removed; worker labels reflect actual work');
  const lightingToggle = page.getByRole('button', { name: 'Toggle day and night', exact: true });
  if (await page.locator('.world-container').evaluate((el) => el.classList.contains('night'))) {
    await lightingToggle.click();
    await page.locator('.world-container:not(.night)').waitFor();
  }
  await lightingToggle.click();
  await page.locator('.world-container.night').waitFor();
  await page.screenshot({ path: 'test-results/office-night.png', fullPage: true });
  await lightingToggle.click();
  await page.locator('.world-container:not(.night)').waitFor();
  checks.push('Day and night controls');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile layout must not overflow',
  );
  await page.screenshot({ path: 'test-results/office-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Start here', exact: true }).first().click();
  await page.getByRole('button', { name: 'Video ideas', exact: true }).click();
  await page.locator('.studio-ideas > button').first().click();
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile video studio must not overflow',
  );
  await page.screenshot({ path: 'test-results/office-video-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Lightweight 2D view').check();
  await page.locator('.fallback-world').waitFor();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  assert.equal(await page.locator('.floorplan section').count(), 8);
  await page.screenshot({ path: 'test-results/office-2d.png', fullPage: true });
  checks.push('390px mobile layout and usable 2D fallback');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { passed: checks, browserErrors: errors, screenshots: 'test-results/office-*.png' },
      null,
      2,
    ),
  );
} catch (error) {
  await qaPage
    ?.screenshot({ path: 'test-results/browser-failure.png', fullPage: true })
    .catch(() => {});
  console.error(JSON.stringify({ browserErrors: errors, serverLogs }));
  throw error;
} finally {
  await browser?.close();
  for (const child of processes) {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
    else child.kill('SIGTERM');
  }
}
