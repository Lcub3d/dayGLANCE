"""Run the existing switch regression, then check compact-guide prompting."""
import json
import os
import runpy
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = runpy.run_path(str(Path(__file__).with_name('planning-choices-review.py')))
profile, check, require = base['profile'], base['check'], base['require']
results, errors, out = base['RESULTS'], base['ERRORS'], base['OUT']
K='day-planner-planning-choices-cadence-v1'
D='day-planner-planning-choices-dismissed-date'
T=datetime.fromisoformat('2026-09-02T10:00:00+08:00')
with sync_playwright() as p:
    browser=p.chromium.launch(**({'executable_path':os.environ['CHROMIUM_EXECUTABLE']} if os.environ.get('CHROMIUM_EXECUTABLE') else {}))
    context,page=profile(browser,language='zh-CN',auto=True,now=T)
    def compact():
        panel=page.locator('[data-planning-choices]')
        expect(panel).to_be_visible()
        for text in ['我的工作方式','先从简单','在 Life Planner 中','完成','把日程']:
            require(not panel.get_by_text(text,exact=False).filter(visible=True).count(),'Removed text is still visible: '+text)
        require(panel.get_by_role('switch').count()==3,'Expected three switches')
        require(panel.get_by_role('button',name='今天不再提示',exact=True).count()==1,'Snooze missing')
        require(panel.locator('svg.lucide-compass').count()==1,'Must use the native Compass')
        require(panel.locator('svg.lucide-x').count()==0,'Close X still visible')
        require(panel.evaluate('(el)=>el.offsetWidth<=420 && el.offsetHeight<420'),'Guide not compact')
        require(panel.locator('.planning-choice-row').evaluate_all('(els)=>els.every(el=>parseFloat(getComputedStyle(el).borderBottomWidth)===0)'),'Unexpected row dividers')
        panel.screenshot(path=str(out/'guide-compact-zh.png'))
        page.screenshot(path=str(out/'guide-in-app-zh.png'))
    check('compact guide auto-opens on first use; annotated content and X are gone',compact,page)
    def outside():
        page.mouse.click(4,4)
        expect(page.locator('[data-planning-choices]')).to_have_count(0)
        page.wait_for_timeout(250)
        require(page.evaluate('(k)=>localStorage.getItem(k)',D) is None,'Outside click silently snoozed')
        base['open_choices'](page)
    check('outside click dismisses only this opening; question mark stays usable',outside,page)
    def snooze():
        page.get_by_role('button',name='今天不再提示',exact=True).click()
        require(page.evaluate('(k)=>localStorage.getItem(k)',D)=='2026-09-02','Wrong local date')
        page.reload(wait_until='domcontentloaded');page.wait_for_timeout(1200)
        expect(page.locator('[data-planning-choices]')).to_have_count(0)
        base['open_choices'](page)
        expect(page.locator('[data-planning-choices]')).to_be_visible()
        page.keyboard.press('Escape')
    check('today snooze survives reload without blocking manual access',snooze,page)
    def next_open_day():
        page.clock.set_fixed_time(datetime.fromisoformat('2026-09-04T10:00:00+08:00'))
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('[data-planning-choices]')).to_be_visible()
        require(json.loads(page.evaluate('(k)=>localStorage.getItem(k)',K))['days']==2,'Counted elapsed days instead of opened dates')
    check('second actual opened date prompts despite a skipped calendar date',next_open_day,page)
    context.close()
    for date,expected in [('2026-10-01',True),('2026-10-02',False)]:
        seed={K:json.dumps({'version':1,'lastVisit':'2026-09-30','days':16,'mondays':16,'sundays':16})}
        context,page=profile(browser,auto=True,now=datetime.fromisoformat(date+'T10:00:00+08:00'),seed=seed)
        def monthly():
            expect(page.locator('[data-planning-choices]')).to_have_count(1 if expected else 0)
        check('monthly rule after all counters saturated: '+date,monthly,page)
        context.close()
    context,page=profile(browser,auto=True,now=T)
    def quota():
        page.evaluate('''key=>{const orig=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw Error('test denied');return orig.call(this,k,v)};window.restoreSnooze=()=>{Storage.prototype.setItem=orig;};}''',D)
        page.locator('.planning-choices-snooze').click()
        expect(page.locator('[data-planning-choices]')).to_be_visible()
        expect(page.get_by_role('alert')).to_contain_text('Could not save')
        require(page.evaluate('(k)=>localStorage.getItem(k)',D) is None,'Fake success')
        page.evaluate('()=>window.restoreSnooze()');page.locator('.planning-choices-snooze').click()
        expect(page.locator('[data-planning-choices]')).to_have_count(0)
    check('failed snooze preserves the guide and supports a durable retry',quota,page)
    context.close();browser.close()
report={'screenshots':'Real compiled application in Chromium, synthetic fixtures; no physical-device claim.','tests':results,'uncaughtErrors':errors}
(out/'guide-browser-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
if errors or any(not r['passed'] for r in results): raise SystemExit(1)
