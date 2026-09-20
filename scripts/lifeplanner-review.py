"""Production-app review. Synthetic data only; screenshots are Chromium renders,
not a physical-device claim. Run after npm run build and npm run preview.
Prerequisites: Python Playwright 1.55+, installed Chromium, Noto CJK fonts.
"""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(os.environ.get('REVIEW_OUT', 'review-artifacts'))
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('REVIEW_URL', 'http://127.0.0.1:5173')
KEY = 'day-planner-lifeplanner-v1'
RESULTS, ERRORS = [], []


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
        try:
            page.screenshot(path=str(OUT / ('failure-' + str(len(RESULTS)) + '.png')), full_page=True)
            (OUT / ('failure-' + str(len(RESULTS)) + '.txt')).write_text(page.locator('body').inner_text(), encoding='utf-8')
        except Exception:
            pass


def read_doc(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY)


def wait_count(page, collection, count):
    # Web Locks make commits asynchronous; wait for the durable document,
    # rather than assuming the click event is itself a completed save.
    page.wait_for_function('([key,collection,count]) => JSON.parse(localStorage.getItem(key))[collection].length === count', arg=[KEY,collection,count])


def set_checkbox(locator, checked):
    if locator.is_checked() != checked:
        locator.click()
    if checked:
        expect(locator).to_be_checked()
    else:
        expect(locator).not_to_be_checked()


def native_snapshot(page):
    return page.evaluate("""() => Object.fromEntries(['day-planner-tasks','day-planner-unscheduled','day-planner-projects','day-planner-goals'].map(k=>[k, JSON.parse(localStorage.getItem(k)||'[]')]))""")


def profile(browser, *, mobile=False, dark=False, english=False, width=None):
    context = browser.new_context(viewport={'width': width or (393 if mobile else 1440), 'height': 852 if mobile else 960},
                                  locale='en-US' if english else 'zh-CN', timezone_id='Asia/Shanghai',
                                  is_mobile=mobile, has_touch=mobile, device_scale_factor=1,
                                  reduced_motion='reduce', service_workers='block')
    context.add_init_script("""if (!localStorage.getItem('lifeplanner-review-seeded')) {
      const data = {
       'i18nextLng': LANG, 'welcomeDismissed':'true', 'gettingStartedDismissed':'true',
       'day-planner-darkmode': DARK, 'day-planner-goals-projects-enabled':'true',
       'day-planner-lifeplanner-enabled':'true',
       'day-planner-glance-fabs-collapsed':'0',
       'day-planner-unscheduled':JSON.stringify([{id:'review-inbox',title:'整理本周阅读笔记',completed:false,notes:'',subtasks:[],color:'bg-blue-500'}]),
       'day-planner-goals':JSON.stringify([{id:'review-goal',title:'持续学习',status:'active',color:'bg-blue-500',createdAt:'2026-09-20T08:00:00Z',updatedAt:'2026-09-20T08:00:00Z'}]),
       'day-planner-projects':JSON.stringify([{id:'review-existing',title:'阅读与写作',status:'active',goalId:'review-goal',color:'bg-blue-500',createdAt:'2026-09-20T08:00:00Z',updatedAt:'2026-09-20T08:00:00Z'}])
      };
      Object.entries(data).forEach(([k,v])=>localStorage.setItem(k,v));
      localStorage.setItem('lifeplanner-review-seeded','1');
    }""".replace('LANG', json.dumps('en' if english else 'zh-CN')).replace('DARK', json.dumps('true' if dark else 'false')))
    page = context.new_page()
    page.set_default_timeout(12000)
    page.on('pageerror', lambda error: ERRORS.append(str(error)))
    page.goto(BASE, wait_until='domcontentloaded')
    page.wait_for_timeout(1500)
    if page.locator('[data-planning-choices]').count():
        page.locator('.planning-choices-snooze').click()
    # Dismiss the native weekly reminder through its real UI when it covers
    # navigation on a Sunday. Do not hide overlays or force a blocked click.
    reminder = page.locator('.fixed.bottom-6.right-6.z-50.w-64')
    if reminder.count():
        reminder.locator('button').first.click()
        expect(reminder).not_to_be_visible()
    if mobile:
        # The existing mobile Goals tab owns its header and the new entry below it.
        tabs = page.locator('button').filter(has=page.locator('svg.lucide-git-branch'))
        if tabs.count():
            tabs.first.click()
        else:
            page.get_by_role('button', name=re.compile('目标|Goals')).first.click()
    try:
        page.get_by_role('button', name='Life planning' if english else '生活规划', exact=True).first.click()
    except Exception:
        page.screenshot(path=str(OUT / f'bootstrap-{mobile}-{dark}-{english}.png'))
        (OUT / f'bootstrap-{mobile}-{dark}-{english}.txt').write_text(page.locator('body').inner_text(), encoding='utf-8')
        raise
    expect(page.locator('[data-lifeplanner]')).to_be_visible()
    return context, page


def add_wish(page, text='出版自己的代表作品'):
    root = page.locator('[data-lifeplanner]')
    root.get_by_role('textbox', name='写下一件你真正想实现的事……', exact=True).fill(text)
    root.get_by_role('button', name='添加愿望', exact=True).click()
    expect(root.get_by_role('button', name='编辑 · 人生愿望', exact=True).filter(has_text=text)).to_be_visible()


def open_vision(page, title='出版2本书'):
    root = page.locator('[data-lifeplanner]')
    root.get_by_role('button', name='添加五年愿景', exact=True).first.click()
    sheet = page.locator('[data-life-vision]')
    sheet.get_by_label('可衡量的愿景', exact=True).fill(title)
    sheet.get_by_label('规划起点', exact=True).fill('2026-09-20')
    return sheet


def save_vision(sheet):
    sheet.get_by_role('button', name='保存', exact=True).click()
    expect(sheet).not_to_be_visible()


def no_overflow(page):
    require(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'Page has horizontal overflow')
    root = page.locator('[data-lifeplanner]')
    require(root.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'), 'Workspace has horizontal overflow')


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(**({'executable_path': os.environ['CHROMIUM_EXECUTABLE']} if os.environ.get('CHROMIUM_EXECUTABLE') else {}))
    context, page = profile(browser)
    page.on('dialog', lambda dialog: dialog.accept())
    original_native = native_snapshot(page)

    def empty_and_entry():
        require(page.locator('[data-life-wish]').count() == 0, 'Must not prepopulate personal wishes')
        expect(page.get_by_role('heading', name='100个人生愿望', exact=True)).to_be_visible()
        expect(page.get_by_role('heading', name='格言（人生原则）', exact=True)).to_be_visible()
        require(page.locator('[data-life-principle]').count() == 5, 'Workbook default principles missing')
        require(page.locator('[data-life-guide]').count() == 0, 'Guidance must start collapsed')
        require(page.locator('.lp-guide-button').evaluate('(el)=>getComputedStyle(el).backgroundColor') == 'rgb(254, 139, 0)', 'Guide button must use GLANCE brand')
        no_overflow(page)
        page.screenshot(path=str(OUT / 'desktop-empty.png'))
    check('empty workspace, native brand and collapsed guidance', empty_and_entry, page)

    def purpose_and_star():
        add_wish(page)
        root = page.locator('[data-lifeplanner]')
        root.get_by_role('button', name='收藏愿望 · 出版自己的代表作品', exact=True).click()
        expect(root.get_by_role('button', name='取消收藏 · 出版自己的代表作品', exact=True)).to_have_attribute('aria-pressed', 'true')
        require(read_doc(page)['wishes'][0]['starred'], 'Star was not persisted')
    check('add purpose and replace its sequence number with a favorite star', purpose_and_star, page)

    def vision_and_milestones():
        sheet = open_vision(page, '出版2本书，3年内')
        sheet.get_by_label('现状值', exact=True).fill('0')
        expect(sheet.get_by_label('愿景期限', exact=True)).to_have_value('3')
        sheet.get_by_role('button', name='增加阶段', exact=True).click()
        sheet.get_by_label('第1阶段的数值', exact=True).fill('1')
        sheet.get_by_role('button', name='增加阶段', exact=True).click()
        sheet.get_by_label('第2阶段的数值', exact=True).fill('2')
        sheet.get_by_label('第2阶段的时长', exact=True).fill('2')
        expect(sheet.locator('.lp-total')).to_contain_text('3')
        page.screenshot(path=str(OUT / 'vision-breakdown.png'))
        save_vision(sheet)
        v=read_doc(page)['wishes'][0]['visions'][0]
        require(v['title']=='出版2本书' and v['amount']==3 and len(v['steps'])==2, 'Wrong parsed/saved vision')
    check('automatic measure/time recognition and sequential 3-year breakdown', vision_and_milestones, page)

    def independent_completion():
        root=page.locator('[data-lifeplanner]')
        set_checkbox(root.get_by_role('checkbox', name='标记愿景已实现 · 出版2本书', exact=True), True)
        d=read_doc(page)
        require(d['wishes'][0]['visions'][0]['completed'] and not d['wishes'][0]['completed'], 'Vision completed its purpose')
        set_checkbox(root.get_by_role('checkbox', name='标记愿景已实现 · 出版2本书', exact=True), False)
        set_checkbox(root.get_by_role('checkbox', name='标记愿望已实现 · 出版自己的代表作品', exact=True), True)
        require(not read_doc(page)['wishes'][0]['visions'][0]['completed'], 'Purpose completed its vision')
        set_checkbox(root.get_by_role('checkbox', name='标记愿望已实现 · 出版自己的代表作品', exact=True), False)
        require(native_snapshot(page)==original_native, 'Planner completion modified native entities')
    check('independent checkboxes never complete native tasks or projects', independent_completion, page)

    def native_project():
        page.locator('.lp-vision-title').first.click()
        sheet=page.locator('[data-life-vision]')
        sheet.get_by_role('button', name='增加项目安排', exact=True).first.click()
        modal=page.locator('.lp-project-mask')
        expect(modal.get_by_role('heading', name='新建项目', exact=True)).to_be_visible()
        expect(modal.locator('input').first).to_have_value('出版1本书')
        page.screenshot(path=str(OUT / 'native-project-form.png'))
        modal.get_by_role('button', name='创建项目', exact=True).click()
        expect(modal).not_to_be_visible()
        expect(sheet.get_by_role('button',name='打开项目规划',exact=True)).to_be_visible()
        save_vision(sheet)
        page.wait_for_timeout(500)
        d=read_doc(page); pid=d['wishes'][0]['visions'][0]['steps'][0]['projectId']
        native=native_snapshot(page)
        project=next((p for p in native['day-planner-projects'] if p['id']==pid),None)
        require(project and project['title']=='出版1本书' and project['targetDate']=='2027-09-20', 'Native project missing or date incorrect')
        require(len(native['day-planner-projects'])==2, 'Created duplicate projects')
        require(native['day-planner-unscheduled']==original_native['day-planner-unscheduled'], 'Created tasks without permission')
        require(native['day-planner-goals']==original_native['day-planner-goals'], 'Mutated native goals')
    check('native ProjectForm creates exactly one real project with a stable link', native_project, page)

    def guidance_filter_principles():
        root=page.locator('[data-lifeplanner]')
        root.get_by_role('button', name='展开规划引导', exact=True).click()
        expect(page.locator('[data-life-guide]')).to_be_visible()
        root.get_by_label('生活领域 · 出版自己的代表作品',exact=True).select_option('creation')
        expect(root).to_contain_text('此生真正想创造并留下什么')
        root.get_by_role('button', name='收起规划引导',exact=True).click()
        root.get_by_label('搜索愿望与愿景',exact=True).fill('nonexistent')
        require(page.locator('[data-life-wish]').count()==0, 'Search did not filter')
        require(len(read_doc(page)['wishes'])==1, 'Search deleted data')
        root.get_by_label('搜索愿望与愿景',exact=True).fill('')
        root.get_by_label('写下一条想坚持的人生原则……',exact=True).fill('先把方向想清楚，再开始行动')
        root.get_by_role('button',name='添加原则',exact=True).click()
        wait_count(page, 'principles', 6)
        require(len(read_doc(page)['principles'])==6,'Principle not stored')
    check('guidance/category/filtering and editable principles', guidance_filter_principles, page)

    def quota_retry():
        before=len(read_doc(page)['wishes'])
        page.evaluate("""(key)=>{const original=Storage.prototype.setItem;window.reviewRestoreStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('Quota','QuotaExceededError');return original.call(this,k,v);};}""",KEY)
        root=page.locator('[data-lifeplanner]'); text='持续阅读与学习'
        root.get_by_label('写下一件你真正想实现的事……',exact=True).fill(text)
        root.get_by_role('button',name='添加愿望',exact=True).click()
        expect(root.get_by_role('alert')).to_contain_text('保存失败')
        expect(root.get_by_label('写下一件你真正想实现的事……',exact=True)).to_have_value(text)
        require(len(read_doc(page)['wishes'])==before,'Failed save mutated data')
        page.evaluate('() => { window.reviewRestoreStorage(); }')
        root.get_by_role('button',name='添加愿望',exact=True).click()
        wait_count(page, 'wishes', before+1)
        require(len(read_doc(page)['wishes'])==before+1,'Retry duplicated wish')
    check('storage failure preserves input and safe retry creates one wish',quota_retry,page)

    def conflict():
        page.locator('.lp-vision-title').first.click(); sheet=page.locator('[data-life-vision]')
        sheet.get_by_label('现状值',exact=True).fill('9')
        page.evaluate("""key=>{const oldValue=localStorage.getItem(key),d=JSON.parse(oldValue);d.wishes[0].visions[0].current=1;d.revision++;const newValue=JSON.stringify(d);localStorage.setItem(key,newValue);window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue,storageArea:localStorage}));}""",KEY)
        sheet.get_by_role('button',name='保存',exact=True).click()
        expect(sheet.get_by_role('alert')).to_contain_text('其他地方被修改')
        expect(sheet.get_by_label('现状值',exact=True)).to_have_value('9')
        require(read_doc(page)['wishes'][0]['visions'][0]['current']==1,'Stale form overwrote new value')
        sheet.get_by_role('button',name='取消',exact=True).click()
    check('stale vision editor retains draft and refuses to overwrite newer data',conflict,page)

    def removal_undo():
        root=page.locator('[data-lifeplanner]'); before=native_snapshot(page)
        root.get_by_role('button',name='删除 · 出版自己的代表作品',exact=True).click()
        wait_count(page, 'wishes', 1)
        require(len(read_doc(page)['wishes'])==1,'Delete failed')
        root.get_by_role('button',name='撤销',exact=True).click()
        wait_count(page, 'wishes', 2)
        require(len(read_doc(page)['wishes'])==2,'Undo failed')
        require(native_snapshot(page)==before,'Deleting a purpose modified native projects')
    check('delete and undo purpose do not cascade into native projects',removal_undo,page)

    def reload_and_backup():
        previous=read_doc(page); page.reload(wait_until='domcontentloaded')
        page.get_by_role('button',name='生活规划',exact=True).first.click()
        require(read_doc(page)==previous,'Reload lost planner data')
        root=page.locator('[data-lifeplanner]');root.get_by_role('button',name='更多操作',exact=True).click()
        with page.expect_download() as download:
            root.get_by_role('button',name='导出生活规划',exact=True).click()
        path=OUT / 'synthetic-backup.json';download.value.save_as(path)
        backup=json.loads(path.read_text())
        require(backup['document']==previous,'Backup omitted data')
        root.get_by_role('button',name='更多操作',exact=True).click()
        page.locator('[data-lifeplanner] input[type=file]').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{}'})
        expect(root.get_by_role('alert')).to_contain_text('有效的生活规划')
        require(read_doc(page)==previous,'Invalid import overwrote data')
        page.locator('[data-lifeplanner] input[type=file]').set_input_files(str(path))
        expect(root.get_by_role('status')).to_contain_text('已导入')
        require(read_doc(page)['wishes']==previous['wishes'],'Restore changed wishes')
    check('reload, real JSON download and guarded import/restore',reload_and_backup,page)

    def keyboard_and_exit():
        root=page.locator('[data-lifeplanner]'); before=native_snapshot(page)
        root.get_by_role('button',name='编辑 · 人生愿望',exact=True).first.click()
        root.get_by_role('textbox',name='人生愿望',exact=True).fill('Temporary edit')
        page.keyboard.press('Escape');expect(root).to_be_visible()
        require(read_doc(page)['wishes'][0]['title']=='出版自己的代表作品','Escape saved a draft')
        page.keyboard.press('Control+z');require(native_snapshot(page)==before,'Global undo leaked into native tasks')
        root.locator('button').last.focus();page.keyboard.press('Tab')
        require(root.evaluate('(el)=>el.contains(document.activeElement)'), 'Tab escaped modal')
        root.get_by_role('button',name='关闭',exact=True).first.click()
        expect(root).not_to_be_visible()
        page.screenshot(path=str(OUT/'native-entry.png'))
    check('keyboard focus, Escape, native undo isolation and original app return',keyboard_and_exit,page)

    context.close()
    # Independent screenshot profile: examples are explicit test fixtures, not default personal content.
    context,page=profile(browser); page.on('dialog',lambda d:d.accept())
    def examples_screenshots():
        root=page.locator('[data-lifeplanner]');root.get_by_role('button',name='展开规划引导',exact=True).click()
        for count, category in enumerate(['self','career','wealth','learning','creation','health','family'], start=1):
            root.get_by_label('人生规划引导',exact=True).select_option(category)
            root.get_by_role('button',name='填入参考示例',exact=True).click()
            wait_count(page, 'wishes', count)
        require(len(read_doc(page)['wishes'])==7,'Explicit examples did not append')
        page.screenshot(path=str(OUT/'desktop-guided.png'))
        root.get_by_role('button',name='收起规划引导',exact=True).click()
        root.get_by_role('button',name=re.compile('^收藏愿望')).nth(0).click()
        root.get_by_role('button',name=re.compile('^收藏愿望')).nth(2).click()
        no_overflow(page);page.screenshot(path=str(OUT/'desktop-simple.png'))
        (OUT/'sample-document.json').write_text(json.dumps(read_doc(page),ensure_ascii=False,indent=2),encoding='utf-8')
    check('optional workbook examples, dense collapsed and guided screenshots',examples_screenshots,page)
    sample=read_doc(page)
    context.close()
    for mobile,dark,english,width,label in [(False,True,False,1440,'desktop-dark'),(False,False,True,1440,'desktop-english'),(True,False,False,393,'mobile-393'),(True,True,False,320,'mobile-320-dark')]:
        context,page=profile(browser,mobile=mobile,dark=dark,english=english,width=width)
        page.on('dialog',lambda d:d.accept())
        def responsive():
            if not english and sample:
                page.evaluate("""([key,d])=>{const oldValue=localStorage.getItem(key),newValue=JSON.stringify(d);localStorage.setItem(key,newValue);window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue,storageArea:localStorage}));}""",[KEY,sample])
            no_overflow(page)
            page.screenshot(path=str(OUT/(label+'.png')))
            if mobile:
                page.locator('.lp-vision-title').first.click()
                expect(page.locator('[data-life-vision]')).to_be_visible()
                require(page.locator('.lp-vision-sheet').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),'Vision modal overflows')
                page.screenshot(path=str(OUT/(label+'-vision.png')))
        check(label+' layout, language/theme and modal',responsive,page)
        context.close()
    browser.close()

report={'environment':'Production dayGLANCE application in Chromium; synthetic data; no physical device/provider round trips.',
        'tests':RESULTS,'uncaughtErrors':ERRORS}
(OUT/'browser-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
if ERRORS or any(not test['passed'] for test in RESULTS):
    raise SystemExit(1)
