// CI-only test. Uses an ephemeral Windows runner and synthetic Todoist data.
// Never run this against a personal profile: it seeds disposable test tasks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('This smoke test is restricted to ephemeral GitHub Windows runners.');
}
const { _electron: electron } = require(path.join(process.env.TODOIST_SMOKE_TOOLS, 'node_modules/playwright'));
const output = path.resolve('windows-validation');
fs.mkdirSync(output, { recursive: true });

(async () => {
  let app;
  let page;
  const results = { platform: process.platform, source: process.env.GITHUB_SHA, tests: [] };
  const errors = [];
  try {
    app = await electron.launch({ executablePath: process.env.TODOIST_TEST_EXE,
      timeout: 90000, args: [], env: { ...process.env } });
    // Fresh installs briefly create a hidden storage-migration window first.
    const deadline = Date.now() + 60000;
    while (!page && Date.now() < deadline) {
      page = app.windows().find(window => !window.isClosed() && window.url() === 'app://dayglance/');
      if (!page) await delay(250);
    }
    assert(page, 'Main application window did not open.');
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      localStorage.setItem('i18nextLng', 'en');
      localStorage.setItem('welcomeDismissed', 'true');
      localStorage.setItem('gettingStartedDismissed', 'true');
      localStorage.setItem('day-planner-unscheduled', JSON.stringify([{
        id: 'windows-test-local', title: 'Windows package smoke test', date: null,
        startTime: '09:00', duration: 30, completed: false, priority: 0,
        color: 'bg-blue-500', notes: '', subtasks: [], lastModified: new Date().toISOString(),
      }]));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 45000 });
    const section = page.getByRole('region', { name: 'Todoist sync', exact: true });
    await section.waitFor({ state: 'visible', timeout: 30000 });
    await section.scrollIntoViewIfNeeded();
    assert.equal(await section.getByLabel('Enable selective sync', { exact: true }).isChecked(), false);
    assert.equal(await section.getByLabel('Write completed ordinary leaf tasks back to Todoist', { exact: true }).isChecked(), false);
    results.tests.push('Installed Windows application starts; settings render; both sync switches default off.');
    await page.screenshot({ path: path.join(output, 'todoist-settings-en.png') });

    let requests = 0;
    const commands = [];
    await page.route('https://api.todoist.com/api/v1/sync', async route => {
      requests++;
      const request = route.request();
      const body = new URLSearchParams(request.postData() || '');
      commands.push(...JSON.parse(body.get('commands') || '[]'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        sync_token: `windows-smoke-${requests}`, full_sync: true,
        user: { id: 'windows-smoke-account', full_name: 'Synthetic Windows Test' },
        projects: [{ id: 'smoke-project', name: 'Smoke project', is_deleted: false }],
        labels: [{ id: 'smoke-label', name: 'dayglance', is_deleted: false }],
        items: [
          { id: 'smoke-p1', content: 'Matched P1 test task', description: 'Synthetic fixture, not a real account.', priority: 4, project_id: 'smoke-project', labels: ['dayglance'], checked: false, is_deleted: false },
          { id: 'smoke-p4', content: 'Excluded P4 test task', description: '', priority: 1, project_id: 'smoke-project', labels: [], checked: false, is_deleted: false },
        ],
      }) });
    });
    await section.getByLabel('Personal API token', { exact: true }).fill('synthetic-test-token-not-a-real-secret');
    await section.getByRole('button', { name: 'Connect and load preview', exact: true }).click();
    await section.getByText('1 active tasks match', { exact: true }).waitFor({ timeout: 30000 });
    const beforeImport = await page.evaluate(() => JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'));
    assert.equal(beforeImport.some(task => task.importSource === 'todoist'), false);
    results.tests.push('Synthetic API connection and preview: P1 matches, P4 excluded; preview does not import.');
    await section.getByLabel('Smoke project', { exact: true }).check();
    await section.getByLabel('dayglance', { exact: true }).check();
    // A wrapping label's accessible name includes its select's option text.
    await section.getByLabel('Automatic sync while the app is open').selectOption('0');
    await section.getByLabel('Enable selective sync', { exact: true }).check();
    await section.getByRole('button', { name: 'Sync now', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]').some(task => task.id === 'todoist:windows-smoke-account:smoke-p1'), null, { timeout: 30000 });
    const afterImport = await page.evaluate(() => JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'));
    assert.equal(afterImport.filter(task => task.importSource === 'todoist').length, 1);
    assert.equal(afterImport.some(task => task.id === 'windows-test-local'), true);
    assert.equal(commands.length, 0);
    results.tests.push('Priority + project + label selective import works with mocked API; existing local task retained; no completion commands sent.');
    await section.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'zh-CN'));
    await page.reload();
    await page.getByRole('button', { name: '设置', exact: true }).click({ timeout: 45000 });
    const chinese = page.getByRole('region', { name: 'Todoist 同步', exact: true });
    await chinese.waitFor({ state: 'visible' });
    await chinese.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'todoist-settings-zh.png') });
    const kept = await page.evaluate(() => ({
      tasks: JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'),
      token: sessionStorage.getItem('dg-todoist-token-v1'),
    }));
    assert.equal(kept.tasks.some(task => task.id === 'todoist:windows-smoke-account:smoke-p1'), true);
    assert.equal(kept.token, null);
    results.tests.push('Chinese settings render after reload; disconnect clears token but keeps imported tasks.');
    assert.deepEqual(errors, []);
    results.status = 'passed';
    results.mockRequests = requests;
    results.realTodoistAccountTested = false;
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    results.status = 'failed';
    results.error = error.stack || String(error);
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
