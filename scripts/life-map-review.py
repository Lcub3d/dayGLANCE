"""Production React Flow integration review; synthetic data, no personal accounts.
Build the app, serve dist at REVIEW_URL, install Playwright and run this file.
"""
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('REVIEW_URL', 'http://127.0.0.1:5173')
OUT = Path(os.environ.get('REVIEW_OUT', 'review-artifacts/life-map'))
OUT.mkdir(parents=True, exist_ok=True)
RESULTS, ERRORS = [], []
DOC = 'day-planner-lifeplanner-v1'
VIEW = 'day-planner-life-map-view-v1'
KEYS = [DOC, 'day-planner-goals', 'day-planner-projects', 'day-planner-tasks', 'day-planner-unscheduled', 'day-planner-recurring-tasks']


def fixture(english=False):
    command = ['node', str(Path(__file__).with_name('life-map-fixture.mjs'))]
    if english:
        command.append('--en')
    return json.loads(subprocess.check_output(command, text=True))


def require(value, message):
    if not value:
        raise AssertionError(message)


def check(name, action, page):
    try:
        action()
        RESULTS.append({'name': name, 'passed': True})
        print('PASS:', name, flush=True)
    except Exception as exc:
        RESULTS.append({'name': name, 'passed': False, 'error': str(exc)})
        print('FAIL:', name, str(exc), flush=True)
        page.screenshot(path=str(OUT / f'failure-{len(RESULTS)}.png'))
        (OUT / f'failure-{len(RESULTS)}.txt').write_text(page.locator('body').inner_text(), encoding='utf-8')


def storage(page):
    return page.evaluate('(keys) => Object.fromEntries(keys.map(k => [k, JSON.parse(localStorage.getItem(k) || "null")]))', KEYS)


def view(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key) || "null")', VIEW)


def maproot(page):
    return page.locator('[data-life-map]')


def node(page, kind, text=None):
    result = page.locator(f'[data-life-map-node][data-kind="{kind}"]')
    return result.filter(has_text=text).first if text else result


def open_planner(page, english=False, mobile=False):
    if page.locator('[data-lifeplanner]').count():
        return
    # A genuinely empty native task collection invokes dayGLANCE's welcome,
    # independently of the optional planner guide. Dismiss it through its UI.
    skip = page.get_by_role('button', name='Skip' if english else '跳过', exact=True)
    if skip.count() and skip.first.is_visible():
        skip.first.click()
        expect(skip.first).not_to_be_visible()
    if page.locator('[data-planning-choices]').count():
        page.locator('.planning-choices-snooze').click()
    reminder = page.locator('.fixed.bottom-6.right-6.z-50.w-64')
    if reminder.count():
        reminder.locator('button').first.click()
    if mobile:
        tabs = page.locator('.fixed.bottom-0').get_by_role('button').filter(has=page.locator('svg.lucide-flag'))
        if tabs.count():
            tabs.first.click()
    page.get_by_role('button', name='Life planning' if english else '生活规划', exact=True).first.click()
    expect(page.locator('[data-lifeplanner]')).to_be_visible()


def open_map(page, english=False, mobile=False):
    open_planner(page, english, mobile)
    if not maproot(page).count():
        page.locator('.lp-map-button').click()
    expect(maproot(page)).to_be_visible()
    expect(node(page, 'root')).to_have_count(1)
    # Fit after lazy chunk, actual DOM measurement, and fonts are ready.
    page.evaluate('document.fonts.ready')
    page.wait_for_timeout(200)


def profile(browser, *, english=False, dark=False, width=1700, empty=False, extra=None):
    f = fixture(english)
    if empty:
        f['document']['wishes'] = []
        for key in ('goals', 'projects', 'tasks', 'unscheduledTasks', 'recurringTasks'):
            f[key] = []
    context = browser.new_context(viewport={'width': width, 'height': 960 if width > 600 else 852},
        locale='en-US' if english else 'zh-CN', timezone_id='Asia/Shanghai',
        is_mobile=width < 600, has_touch=width < 600, reduced_motion='reduce', service_workers='block')
    data = {'i18nextLng': 'en' if english else 'zh-CN', 'welcomeDismissed': 'true',
        'gettingStartedDismissed': 'true', 'day-planner-darkmode': json.dumps(dark),
        'day-planner-goals-projects-enabled': 'true', 'day-planner-lifeplanner-enabled': 'true',
        'day-planner-glance-fabs-collapsed': '0',
        'day-planner-planning-choices-dismissed-date': datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat(),
        DOC: json.dumps(f['document']), 'day-planner-goals': json.dumps(f['goals']),
        'day-planner-projects': json.dumps(f['projects']), 'day-planner-tasks': json.dumps(f['tasks']),
        'day-planner-unscheduled': json.dumps(f['unscheduledTasks']),
        'day-planner-recurring-tasks': json.dumps(f['recurringTasks'])}
    data.update(extra or {})
    context.add_init_script("if (!localStorage.getItem('map-review-seeded')) { Object.entries(" + json.dumps(data) + ").forEach(([k,v]) => localStorage.setItem(k,v)); localStorage.setItem('map-review-seeded','1'); }")
    page = context.new_page()
    page.set_default_timeout(12000)
    page.on('pageerror', lambda error: ERRORS.append(str(error)))
    page.goto(BASE, wait_until='domcontentloaded')
    page.wait_for_timeout(1300)
    try:
        open_map(page, english, width < 600)
    except Exception:
        page.screenshot(path=str(OUT / f'bootstrap-{width}-{english}-{dark}.png'))
        (OUT / f'bootstrap-{width}-{english}-{dark}.txt').write_text(page.locator('body').inner_text(), encoding='utf-8')
        raise
    return context, page


def find_and_select(page, kind, text):
    maproot(page).get_by_label('搜索人生蓝图', exact=True).fill(text)
    item = node(page, kind, text)
    expect(item).to_be_visible()
    expect(item.locator('.lm-node-title')).to_be_in_viewport(ratio=.99)
    item.locator('.lm-node-title').click()
    expect(page.locator('.lm-inspector')).to_be_visible()
    return item


with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_EXECUTABLE')
    browser = playwright.chromium.launch(**({'executable_path': executable} if executable else {}))
    try:
        context, page = profile(browser)
        original = storage(page)

        def live_hierarchy():
            expect(page.locator('.react-flow')).to_be_visible()
            for kind, count in [('wish', 2), ('vision', 2), ('goal', 3), ('project', 2), ('task', 4)]:
                expect(node(page, kind)).to_have_count(count)
            ids = page.locator('[data-life-map-node]').evaluate_all('(els) => els.map(el => el.dataset.lifeMapNode)')
            require(len(ids) == len(set(ids)), 'The same native identity appears twice')
            require(storage(page) == original, 'Opening the graph changed source records')
            expect(page.locator('.react-flow__attribution')).to_be_visible()
            page.locator('[data-lifeplanner]').screenshot(path=str(OUT / 'life-map-overview.png'))
        check('real React Flow displays five levels using live native IDs without new records', live_hierarchy, page)

        def collapse_search():
            item = node(page, 'wish', '持续创作')
            item.get_by_role('button').click()
            expect(node(page, 'task')).to_have_count(2)
            require(len(view(page)['collapsed']) == 1, 'Collapse was not persisted')
            page.reload(wait_until='domcontentloaded'); page.wait_for_timeout(1000); open_map(page)
            expect(node(page, 'task')).to_have_count(2)
            maproot(page).get_by_label('搜索人生蓝图', exact=True).fill('写下这本书')
            expect(node(page, 'task')).to_have_count(1)
            expect(node(page, 'wish')).to_have_count(1)
            expect(node(page, 'goal')).to_have_count(1)
            expect(node(page, 'task').first).to_have_class(__import__('re').compile('is-match'))
            expect(maproot(page).locator('.react-flow__edge-path')).to_have_count(5)
            expect(node(page, 'task').first.locator('.lm-node-title')).to_be_in_viewport(ratio=.99)
            page.locator('[data-lifeplanner]').screenshot(path=str(OUT / 'life-map-search.png'))
            maproot(page).get_by_label('清空搜索', exact=True).click()
            expect(node(page, 'task')).to_have_count(2)
            maproot(page).get_by_label('展开全部分支', exact=True).click()
            expect(node(page, 'task')).to_have_count(4)
            expect(maproot(page).locator('.react-flow__edge-path')).to_have_count(13)
            require(storage(page) == original, 'Collapse/search changed source data')
        check('collapse survives reload and deep search reveals the full ancestor path', collapse_search, page)

        def filters():
            maproot(page).get_by_role('button', name='目标', exact=True).click()
            expect(node(page, 'project')).to_have_count(0)
            expect(node(page, 'goal')).to_have_count(3)
            maproot(page).get_by_role('button', name='任务', exact=True).click()
            maproot(page).get_by_label('聚焦一个愿望', exact=True).select_option('map-family')
            expect(node(page, 'wish')).to_have_count(1)
            expect(node(page, 'task')).to_have_count(2)
            maproot(page).get_by_label('聚焦一个愿望', exact=True).select_option('')
            maproot(page).get_by_label('显示未关联事项', exact=True).check()
            expect(node(page, 'task')).to_have_count(5)
            expect(node(page, 'unlinked')).to_have_count(1)
            maproot(page).get_by_label('显示未关联事项', exact=True).uncheck()
            require(storage(page) == original, 'Filters changed actual relationships')
        check('level, wish and unlinked filters never change ownership', filters, page)

        def drag_zoom():
            item = node(page, 'wish', '持续创作')
            box = item.bounding_box(); require(box is not None, 'No draggable node')
            page.mouse.move(box['x']+60, box['y']+40); page.mouse.down()
            page.mouse.move(box['x']+90, box['y']+90, steps=10); page.mouse.up()
            page.wait_for_function('(key) => Object.keys(JSON.parse(localStorage.getItem(key)).positions).length > 0', arg=VIEW)
            require(storage(page) == original, 'Dragging moved a source task or changed order')
            before = maproot(page).locator('.lm-navigation span').inner_text()
            maproot(page).get_by_label('放大', exact=True).click()
            expect(maproot(page).locator('.lm-navigation span')).not_to_have_text(before)
            maproot(page).get_by_label('适应画布', exact=True).click()
            # Selecting, then Delete must never remove a task record.
            node(page, 'wish', '持续创作').locator('.lm-node-title').click(); page.keyboard.press('Delete')
            require(storage(page) == original, 'Delete key changed source records')
            page.get_by_label('关闭事项详情', exact=True).click()
            maproot(page).get_by_label('自动整理', exact=True).click()
            page.wait_for_function('(key) => Object.keys(JSON.parse(localStorage.getItem(key)).positions).length === 0', arg=VIEW)
        check('drag, zoom, fit and auto-arrange persist only presentation; Delete is non-destructive', drag_zoom, page)

        def storage_retry():
            page.evaluate('''key => {const old=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('review quota','QuotaExceededError');return old.call(this,k,v)};window.restoreMapStorage=()=>{Storage.prototype.setItem=old;};}''', VIEW)
            node(page, 'wish', '持续创作').get_by_role('button').click()
            expect(maproot(page).get_by_role('alert')).to_be_visible()
            require(storage(page) == original, 'Failed cosmetic save touched business data')
            page.evaluate('() => { window.restoreMapStorage(); }')
            maproot(page).get_by_role('button', name='重试', exact=True).click()
            expect(maproot(page).get_by_role('alert')).to_have_count(0)
            require(len(view(page)['collapsed']) == 1, 'Retry did not save collapse')
            maproot(page).get_by_label('自动整理', exact=True).click()
            expect(maproot(page).locator('.react-flow__edge-path')).to_have_count(13)
        check('failed layout writes keep content intact and expose a working retry', storage_retry, page)

        def wish_roundtrip():
            find_and_select(page, 'wish', '持续创作')
            page.get_by_role('button', name='回笔记本填写', exact=True).click()
            expect(maproot(page)).to_have_count(0)
            field = page.locator('[data-life-wish="map-writing"] textarea')
            expect(field).to_be_focused()
            field.fill('持续创作真正有价值的作品'); field.press('Enter')
            page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)).wishes[0].title === "持续创作真正有价值的作品"', arg=DOC)
            page.locator('.lp-map-button').click(); expect(node(page, 'wish', '真正有价值')).to_have_count(1)
            require(storage(page)['day-planner-unscheduled'] == original['day-planner-unscheduled'], 'Wish editing rewrote tasks')
        check('wish selection returns to the original notebook and edited ink updates the same map node', wish_roundtrip, page)

        def vision_roundtrip():
            find_and_select(page, 'vision', '出版2本书')
            page.get_by_role('button', name='打开愿景便签', exact=True).click()
            expect(page.locator('[data-life-vision]')).to_be_visible()
            expect(page.locator('#lp-outcome')).to_have_value('出版2本书')
            page.locator('#lp-outcome').fill('完成2部作品')
            page.keyboard.press('Escape')
            expect(page.locator('[data-life-vision]')).to_have_count(0)
            maproot(page).get_by_label('搜索人生蓝图', exact=True).fill('完成2部作品')
            expect(node(page, 'vision', '完成2部作品')).to_have_count(1)
            require(storage(page)['day-planner-projects'] == original['day-planner-projects'], 'Vision title silently renamed project')
        check('vision node reuses the live sticky-note editor instead of a duplicate form', vision_roundtrip, page)

        def assistant_roundtrip():
            before = storage(page)
            page.locator('.lp-guide-button').click()
            expect(page.locator('[data-life-guide]')).to_be_visible()
            expect(page.locator('[data-life-category]')).to_have_count(11)
            page.locator('.lp-map-button').click()
            expect(maproot(page)).to_be_visible()
            expect(page.locator('[data-lp-trash]')).to_have_count(0)
            maproot(page).get_by_role('button', name='笔记本', exact=True).click()
            expect(page.locator('[data-lifeplanner]')).to_have_attribute('data-notebook-mode', 'notebook')
            require(storage(page) == before, 'Switching views changed the document')
        check('assistant table and notebook round-trip retain one document; map has no trash overlay', assistant_roundtrip, page)
        context.close()

        for kind, text, button, expected in [
            ('project', '日常观察与写作计划', '打开项目规划', '日常观察与写作计划'),
            ('task', '写下这本书的大纲', '打开任务', '写下这本书的大纲'),
            ('goal', '完成第一本书', '打开原生目标', '完成第一本书'),
        ]:
            context, page = profile(browser)
            def native_open(kind=kind, text=text, button=button, expected=expected):
                before = storage(page)
                find_and_select(page, kind, text)
                page.get_by_role('button', name=button, exact=True).click()
                expect(page.locator('[data-lifeplanner]')).to_have_count(0)
                require(expected in page.locator('body').inner_text() or page.locator('input').filter(visible=True).evaluate_all('(els)=>els.some(e=>e.value=== '+json.dumps(expected)+')'), 'Native editor did not receive the selected entity')
                require(storage(page) == before, 'Opening native editor mutated source data')
                page.screenshot(path=str(OUT / f'native-{kind}.png'))
            check(f'{kind} opens its existing native workspace by ID', native_open, page)
            context.close()

        context, page = profile(browser)
        def tombstone_update():
            before = storage(page)
            page.evaluate('''() => {const key='day-planner-deleted-project-ids';const value=JSON.stringify({'life-map-first-book':Date.now()});localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value,storageArea:localStorage}));}''')
            expect(node(page, 'project', '日常观察与写作计划')).to_have_count(0)
            expect(node(page, 'project', '项目暂不可用')).to_have_count(1)
            require(storage(page) == before, 'Tombstone observation recreated or deleted something')
        check('live native tombstone events hide unavailable entities without recreating them', tombstone_update, page)
        context.close()

        context, page = profile(browser, extra={VIEW: '{broken'})
        def corrupt_layout():
            expect(maproot(page).get_by_role('alert')).to_be_visible()
            require(page.evaluate('(k)=>localStorage.getItem(k)', VIEW) == '{broken', 'Corrupt layout overwritten without consent')
            maproot(page).get_by_role('alert').get_by_role('button', name='自动整理', exact=True).click()
            expect(maproot(page).get_by_role('alert')).to_have_count(0)
            require(view(page)['version'] == 1, 'Explicit layout reset failed')
        check('corrupt presentation data is recoverable without overwriting the business document', corrupt_layout, page)
        context.close()

        context, page = profile(browser, empty=True)
        def empty_map():
            expect(node(page, 'wish')).to_have_count(0)
            expect(page.get_by_role('heading', name='从一个愿望开始', exact=True)).to_be_visible()
            before = storage(page)
            page.locator('[data-lifeplanner]').screenshot(path=str(OUT / 'life-map-empty.png'))
            page.get_by_role('button', name='写下愿望', exact=True).click()
            expect(maproot(page)).to_have_count(0)
            require(storage(page) == before, 'Empty graph created sample wishes')
        check('empty map returns to blank notebook with no automatically inserted wishes', empty_map, page)
        context.close()

        for width, english, dark in [(1440, False, False), (1440, True, False), (1440, False, True), (1024, False, False), (393, False, False), (320, True, False)]:
            context, page = profile(browser, width=width, english=english, dark=dark)
            def responsive(width=width, english=english, dark=dark):
                require(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'App has horizontal overflow')
                require(page.locator('[data-lifeplanner]').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'), 'Workspace leaks outside its viewport')
                require(maproot(page).locator('.lm-canvas').bounding_box()['height'] >= 220, 'Canvas has no usable height')
                expect(maproot(page).get_by_label('Zoom in' if english else '放大', exact=True)).to_be_visible()
                if width < 600:
                    # The mobile default is readable, not a fit-to-microtext thumbnail.
                    require(int(maproot(page).locator('.lm-navigation span').inner_text().strip('%')) >= 80, 'Phone opens at unreadable zoom')
                    expect(node(page, 'wish').first).to_be_visible()
                require(not any(s in maproot(page).inner_text() for s in ('lifeMap.', 'undefined', 'NaN')), 'Untranslated or invalid display values')
                page.screenshot(path=str(OUT / f'life-map-{width}-{"en" if english else "zh"}-{"dark" if dark else "light"}.png'))
            check(f'{width}px {"English" if english else "Chinese"} {"dark" if dark else "light"} renders the real map without overflow', responsive, page)
            context.close()
    except Exception as exc:
        RESULTS.append({'name': 'browser setup or scenario bootstrap', 'passed': False, 'error': str(exc)})
        raise
    finally:
        browser.close()
        report = {'tests': RESULTS, 'uncaughtErrors': ERRORS, 'screenshots': 'Production app in Chromium with synthetic fixtures; not physical hardware.'}
        (OUT / 'life-map-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
        if ERRORS or any(not item['passed'] for item in RESULTS):
            raise SystemExit(1)
