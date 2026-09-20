"""Production Chromium regressions for fork PR #4. Only synthetic local data.
Run after npm run build; REVIEW_URL points to the compiled application.
"""
import json
import os
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

helpers = {}
exec(Path(__file__).with_name('planning-choices-review.py').read_text().split('with sync_playwright() as playwright:')[0], helpers)
profile, check, require = helpers['profile'], helpers['check'], helpers['require']
BASE, OUT, RESULTS, ERRORS = [helpers[key] for key in ['BASE', 'OUT', 'RESULTS', 'ERRORS']]
T = datetime.fromisoformat('2026-09-02T10:00:00+08:00')
D = 'day-planner-planning-choices-dismissed-date'
K = 'day-planner-planning-choices-cadence-v1'


def hit(locator):
    expect(locator).to_be_visible()
    require(locator.evaluate('''el => {
      const r = el.getBoundingClientRect();
      return [[.25,.5],[.5,.5],[.75,.5]].every(([x,y]) => {
        const target = document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);
        return target === el || el.contains(target);
      });
    }'''), 'Control is covered by another element')


def separate(a, b):
    ra, rb = a.bounding_box(), b.bounding_box()
    require(ra and rb, 'Missing visible geometry')
    overlap = min(ra['x']+ra['width'], rb['x']+rb['width'])-max(ra['x'], rb['x'])
    require(overlap <= 1, f'Horizontal collision: {ra} / {rb}')


with sync_playwright() as p:
    browser = p.chromium.launch(**({'executable_path': os.environ['CHROMIUM_EXECUTABLE']} if os.environ.get('CHROMIUM_EXECUTABLE') else {}))
    # Truly empty profiles, not a pre-populated inbox called a "fresh install".
    for width, language in [(1366, 'en'), (393, 'zh-CN')]:
        c = browser.new_context(viewport={'width': width, 'height': 900}, screen={'width': width, 'height': 900}, has_touch=width < 600, is_mobile=width < 600, timezone_id='Asia/Shanghai', service_workers='block')
        c.add_init_script("localStorage.setItem('i18nextLng',"+json.dumps(language)+"); window.guideEverSeen=false; new MutationObserver(()=>{if(document.querySelector('[data-planning-choices]'))window.guideEverSeen=true}).observe(document,{childList:true,subtree:true});")
        pg = c.new_page(); pg.on('pageerror', lambda e: ERRORS.append(str(e))); pg.clock.set_fixed_time(T)
        pg.goto(BASE); pg.wait_for_timeout(2400)
        strings = json.loads(Path(f'public/locales/{language}/translation.json').read_text())
        def welcome():
            title = pg.get_by_text(strings['onboarding']['welcomeTitle'], exact=True)
            expect(title).to_be_visible()
            require(not pg.evaluate('window.guideEverSeen'), 'Guide flashed during native startup')
            require(not pg.locator('#root').evaluate('el=>el.inert'), 'Native welcome made inert')
            pg.screenshot(path=str(OUT / f'fixed-welcome-{width}.png'))
            panel = title.locator('xpath=ancestor::div[contains(@class,"fixed")][1]')
            panel.locator('button').filter(has=pg.locator('svg.lucide-chevron-right')).last.click()
            pg.get_by_role('button', name=strings['common']['skip'], exact=True).click()
            pg.wait_for_timeout(1800)
            require(not pg.evaluate('window.guideEverSeen'), 'Queued a second tour after native welcome')
            helpers['open_choices'](pg)
            pg.keyboard.press('Escape')
            expect(pg.locator('[data-planning-choices]')).to_have_count(0)
        check(f'empty {language} {width}: native welcome wins, no follow-on automatic tour, manual access works', welcome, pg)
        c.close()

    for width, language, dark in [(721,'en',False),(820,'zh-CN',False),(950,'de',False),(1100,'en',True),(1230,'zh-CN',True),(1366,'en',False),(1700,'en',False),(2300,'en',False)]:
        c, pg = profile(browser, width=width, language=language, dark=dark, now=T)
        def header():
            weather = pg.locator('[data-header-weather]')
            trigger = pg.locator('[data-planning-choices-trigger]').filter(visible=True).first
            expect(weather).to_contain_text('24°C')
            separate(weather, trigger)
            a, b = weather.bounding_box(), trigger.bounding_box()
            require(0 <= b['x']-a['x']-a['width'] <= 12, 'Guide is not immediately right of weather')
            hit(trigger)
            controls = pg.locator('.desktop-header-date-controls > button').filter(visible=True)
            for control in controls.all():
                separate(trigger, control); hit(control)
                for action in pg.locator('.desktop-header-actions > button').filter(visible=True).all():
                    separate(control, action)
            forecast = pg.locator('.desktop-header-forecast').filter(visible=True)
            if forecast.count():
                separate(forecast, controls.first)
            pg.screenshot(path=str(OUT / f'fixed-header-{width}-{language}.png'))
            helpers['open_choices'](pg); pg.keyboard.press('Escape')
            expect(trigger).to_be_focused()
        check(f'{width}px {language} header: weather, guide, date and actions have separate hit targets', header, pg)
        c.close()

    for width in [320, 393]:
        c, pg = profile(browser, width=width, now=T)
        def phone():
            trigger = pg.locator('[data-planning-choices-trigger]').filter(visible=True).first
            hit(trigger)
            pg.locator('.fixed.bottom-0 button').filter(has=pg.locator('svg.lucide-calendar')).click()
            row = pg.locator('.planning-mobile-date-header')
            expect(row).to_be_visible()
            require(row.bounding_box()['height'] <= 70, 'Empty second guide row remains')
            trigger = row.locator('[data-planning-choices-trigger]')
            hit(trigger)
            for control in row.locator('button').filter(visible=True).all():
                hit(control)
            require(row.evaluate('el=>el.scrollWidth <= el.clientWidth+1'), 'Date row overflows')
            pg.screenshot(path=str(OUT / f'fixed-phone-date-{width}.png'))
            helpers['open_choices'](pg); pg.keyboard.press('Escape')
        check(f'phone {width}: date row is compact and all controls remain clickable', phone, pg)
        c.close()

    for width, height in [(1024,768),(768,1024)]:
        c = browser.new_context(viewport={'width':width,'height':height}, screen={'width':width,'height':height}, has_touch=True, timezone_id='Asia/Shanghai', service_workers='block')
        c.add_init_script("localStorage.setItem('day-planner-unscheduled',JSON.stringify([{id:'tablet-fixture',title:'Synthetic task',completed:false}]));localStorage.setItem('day-planner-planning-choices-dismissed-date',new Date().toLocaleDateString('sv-SE'));")
        pg=c.new_page();pg.clock.set_fixed_time(T);pg.on('pageerror',lambda e:ERRORS.append(str(e)));pg.goto(BASE);pg.wait_for_timeout(1300)
        def tablet():
            require(pg.locator('.desktop-header').count()==0,'Did not exercise the native tablet header')
            trigger=pg.locator('[data-planning-choices-trigger]').filter(visible=True)
            expect(trigger).to_have_count(1);hit(trigger)
            helpers['open_choices'](pg)
            pg.screenshot(path=str(OUT/f'fixed-tablet-{width}.png'))
            pg.keyboard.press('Escape');expect(trigger).to_be_focused()
        check(f'touch tablet {width}x{height}: real tablet branch has a working guide entry',tablet,pg)
        c.close()

    c, pg = profile(browser, now=T)
    def keyboard():
        root=helpers['open_choices'](pg)
        expect(root.locator('h2')).to_be_focused()
        pg.keyboard.press('Shift+Tab');expect(root.locator('.planning-choices-snooze')).to_be_focused()
        pg.keyboard.press('Tab');expect(root.locator('[data-planning-choice="review"] [role="switch"]')).to_be_focused()
        pg.keyboard.press('Escape')
        expect(pg.locator('[data-planning-choices-trigger]').filter(visible=True).first).to_be_focused()
        require(not pg.locator('#root').evaluate('el=>el.inert'), 'Inert background leaked after close')
    check('initial heading reverse-Tab wraps inside guide; Escape restores focus and background',keyboard,pg);c.close()

    c, pg = profile(browser, auto=True, now=T, wait_ms=0)
    def manual_pending():
        helpers['open_choices'](pg);pg.keyboard.press('Escape');pg.wait_for_timeout(2200)
        expect(pg.locator('[data-planning-choices]')).to_have_count(0)
        require(json.loads(pg.evaluate('(k)=>localStorage.getItem(k)',K))['days']==1,'Manual opening recounted visit')
    check('manual opening consumes the pending automatic opening',manual_pending,pg);c.close()

    c, pg = profile(browser, auto=True, now=T, wait_ms=0)
    def peer_snooze():
        pg.wait_for_function('k=>localStorage.getItem(k)!==null',arg=K)
        other=c.new_page();other.goto(BASE)
        other.evaluate('(k)=>localStorage.setItem(k,"2026-09-02")',D)
        pg.wait_for_timeout(2200)
        expect(pg.locator('[data-planning-choices]')).to_have_count(0)
        other.close()
    check('another tab snoozing cancels an already pending prompt',peer_snooze,pg);c.close()

    c, pg = profile(browser, auto=True, now=T, wait_ms=0)
    def native_dialog():
        dial=pg.get_by_title('Calendar day (O)',exact=True).filter(visible=True).first
        dial.click();pg.wait_for_timeout(1800)
        expect(pg.locator('[data-planning-choices]')).to_have_count(0)
        # The real Day Dial owns its Escape handling; opening the guide must not
        # disable that native surface or fire over it.
        pg.keyboard.press('Escape')
        expect(pg.locator('[data-planning-choices]')).to_be_visible(timeout=5000)
    check('a native Day Dial opened during the idle window takes priority',native_dialog,pg);c.close()
    browser.close()

report={'source':'Real production app in Chromium; synthetic fixtures and viewport/touch emulation, not physical devices.','tests':RESULTS,'uncaughtErrors':ERRORS}
(OUT/'guide-integration-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
if ERRORS or any(not r['passed'] for r in RESULTS): raise SystemExit(1)
