// CI-only: NEVER run against a personal profile. All Todoist requests are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Restricted to ephemeral Windows CI runners.');
const { _electron: electron } = require(path.join(process.env.TODOIST_SMOKE_TOOLS, 'node_modules/playwright'));
const output = path.resolve('windows-validation');
fs.mkdirSync(output, { recursive: true });
(async () => {
  let app, page;
  const results = { platform: process.platform, source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tests: [], realTodoistAccountTested: false };
  const errors = [];
  try {
    app = await electron.launch({ executablePath: process.env.TODOIST_TEST_EXE, timeout: 90000, args: [], env: { ...process.env } });
    const deadline = Date.now() + 60000;
    while (!page && Date.now() < deadline) {
      page = app.windows().find(w => !w.isClosed() && w.url() === 'app://dayglance/');
      if (!page) await delay(250);
    }
    assert(page, 'Main application window did not open.');
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      localStorage.setItem('i18nextLng', 'en');
      localStorage.setItem('welcomeDismissed', 'true');
      localStorage.setItem('gettingStartedDismissed', 'true');
      localStorage.setItem('day-planner-unscheduled', JSON.stringify([{ id: 'windows-test-local', title: 'Keep native task', date: null,
        startTime: '09:00', duration: 30, completed: false, priority: 0, color: 'bg-blue-500', notes: '', subtasks: [], lastModified: new Date().toISOString() }]));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 45000 });
    const section = page.getByRole('region', { name: 'Todoist sync', exact: true });
    await section.waitFor({ state: 'visible', timeout: 30000 });
    await section.scrollIntoViewIfNeeded();
    assert.equal(await section.getByLabel('Sync mode', { exact: true }).inputValue(), 'today');
    assert.equal(await section.getByLabel('Enable automatic sync', { exact: true }).isChecked(), false);
    const top = section.locator('button[aria-expanded]');
    await top.click(); assert.equal(await top.getAttribute('aria-expanded'), 'false');
    await top.click();
    results.tests.push('Installed application starts; Today is default; automatic sync is off; header collapses.');
    let requests = 0;
    const commands = [];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const base = { description: '', priority: 4, project_id: 'work', labels: ['focus'], checked: false, is_deleted: false, due: { date: today } };
    let items = [
      { ...base, id: 'p1', content: 'Today P1 task' },
      { ...base, id: 'p4', content: 'Today P4 task', priority: 1, labels: [] },
      { ...base, id: 'future', content: 'Future task', project_id: 'other', due: { date: '2099-12-31' } },
      { ...base, id: 'undated', content: 'Undated task', labels: [], due: null },
    ];
    let fail = false;
    await page.route('https://api.todoist.com/api/v1/sync', async route => {
      requests++;
      if (fail) return route.fulfill({ status: 503, body: 'Synthetic failure' });
      const body = new URLSearchParams(route.request().postData() || '');
      commands.push(...JSON.parse(body.get('commands') || '[]'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sync_token: `mock-${requests}`, full_sync: true,
        user: { id: 'windows-smoke-account', full_name: 'Synthetic Test', tz_info: { timezone: 'Asia/Singapore' } },
        projects: [{ id: 'work', name: 'Smoke project' }, { id: 'other', name: 'Other project' }],
        labels: [{ id: 'label', name: 'focus' }], items }) });
    });
    await section.getByLabel('Personal API token', { exact: true }).fill('synthetic-not-a-real-secret');
    await section.getByRole('button', { name: 'Connect and load preview', exact: true }).click();
    await section.getByText('2 active tasks match', { exact: true }).waitFor();
    const read = () => page.evaluate(() => ({ tasks: JSON.parse(localStorage.getItem('day-planner-tasks') || '[]'),
      inbox: JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'), recycle: JSON.parse(localStorage.getItem('day-planner-recycle-bin') || '[]'),
      state: JSON.parse(localStorage.getItem('dg-todoist-state-v1:windows-smoke-account') || '{}') }));
    assert.equal((await read()).tasks.some(t => t.importSource === 'todoist'), false);
    const sync = async () => {
      const before = (await read()).state.report?.at || '';
      await section.getByRole('button', { name: 'Sync now', exact: true }).click();
      await page.waitForFunction(previous => {
        const state = JSON.parse(localStorage.getItem('dg-todoist-state-v1:windows-smoke-account') || '{}');
        return state.report?.at && state.report.at !== previous;
      }, before, { timeout: 30000 });
      await section.getByRole('button', { name: 'Sync now', exact: true }).waitFor({ state: 'visible' });
      // Wait for the application's normal persistence effect, not only the report.
      await page.waitForFunction(() => {
        const report = JSON.parse(localStorage.getItem('dg-todoist-state-v1:windows-smoke-account') || '{}').report;
        const tasks = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]');
        const inbox = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]');
        return report && tasks.filter(t => t.importSource === 'todoist' && !t.completed).length === report.calendar &&
          inbox.filter(t => t.importSource === 'todoist' && !t.completed).length === report.inbox;
      });
      return read();
    };
    let data = await sync();
    assert.equal(data.state.report.added, 2); assert.equal(data.tasks.filter(t => t.importSource === 'todoist').length, 2);
    assert(data.tasks.some(t => t.title === 'Today P4 task')); assert(data.inbox.some(t => t.id === 'windows-test-local'));
    data = await sync(); assert.equal(data.state.report.added, 0); assert.equal(data.state.report.unchanged, 2);
    results.tests.push('Read-only connection imports nothing; manual sync works with auto OFF; both Today P1/P4 appear; no duplicates.');
    await page.screenshot({ path: path.join(output, 'todoist-v2-today-en.png') });
    await section.getByLabel('Sync mode', { exact: true }).selectOption('filtered');
    await section.locator('summary').filter({ hasText: /^Advanced filters$/ }).click();
    await section.locator('summary').filter({ hasText: /^Projects ·/ }).click();
    await section.getByLabel('Smoke project', { exact: true }).check();
    await section.locator('summary').filter({ hasText: /^Labels ·/ }).click();
    await section.getByLabel('focus', { exact: true }).check();
    await section.getByLabel('Place imported tasks in', { exact: true }).selectOption('inbox');
    await section.getByText('1 active tasks match', { exact: true }).waitFor();
    data = await sync();
    assert(data.inbox.some(t => t.title === 'Today P1 task')); assert(data.tasks.some(t => t.title === 'Today P4 task'));
    results.tests.push('Advanced project/label/priority filtering works; switching destination moves only matching linked tasks.');
    await section.getByLabel('Sync mode', { exact: true }).selectOption('mirror');
    assert.equal(await section.getByRole('button', { name: 'Sync now', exact: true }).isDisabled(), true);
    await section.getByLabel('I understand that local linked-task edits can be replaced and out-of-scope copies moved to the recycle bin.', { exact: true }).check();
    data = await sync(); assert.equal(data.state.report.matched, 4);
    items = items.map(t => t.id === 'p1' ? { ...t, is_deleted: true } : t);
    data = await sync(); assert.equal(data.state.report.removed, 1);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('day-planner-recycle-bin') || '[]').some(t => t.todoist?.id === 'p1'));
    assert.equal(commands.length, 0);
    const preserved = JSON.stringify((await read()).tasks);
    fail = true;
    await section.getByRole('button', { name: 'Sync now', exact: true }).click();
    await section.getByRole('alert').waitFor();
    assert.equal(JSON.stringify((await read()).tasks), preserved);
    results.tests.push('Mirror requires consent; explicit remote deletion moves local copy to recycle; no remote writes; network failure preserves data.');
    await section.getByRole('button', { name: 'Disconnect', exact: true }).click();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('dg-todoist-token-v1')), null);
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'zh-CN'));
    await page.reload();
    await page.getByRole('button', { name: '设置', exact: true }).click({ timeout: 45000 });
    const chinese = page.getByRole('region', { name: 'Todoist 同步', exact: true });
    await chinese.waitFor({ state: 'visible' }); await chinese.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'todoist-v2-zh.png') });
    assert((await read()).inbox.some(t => t.id === 'windows-test-local'));
    assert.deepEqual(errors, []);
    results.tests.push('Disconnect removes token and retains tasks; Chinese UI renders after reload without renderer errors.');
    results.status = 'passed'; results.mockRequests = requests;
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    results.status = 'failed'; results.error = error.stack || String(error);
    if (page && !page.isClosed()) {
      fs.writeFileSync(path.join(output, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => 'unavailable'));
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    results.rendererErrors = errors;
    fs.writeFileSync(path.join(output, 'smoke-results.json'), JSON.stringify(results, null, 2));
    if (app) await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
