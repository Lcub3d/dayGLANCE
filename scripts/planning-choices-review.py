"""Exercise the production application, not a stand-in settings page.
Run npm run build, serve dist on REVIEW_URL, and install Python Playwright.
All fixtures are synthetic; screenshots are browser renders, not phone tests.
"""
import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('REVIEW_URL', 'http://127.0.0.1:5173')
OUT = Path(os.environ.get('REVIEW_OUT', 'review-artifacts'))
OUT.mkdir(parents=True, exist_ok=True)
RESULTS, ERRORS = [], []
J = 'day-planner-jobo-enabled'
L = 'day-planner-lifeplanner-enabled'
DOC = 'day-planner-lifeplanner-v1'


def check(name, action, page):
    try:
        action()
        RESULTS.append({'name': name, 'passed': True})
        print('PASS:', name, flush=True)
    except Exception as exc:
        RESULTS.append({'name': name, 'passed': False, 'error': str(exc)})
        print('FAIL:', name, str(exc), flush=True)
        page.screenshot(path=str(OUT / f'choices-failure-{len(RESULTS)}.png'))
        (OUT / f'choices-failure-{len(RESULTS)}.txt').write_text(page.locator('body').inner_text(), encoding='utf-8')


def require(value, message):
    if not value:
        raise AssertionError(message)


def profile(browser, *, language='en', width=1700, dark=False, seed=None, auto=False, now=None, wait_ms=None):
    context = browser.new_context(viewport={'width': width, 'height': 1000 if width > 600 else 852}, locale='zh-CN' if language == 'zh-CN' else 'en-US', timezone_id='Asia/Shanghai', is_mobile=width < 600, has_touch=width < 600, reduced_motion='reduce', service_workers='block')
    data = {
        'i18nextLng': language, 'welcomeDismissed': 'true', 'gettingStartedDismissed': 'true',
        'day-planner-darkmode': json.dumps(dark), 'day-planner-glance-fabs-collapsed': '0',
        'day-planner-goals-projects-enabled': 'true',
        'day-planner-weather-enabled': 'true', 'day-planner-weather-zip': 'Example City', 'day-planner-weather-temp-unit': 'celsius',
        'day-planner-unscheduled': json.dumps([{'id': 'review-inbox', 'title': 'Read this week’s notes', 'completed': False, 'notes': '', 'subtasks': [], 'color': 'bg-blue-500'}]),
    }
    data.update(seed or {})
    if not auto:
        # Init scripts have no guaranteed order relative to Playwright's clock.
        # Seed an explicit date, not a browser Date read before the clock installs.
        local_now = (now or datetime.now(ZoneInfo('Asia/Shanghai'))).astimezone(ZoneInfo('Asia/Shanghai'))
        data.setdefault('day-planner-planning-choices-dismissed-date', local_now.date().isoformat())
    context.add_init_script("if (!localStorage.getItem('choices-review-seeded')) { Object.entries(" + json.dumps(data) + ").forEach(([k,v])=>localStorage.setItem(k,v));localStorage.setItem('choices-review-seeded','1'); }")
    # Exercise the real weather component with synthetic API fixtures; no
    # screenshot claims these values are a live forecast or the user's city.
    context.route('**/geocoding-api.open-meteo.com/**', lambda route: route.fulfill(json={'results':[{'latitude':1.3,'longitude':103.8,'timezone':'Asia/Singapore'}]}))
    context.route('**/api.open-meteo.com/**', lambda route: route.fulfill(json={
        'current':{'temperature_2m':24,'weather_code':3},
        'daily':{'time':[f'2026-09-{d}' for d in range(20,26)], 'temperature_2m_max':[29,30,30,30,26,27], 'temperature_2m_min':[22,20,20,20,21,20], 'weather_code':[3,2,61,61,61,3]}
    }))
    page = context.new_page()
    if now is not None:
        page.clock.set_fixed_time(now)
    page.set_default_timeout(10000)
    page.on('pageerror', lambda error: ERRORS.append(str(error)))
    page.goto(BASE, wait_until='domcontentloaded')
    page.wait_for_timeout(wait_ms if wait_ms is not None else (2000 if auto else 1200))
    if not auto and page.locator('[data-planning-choices]').count():
        page.locator('.planning-choices-snooze').click()
    return context, page


def open_choices(page):
    if page.locator('[data-planning-choices]').count():
        return page.locator('[data-planning-choices]')
    page.locator('[data-planning-choices-trigger]').filter(visible=True).first.click()
    expect(page.locator('[data-planning-choices]')).to_be_visible()
    expect(page.locator('[data-planning-choices] [data-initial-focus]')).to_be_focused()
    return page.locator('[data-planning-choices]')


def switch(page, key):
    return page.locator(f'[data-planning-choice="{key}"]').get_by_role('switch')


def choose(page, key, value):
    control = switch(page, key)
    if control.get_attribute('aria-checked') != str(value).lower():
        control.click()
    expect(control).to_have_attribute('aria-checked', str(value).lower())


def keep_data(page):
    return page.evaluate("(key) => Object.fromEntries([key,'day-planner-tasks','day-planner-unscheduled','day-planner-goals','day-planner-projects'].map(k => [k,localStorage.getItem(k)]))", DOC)


with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_EXECUTABLE')
    browser = playwright.chromium.launch(**({'executable_path': executable} if executable else {}))
    context, page = profile(browser)
    root = open_choices(page)

    def simple_default():
        expect(switch(page, 'daily')).to_be_disabled()
        expect(switch(page, 'daily')).to_have_attribute('aria-checked', 'true')
        expect(switch(page, 'review')).to_have_attribute('aria-checked', 'false')
        expect(switch(page, 'life')).to_have_attribute('aria-checked', 'false')
        require(page.evaluate('(k)=>localStorage.getItem(k)', DOC) is None, 'Opening choices created a document')
        root.screenshot(path=str(OUT / 'choices-english-simple.png'))
    check('fresh install has only the permanently enabled daily baseline', simple_default, page)

    def independent():
        before = keep_data(page)
        for jobo, life in [(True,False),(True,True),(False,True),(False,False)]:
            choose(page, 'review', jobo); choose(page, 'life', life)
            require((page.evaluate('(k)=>localStorage.getItem(k)', J) == 'true') == jobo, 'Native Jobo key differs')
            # An untouched OFF default deliberately has no key: opening the
            # chooser must not manufacture a stored preference.
            require((page.evaluate('(k)=>localStorage.getItem(k)', L) == 'true') == life, 'Life preference differs')
            require(keep_data(page) == before, 'Choices mutated record data')
            expect(switch(page,'daily')).to_have_attribute('aria-checked','true')
        page.keyboard.press('Escape')
        expect(page.locator('[data-planning-choices]')).to_have_count(0)
        expect(page.get_by_role('button', name='Life planning', exact=True)).to_have_count(0)
    check('all four optional combinations persist without touching native or planner data', independent, page)

    def focus():
        open_choices(page)
        for _ in range(12):
            page.keyboard.press('Tab')
            require(page.evaluate("Boolean(document.activeElement.closest('[data-planning-choices]'))"), 'Focus escaped')
        page.keyboard.press('Shift+Tab')
        require(page.evaluate("document.getElementById('root').inert"), 'Background is not inert')
        page.keyboard.press('Escape')
        expect(page.locator('[data-planning-choices-trigger]').first).to_be_focused()
        require(not page.evaluate("document.getElementById('root').inert"), 'Background stayed inert')
    check('dialog traps focus, suppresses background shortcuts and restores trigger focus', focus, page)

    def keyboard_toggle():
        open_choices(page)
        control=switch(page,'life');control.focus();page.keyboard.press('Space')
        expect(control).to_have_attribute('aria-checked','true')
        page.keyboard.press('Enter');expect(control).to_have_attribute('aria-checked','false')
    check('optional switches respond to Space and Enter', keyboard_toggle, page)

    def failed_write():
        page.evaluate("""(key)=>{ const original=Storage.prototype.setItem;
          Storage.prototype.setItem=function(k,v){ if(k===key)throw new DOMException('test quota','QuotaExceededError');return original.call(this,k,v); };
          window.restoreChoiceStorage=()=>{Storage.prototype.setItem=original;}; }""", L)
        switch(page,'life').click()
        expect(switch(page,'life')).to_have_attribute('aria-checked','false')
        expect(root.get_by_role('alert')).to_contain_text('could not be saved')
        page.evaluate('()=>{window.restoreChoiceStorage();}')
        choose(page,'life',True)
        expect(root.get_by_role('alert')).to_have_count(0)
    check('blocked storage does not fake success; retry updates the same preference', failed_write, page)

    def reload():
        page.reload(wait_until='domcontentloaded');open_choices(page)
        expect(switch(page,'life')).to_have_attribute('aria-checked','true')
        expect(switch(page,'review')).to_have_attribute('aria-checked','false')
        page.get_by_role('button',name='Open Life Planner',exact=True).click()
        expect(page.locator('[data-lifeplanner]')).to_be_visible()
        require(page.evaluate("document.activeElement.closest('[data-lifeplanner]')!==null"),'Life Planner did not receive focus')
        page.keyboard.press('Escape')
        expect(page.locator('[data-lifeplanner]')).to_have_count(0)
        expect(page.get_by_role('button',name='Life planning',exact=True)).to_be_visible()
    check('choice survives reload and opens the actual Life Planner workspace', reload, page)

    def native_settings():
        page.get_by_title('Settings',exact=True).first.click()
        label=page.locator('label').filter(has_text='JOBO').filter(has=page.locator('input[type="checkbox"]'))
        # Native feature settings may be collapsed; use its real section button.
        if not label.first.is_visible():
            page.get_by_role('button',name='Features',exact=False).first.click()
        expect(label.first).to_be_visible()
        label.first.click()
        require(page.evaluate('(k)=>localStorage.getItem(k)', J)=='true','Native setting did not persist')
        page.keyboard.press('Escape');open_choices(page)
        expect(switch(page,'review')).to_have_attribute('aria-checked','true')
        choose(page,'review',False)
        page.keyboard.press('Escape')
    check('native Jobo Settings and the chooser share one live setting', native_settings, page)
    # Recover to the ordinary route if a native section label changes upstream.
    page.reload(wait_until='domcontentloaded')

    def tabs():
        open_choices(page);choose(page,'life',True)
        peer=context.new_page();peer.goto(BASE,wait_until='domcontentloaded');open_choices(peer)
        choose(peer,'life',False);expect(switch(page,'life')).to_have_attribute('aria-checked','false')
        choose(peer,'review',True);expect(switch(page,'review')).to_have_attribute('aria-checked','true')
        peer.close();page.keyboard.press('Escape')
    check('another tab updates the switches without rewriting the planner', tabs, page)

    def jobo_route():
        open_choices(page)
        page.get_by_role('button',name='Open Jobo preview',exact=True).click()
        expect(page.locator('[data-jobo-view]')).to_be_visible()
        open_choices(page);choose(page,'review',False)
        page.keyboard.press('Escape')
        expect(page.locator('[data-jobo-view]')).to_have_count(0)
    check('Jobo uses the native preview route; disabling it falls back to the daily planner', jobo_route, page)
    def keep_open_draft():
        open_choices(page); choose(page, 'life', True)
        page.get_by_role('button', name='Open Life Planner', exact=True).click()
        draft=page.locator('[data-lifeplanner] input[data-initial-focus]')
        draft.fill('An unsaved life wish')
        peer=context.new_page();peer.goto(BASE, wait_until='domcontentloaded');open_choices(peer)
        choose(peer,'life',False)
        expect(page.locator('[data-lifeplanner]')).to_be_visible()
        expect(draft).to_have_value('An unsaved life wish')
        peer.close()
        page.once('dialog', lambda dialog: dialog.accept())
        page.keyboard.press('Escape')
        expect(page.get_by_role('button',name='Life planning',exact=True)).to_have_count(0)
    check('disabling in another tab preserves an already-open unsaved planner draft', keep_open_draft, page)
    context.close()

    context,page=profile(browser, seed={J:'true','day-planner-hidden-views':json.dumps({'desktop':['jobo'],'mobile':[]})})
    def native_hidden_choice():
        open_choices(page)
        expect(switch(page,'review')).to_have_attribute('aria-checked','true')
        expect(page.get_by_role('button',name='Open Jobo preview',exact=True)).to_have_count(0)
        expect(page.locator('[data-planning-choices]')).not_to_contain_text('hidden in Views on this device')
        choose(page,'review',False);choose(page,'review',True)
        require(json.loads(page.evaluate("localStorage.getItem('day-planner-hidden-views')"))['desktop']==['jobo'],'Replaced native hidden views')
    check('enabling an experiment never overrides an explicit native hidden-view choice',native_hidden_choice,page)
    context.close()

    context,page=profile(browser, seed={DOC:'{"version":999,"keep":"recovery"}'})
    def upgrade():
        open_choices(page)
        expect(switch(page,'life')).to_have_attribute('aria-checked','true')
        before=keep_data(page);choose(page,'life',False)
        page.reload(wait_until='domcontentloaded');open_choices(page)
        expect(switch(page,'life')).to_have_attribute('aria-checked','false')
        require(keep_data(page)==before,'Existing recovery document was rewritten')
    check('existing planner documents stay discoverable but explicit OFF wins after restart',upgrade,page)
    context.close()

    for language,dark,width in [('zh-CN',False,1700),('en',True,1700),('zh-CN',False,393),('en',True,320),('en',False,1024)]:
        context,page=profile(browser,language=language,dark=dark,width=width,seed={'day-planner-goals-projects-enabled':'false'})
        def layout():
            page.screenshot(path=str(OUT/f'choices-entry-{width}-{language}.png'))
            root=open_choices(page)
            choose(page,'life',True)
            require(page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Viewport overflow')
            require(root.evaluate('(el)=>el.scrollWidth<=el.clientWidth'),'Dialog overflow')
            suffix=f'{width}-{language}-'+('dark' if dark else 'light')
            page.screenshot(path=str(OUT/f'choices-{suffix}.png'))
            root.screenshot(path=str(OUT/f'choices-panel-{suffix}.png'))
            page.get_by_role('button',name='打开 Life Planner' if language=='zh-CN' else 'Open Life Planner',exact=True).click()
            expect(page.locator('[data-lifeplanner]')).to_be_visible()
            # Independent of the Goals tab; no implicit enable or schema write.
            require(page.evaluate("localStorage.getItem('day-planner-goals-projects-enabled')")=='false','Enabled Goals without consent')
        check(f'real {width}px {language} {"dark" if dark else "light"} layout; Life Planner works with Goals disabled',layout,page)
        context.close()

    browser.close()
report={'screenshots':'Actual production application in Chromium, synthetic data; not physical-device screenshots.', 'tests':RESULTS,'uncaughtErrors':ERRORS}
(OUT/'choices-browser-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
if ERRORS or any(not x['passed'] for x in RESULTS):
    raise SystemExit(1)
