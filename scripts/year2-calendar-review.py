"""Production-app review for Year 2's optional Chinese calendar layers.

Synthetic tasks only. No live accounts; no replacement/mock UI. Run after
`vite preview --port 4173`, with Python Playwright installed separately.
"""
import importlib.util
import json
import os
import re
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('year2_base', Path(__file__).with_name('year2-browser-review.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
URL = os.environ.get('YEAR2_URL', 'http://127.0.0.1:4173')
OUT = Path(os.environ.get('YEAR2_CALENDAR_REVIEW_DIR', 'review/year2-calendar'))
OUT.mkdir(parents=True, exist_ok=True)
KEY = 'day-planner-year2-calendar'
results, errors = [], []


def check(name, action, page):
    try:
        action()
        results.append({'name': name, 'passed': True})
        print('PASS:', name, flush=True)
    except Exception as error:
        results.append({'name': name, 'passed': False, 'error': str(error)})
        try:
            page.screenshot(path=str(OUT / 'failure.png'))
            (OUT / 'failure-body.txt').write_text(page.locator('body').inner_text())
        finally:
            report()
        raise


def report():
    (OUT / 'calendar-browser-results.json').write_text(json.dumps({'checks': results, 'pageErrors': errors}, ensure_ascii=False, indent=2))


def seed(browser, language='zh-CN', dark=False, zone='Asia/Shanghai', week_start=1, width=1920):
    context = browser.new_context(viewport={'width': width, 'height': 1300}, device_scale_factor=1,
                                  locale=language, timezone_id=zone)
    data = base.fixture(language, dark)
    data['day-planner-week-start-day'] = str(week_start)
    # Set once per tab. Reload must exercise real persisted choices, not reset
    # them on every document load as the older visual-only fixture did.
    context.add_init_script("if (!sessionStorage.getItem('year2-calendar-fixture')) { for (const [k,v] of Object.entries(" + json.dumps(data) + ")) localStorage.setItem(k,v); sessionStorage.setItem('year2-calendar-fixture','1'); }")
    page = context.new_page()
    page.clock.set_fixed_time(datetime.fromisoformat('2026-09-28T12:00:00+08:00'))
    page.on('pageerror', lambda error: errors.append(str(error)))
    return context, page


def loaded(page, date='2026-09-16'):
    page.goto(f'{URL}/?view=year2&date={date}', wait_until='networkidle')
    expect(page.locator('[data-year2-month]')).to_have_count(12)
    expect(page.locator(f'[data-year2-date="{date}"]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('[data-year2-date]')).to_have_count(366 if date[:4] in ('2028', '2020') else 365)


def cell(page, date):
    return page.locator(f'[data-year2-date="{date}"]')


def options(page):
    root = page.locator('#year2-layer-options')
    if not root.count():
        page.locator('[data-year2-layers-toggle]').click()
    return root


def cn(page):
    options(page).locator('[data-year2-region]').select_option('CN')
    page.keyboard.press('Escape')
    expect(page.locator('#year2-layer-options')).to_have_count(0)


def screenshot(page, name, locator=None):
    page.mouse.move(1, 1)
    (locator or page).screenshot(path=str(OUT / name))


def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    assert page.locator('[data-year2-view]').evaluate('e=>e.scrollWidth<=e.clientWidth+1')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context, page = seed(browser)
        try:
            loaded(page)
            native_before = base.calendar_snapshot(page)

            def initial():
                expect(cell(page, '2026-02-17').locator('.year2-lunar')).to_have_text('春节')
                expect(cell(page, '2026-09-23').locator('.year2-lunar')).to_have_text('秋分')
                expect(page.locator('[data-arrangement]')).to_have_count(0)
                assert page.evaluate('(k)=>localStorage.getItem(k)', KEY) is None
                no_overflow(page)
            check('Chinese language enables cultural labels, never infers a holiday jurisdiction or writes preferences on read', initial, page)

            def enable_region():
                cn(page)
                expect(page.locator('[data-arrangement="rest"]')).to_have_count(33)
                expect(page.locator('[data-arrangement="work"]')).to_have_count(6)
                expect(cell(page, '2026-09-20')).to_have_attribute('data-arrangement', 'work')
                expect(cell(page, '2026-10-10')).to_have_attribute('data-arrangement', 'work')
                expect(cell(page, '2026-02-16').locator('.year2-lunar')).to_have_text('除夕')
                expect(cell(page, '2026-02-15')).to_have_attribute('data-arrangement', 'rest')
                assert '春节' not in cell(page, '2026-02-15').locator('.year2-lunar').inner_text()
                expect(page.locator('.year2-holiday-rail button')).to_have_count(7)
            check('Verified 2026 day-off ranges and all six makeup workdays are independent of festival dates', enable_region, page)

            def holidays():
                page.locator('.year2-holiday-rail button').filter(has_text='春节').click()
                expect(cell(page, '2026-02-15')).to_be_focused()
                expect(page.locator('[data-month-day-sheet]')).to_have_count(0)
                screenshot(page, 'year2-february.png', page.locator('[data-year2-month="2"]'))
                page.locator('.year2-holiday-rail button').filter(has_text='国庆节').click()
                expect(cell(page, '2026-10-01')).to_be_focused()
                screenshot(page, 'year2-october.png', page.locator('[data-year2-month="10"]'))
            check('Holiday strip jumps within the year without opening or editing a task', holidays, page)

            def native_detail():
                cell(page, '2026-09-25').click()
                sheet = page.locator('[data-month-day-sheet]')
                expect(sheet.locator('[data-year2-calendar-detail]')).to_contain_text('2026年八月十五')
                expect(sheet.locator('[data-year2-calendar-detail]')).to_contain_text('中秋节')
                expect(sheet).to_contain_text('学习演讲')
                # Screenshot after the native sheet entrance transition.
                page.wait_for_timeout(250)
                screenshot(page, 'year2-calendar-agenda.png')
                page.keyboard.press('ArrowRight')
                expect(page.locator('[data-month-day-sheet="2026-09-26"]')).to_be_visible()
                expect(sheet.locator('[data-year2-calendar-detail]')).to_contain_text('八月十六')
                page.keyboard.press('Escape')
                expect(sheet).to_have_count(0)
            check('Existing native day sheet shows full lunar date and holiday context; adjacent-day paging stays accurate', native_detail, page)

            def native_overflow():
                cell(page, '2026-09-16').click()
                sheet = page.locator('[data-month-day-sheet]')
                expect(sheet).to_contain_text('排水方案复核')
                expect(sheet).to_contain_text('整理设计意见')
                page.keyboard.press('Escape')
                expect(cell(page, '2026-09-16').locator('.year2-more')).to_have_text('+1')
                expect(cell(page, '2026-09-16').locator('.year2-day-marks svg')).to_have_count(1)
            check('Native task overflow, colours and daily-note markers remain available', native_overflow, page)

            def switches():
                panel = options(page)
                panel.get_by_role('checkbox', name='农历', exact=True).uncheck()
                expect(cell(page, '2026-09-16').locator('.year2-lunar')).to_have_text('\u00a0')
                expect(cell(page, '2026-09-25').locator('.year2-lunar')).to_have_text('中秋节')
                panel.get_by_role('checkbox', name='二十四节气', exact=True).uncheck()
                expect(cell(page, '2026-09-23').locator('.year2-lunar')).to_have_text('\u00a0')
                panel.get_by_role('checkbox').nth(2).uncheck()
                expect(page.locator('.year2-lunar')).to_have_count(0)
                expect(page.locator('[data-arrangement="rest"]')).to_have_count(33)
                for checkbox in panel.get_by_role('checkbox').all(): checkbox.check()
                screenshot(page, 'year2-calendar-options.png')
                page.keyboard.press('Escape')
            check('Lunar, solar-term and festival controls are independent of one another and official holiday status', switches, page)

            def density():
                page.locator('.year2-density button').first.click()
                expect(page.locator('[data-year2-view]')).to_have_attribute('data-density', 'overview')
                expect(cell(page, '2026-09-16').locator('.year2-events')).to_be_hidden()
                expect(cell(page, '2026-09-16').locator('.year2-dots i')).to_have_count(3)
                page.locator('[data-year2-view]').evaluate('e=>e.scrollTop=0')
                screenshot(page, 'year2-calendar-overview.png')
                page.set_viewport_size({'width': 1920, 'height': 1800})
                screenshot(page, 'year2-calendar-full-year.png')
                page.set_viewport_size({'width': 1920, 'height': 1300})
                page.locator('.year2-density button').nth(1).click()
                page.locator('[data-year2-view]').evaluate('e=>e.scrollTop=0')
                screenshot(page, 'year2-calendar-planner.png')
            check('Overview compresses only presentation; agenda mode retains native task titles and overflow', density, page)

            def reload_and_tab():
                loaded(page)
                expect(page.locator('[data-arrangement="rest"]')).to_have_count(33)
                peer = context.new_page()
                peer.goto(f'{URL}/?view=year2&date=2026-09-16', wait_until='networkidle')
                options(peer).get_by_role('checkbox', name='农历', exact=True).uncheck()
                expect(options(page).get_by_role('checkbox', name='农历', exact=True)).not_to_be_checked()
                page.keyboard.press('Escape')
                options(peer).get_by_role('checkbox', name='农历', exact=True).check()
                peer.close()
            check('Preferences survive reload and another tab updates the visible controls without touching tasks', reload_and_tab, page)

            def write_failure():
                before = page.evaluate('(k)=>localStorage.getItem(k)', KEY)
                page.evaluate('''key=>{const set=Storage.prototype.setItem;window.restoreYear2Storage=()=>Storage.prototype.setItem=set;Storage.prototype.setItem=function(k,v){if(k===key)throw Error('quota');return set.call(this,k,v)}}''', KEY)
                panel = options(page)
                panel.get_by_role('checkbox', name='农历', exact=True).click()
                expect(panel.get_by_role('checkbox', name='农历', exact=True)).to_be_checked()
                expect(panel.get_by_role('alert')).to_be_visible()
                assert page.evaluate('(k)=>localStorage.getItem(k)', KEY) == before
                page.evaluate('()=>window.restoreYear2Storage()')
                panel.get_by_role('checkbox', name='农历', exact=True).uncheck()
                expect(panel.get_by_role('alert')).to_have_count(0)
                panel.get_by_role('checkbox', name='农历', exact=True).check()
                page.keyboard.press('Escape')
            check('Failed preference write retains saved controls and data, then retries normally', write_failure, page)

            def missing_schedule():
                loaded(page, '2027-02-06')
                expect(page.locator('.year2-coverage-note')).to_contain_text('2027')
                expect(page.locator('[data-arrangement]')).to_have_count(0)
                expect(cell(page, '2027-02-06').locator('.year2-lunar')).to_have_text('春节')
                screenshot(page, 'year2-schedule-unavailable.png')
                loaded(page, '2101-01-01')
                expect(page.locator('.year2-coverage-note').first).to_contain_text('1900–2100')
                expect(page.locator('[data-year2-date]')).to_have_count(365)
                loaded(page)
            check('Unbundled official years are explicitly unavailable; unsupported lunar years keep the Gregorian calendar intact', missing_schedule, page)

            def keyboard_native():
                cell(page, '2026-09-16').focus()
                page.keyboard.press('ArrowRight');expect(cell(page, '2026-09-17')).to_be_focused()
                page.keyboard.press('PageDown');expect(cell(page, '2026-10-17')).to_be_focused()
                page.locator('[data-year2-view]').evaluate('e=>document.activeElement.blur()')
                page.keyboard.press('7');expect(page.locator('.jobu-year')).to_be_visible()
                page.keyboard.press('8');expect(page.locator('[data-year2-view]')).to_be_visible()
                page.locator('[data-year2-month="9"] h2 button').click()
                expect(page.locator('[data-month-view]')).to_be_visible()
                page.keyboard.press('8')
            check('Roving date focus, original Year, native Month and Year 2 shortcuts remain intact', keyboard_native, page)

            for width in [1180, 850]:
                def responsive(width=width):
                    page.set_viewport_size({'width': width, 'height': 1100})
                    no_overflow(page)
                    page.locator('[data-year2-view]').evaluate('e=>e.scrollTop=0')
                    screenshot(page, f'year2-calendar-{width}.png')
                check(f'{width}px desktop window wraps month cards without horizontal overflow', responsive, page)

            def dark():
                page.set_viewport_size({'width': 1920, 'height': 1300})
                page.locator('[data-year2-view]').evaluate('e=>document.activeElement.blur()')
                page.keyboard.press('d')
                expect(page.locator('[data-year2-view]')).to_have_class(re.compile('year2-dark'))
                page.locator('.year2-density button').first.click()
                page.locator('[data-year2-view]').evaluate('e=>e.scrollTop=0')
                screenshot(page, 'year2-calendar-dark.png')
                assert base.calendar_snapshot(page) == native_before
            check('Native dark theme and all navigation preserve task identity, schedule and completion', dark, page)
            context.close()

            for zone in ['America/Los_Angeles', 'Asia/Shanghai']:
                context, page = seed(browser, language='en', zone=zone, week_start=0)
                loaded(page)
                def civil_dates():
                    expect(page.locator('.year2-lunar')).to_have_count(0)
                    expect(page.locator('[data-arrangement]')).to_have_count(0)
                    panel = options(page)
                    for checkbox in panel.get_by_role('checkbox').all(): checkbox.check()
                    panel.locator('[data-year2-region]').select_option('CN')
                    page.keyboard.press('Escape')
                    expect(cell(page, '2026-02-17').locator('.year2-lunar')).to_have_text('春节')
                    expect(cell(page, '2026-09-25').locator('.year2-lunar')).to_have_text('中秋节')
                    expect(cell(page, '2026-09-20')).to_have_attribute('data-arrangement', 'work')
                    cell(page, '2026-10-10').click()
                    expect(page.locator('[data-year2-calendar-detail]')).to_contain_text('2026年九月初一')
                    expect(page.locator('[data-year2-calendar-detail]')).to_contain_text('Makeup workday')
                    page.keyboard.press('Escape')
                    page.locator('.year2-density button').first.click()
                    page.locator('[data-year2-view]').evaluate('e=>e.scrollTop=0')
                    screenshot(page, f'year2-calendar-en-{zone.replace("/", "-")}.png')
                check(f'English UI, Sunday-first week and {zone} timezone keep selected Chinese civil dates stable', civil_dates, page)
                context.close()

            context, page = seed(browser)
            loaded(page)
            def corrupted_preferences():
                page.evaluate('(k)=>localStorage.setItem(k,"{invalid")', KEY)
                page.reload(wait_until='networkidle')
                panel = options(page)
                panel.get_by_role('checkbox', name='农历', exact=True).click()
                expect(panel.get_by_role('alert')).to_be_visible()
                assert page.evaluate('(k)=>localStorage.getItem(k)', KEY) == '{invalid'
                panel.get_by_role('button', name='恢复默认', exact=True).click()
                expect(panel.get_by_role('alert')).to_have_count(0)
                expect(panel.get_by_role('checkbox', name='农历', exact=True)).to_be_checked()
                assert page.evaluate('(k)=>localStorage.getItem(k)', KEY) is None
            check('Corrupt stored preferences remain untouched until explicit reset', corrupted_preferences, page)
            assert not errors, errors
            results.append({'name': 'No uncaught browser errors', 'passed': True})
        finally:
            report()
            browser.close()
    print(json.dumps({'passed': len(results), 'checks': results}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
