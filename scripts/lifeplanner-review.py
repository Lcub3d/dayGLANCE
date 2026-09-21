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
        (OUT/'notebook-browser-review.json').write_text(json.dumps({'tests':RESULTS,'uncaughtErrors':ERRORS},ensure_ascii=False,indent=2),encoding='utf-8')
        raise SystemExit(1)


def read_doc(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY)


def wait_count(page, collection, count):
    # Web Locks make commits asynchronous; wait for the durable document,
    # rather than assuming the click event is itself a completed save.
    page.wait_for_function('([key,collection,count]) => JSON.parse(localStorage.getItem(key))?.[collection]?.length === count', arg=[KEY,collection,count])


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
    context.add_init_script("localStorage.setItem('day-planner-planning-choices-dismissed-date',new Date().toLocaleDateString('sv-SE'))")
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
        tabs = page.locator('.fixed.bottom-0').get_by_role('button').filter(has=page.locator('svg.lucide-flag'))
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


def add_wish(page, text='出版一本自己的书'):
    before=len((read_doc(page) or {}).get('wishes',[]))
    field=page.get_by_label('空白愿望行 1',exact=True)
    field.fill(text);field.press('Enter');wait_count(page,'wishes',before+1)
    return read_doc(page)['wishes'][-1]['id']


def root(page):
    return page.locator('[data-lifeplanner]')


def note(page):
    return page.locator('form.lp-vision-sheet')


def open_vision(page, title='出版2本书，3年内'):
    root(page).locator('.lp-add-vision').first.click()
    sheet=note(page)
    sheet.get_by_label('可衡量的愿景',exact=True).fill(title)
    sheet.get_by_label('现状值',exact=True).click()
    return sheet


def save_vision(page):
    sheet=note(page)
    # Current note saves on Escape/outside click; there is no Save/Cancel toolbar.
    page.keyboard.press('Escape');expect(sheet).not_to_be_visible()


def wait_idle(page):
    page.wait_for_function("""() => !document.querySelector('[data-lifeplanner] [aria-busy="true"]') &&
        ![...document.querySelectorAll('.lp-paper-footer')].some(el=>el.textContent.includes('正在保存'))""")


def no_overflow(page):
    require(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Viewport overflow')
    require(root(page).evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),'Workspace overflow')


def simulate_external(page, code):
    page.evaluate("""([key,code])=>{const oldValue=localStorage.getItem(key),doc=JSON.parse(oldValue);
      (new Function('doc',code))(doc); doc.revision++; const newValue=JSON.stringify(doc);
      localStorage.setItem(key,newValue);window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue,storageArea:localStorage}));}""",[KEY,code])


def mouse_move_row(page, source, target, after=True):
    source.hover()
    handle=source.locator('.lp-block-handle').first
    b=handle.bounding_box();destination=target.bounding_box()
    page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2);page.mouse.down()
    page.mouse.move(destination['x']+destination['width']/2,destination['y']+destination['height']*(.8 if after else .2),steps=14)
    page.wait_for_timeout(80);page.mouse.up();wait_idle(page)


with sync_playwright() as playwright:
    browser=playwright.chromium.launch(**({'executable_path':os.environ['CHROMIUM_EXECUTABLE']} if os.environ.get('CHROMIUM_EXECUTABLE') else {}))
    context,page=profile(browser)
    page.on('dialog',lambda dialog:dialog.accept())
    original_native=native_snapshot(page)

    def empty_notebook():
        expect(root(page)).to_have_attribute('data-notebook-mode','notebook')
        expect(root(page).get_by_role('heading',name='人生愿望清单',exact=True)).to_be_visible()
        expect(root(page).get_by_role('heading',name='座右铭',exact=True)).to_be_visible()
        expect(root(page).get_by_role('button',name='展开详情',exact=True)).to_have_text('详情')
        require(root(page).locator('[data-life-wish]').count()==0,'Fabricated wishes')
        require(root(page).locator('[data-life-principle]').count()==5,'Lost existing default mottos')
        require(root(page).locator('[data-life-blank]').count()==8,'Blank ruled lines missing')
        require(root(page).locator('[data-life-guide]').count()==0,'Assistant must start off')
        require(root(page).locator('svg.lucide-arrow-up,svg.lucide-arrow-down').count()==0,'Up/down controls still visible')
        no_overflow(page);page.screenshot(path=str(OUT/'notebook-empty.png'))
    check('quiet ruled notebook, renamed headings, no fabricated wishes or move buttons',empty_notebook,page)

    def assistant_view():
        before=read_doc(page)
        root(page).get_by_role('button',name='展开详情',exact=True).click()
        expect(root(page)).to_have_attribute('data-notebook-mode','assistant')
        require(root(page).locator('[data-life-category]').count()==11,'All categories must be present')
        expect(root(page).locator('.lp-mottos')).to_have_count(0)
        for category in root(page).locator('[data-life-category]').all():
            require(category.locator('h2').inner_text().strip(),'Empty category name')
            require(category.locator('.lp-assistant-explanation').inner_text().strip(),'Explanation missing')
            require(category.locator('.lp-assistant-references').inner_text().strip(),'Prompts missing')
            require(category.locator('textarea').get_attribute('placeholder'),'No default inspiration')
        require(read_doc(page)==before,'Opening assistant persisted fake wishes or hid stored mottos')
        page.screenshot(path=str(OUT/'assistant-empty.png'))
        root(page).get_by_role('button',name='收起详情',exact=True).click()
    check('assistant replaces the full page, hides mottos and lays out all 11 optional templates without data writes',assistant_view,page)

    def writing():
        add_wish(page)
        expect(root(page).get_by_label('人生愿望 · 1',exact=True)).to_have_value('出版一本自己的书')
        for text in ['陪家人去看海','能用英语自在地交流','保持身心健康']:add_wish(page,text)
        f=root(page).get_by_label('空白座右铭行 1',exact=True);f.fill('把时间留给真正重要的事。');f.press('Enter');wait_count(page,'principles',6)
        f=root(page).get_by_label('人生愿望 · 2',exact=True);f.fill('和家人一起去看海');f.press('Tab');wait_idle(page)
        page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)).wishes[1].title==="和家人一起去看海"',arg=KEY)
        require(native_snapshot(page)==original_native,'Writing touched native task/project stores')
    check('write wishes and mottos directly on ruled lines; Enter and blur persist native text fields',writing,page)

    def stars():
        root(page).get_by_role('button',name='收藏愿望 · 出版一本自己的书',exact=True).click()
        expect(root(page).get_by_role('button',name='取消收藏 · 出版一本自己的书',exact=True)).to_have_attribute('aria-pressed','true')
        require(read_doc(page)['wishes'][0]['starred'],'Star not persisted')
    check('favorites still replace the ordinal without reordering',stars,page)

    def sticky_vision():
        sheet=open_vision(page)
        expect(sheet.get_by_label('愿景期限',exact=True)).to_have_value('3')
        for number,value,amount in [(1,'1','1'),(2,'2','3')]:
            expect(sheet.locator('[data-life-stage-empty]')).to_be_visible()
            sheet.get_by_label(f'第{number}阶段的数值',exact=True).fill(value)
            sheet.get_by_label(f'第{number}阶段的时长',exact=True).fill(amount)
            sheet.get_by_label(f'第{number}阶段的数值',exact=True).press('Enter')
            expect(sheet.locator('[data-life-stage]')).to_have_count(number)
        require(sheet.locator('h1,h2,header,details').count()==0,'Note still has repeated headings or explanations')
        for unwanted in ['出版一本自己的书','可衡量结果','五年愿景','填写提示','继承','规划起点']:
            require(unwanted not in sheet.inner_text(),'Unnecessary visible note content: '+unwanted)
        require(sheet.locator('p.lp-helper').count()==0,'Prose helper still visible')
        require(sheet.evaluate('(el)=>el.offsetWidth<=570 && el.offsetHeight<430'),'Note not compact')
        expect(sheet.get_by_label('规划起点',exact=True)).to_have_count(0)
        sheet.get_by_role('button',name='日期设置',exact=True).click()
        sheet.get_by_label('规划起点',exact=True).fill('2026-09-20')
        sheet.get_by_role('button',name='日期设置',exact=True).click()
        page.mouse.move(3,3)
        sheet.screenshot(path=str(OUT/'vision-note.png'));page.screenshot(path=str(OUT/'vision-note-in-app.png'))
        save_vision(page)
        v=read_doc(page)['wishes'][0]['visions'][0]
        require(v['title']=='出版2本书' and v['amount']==3 and len(v['steps'])==2,'Incorrect saved result')
        page.mouse.move(3,3);page.screenshot(path=str(OUT/'notebook-filled.png'))
    check('sticky-note editor contains only result, current state and stage lines; date options are hidden',sticky_vision,page)

    def independent_completion():
        set_checkbox(root(page).get_by_role('checkbox',name='标记愿景已实现 · 出版2本书',exact=True),True)
        d=read_doc(page);require(d['wishes'][0]['visions'][0]['completed'] and not d['wishes'][0]['completed'],'Coupled completion')
        set_checkbox(root(page).get_by_role('checkbox',name='标记愿景已实现 · 出版2本书',exact=True),False)
        set_checkbox(root(page).get_by_role('checkbox',name='标记愿望已实现 · 出版一本自己的书',exact=True),True)
        require(not read_doc(page)['wishes'][0]['visions'][0]['completed'],'Purpose completed its vision')
        set_checkbox(root(page).get_by_role('checkbox',name='标记愿望已实现 · 出版一本自己的书',exact=True),False)
        require(native_snapshot(page)==original_native,'Completion touched native records')
    check('wish and vision completion remain independent of each other and native tasks',independent_completion,page)

    def keyboard_drag():
        before=read_doc(page)['wishes'];handle=root(page).locator(f'[data-life-wish="{before[2]["id"]}"]').locator('.lp-block-handle')
        handle.focus();handle.press('Space');handle.press('Home');handle.press('Space')
        page.wait_for_function('([key,id])=>JSON.parse(localStorage.getItem(key)).wishes[0].id===id',arg=[KEY,before[2]['id']])
        handle.focus();handle.press('Space');handle.press('End');handle.press('Escape')
        require(read_doc(page)['wishes'][0]['id']==before[2]['id'],'Cancelled drag saved a move')
        expect(root(page)).to_be_visible()
        handle.focus();handle.press('Space');handle.press('ArrowDown');handle.press('ArrowDown');handle.press('Space')
        page.wait_for_function('([key,id])=>JSON.parse(localStorage.getItem(key)).wishes[2].id===id',arg=[KEY,before[2]['id']])
    check('block handles support keyboard reorder and Escape cancels without closing the notebook',keyboard_drag,page)

    def pointer_drag():
        before=read_doc(page)['wishes'];rows=root(page).locator('[data-life-wish]')
        mouse_move_row(page,rows.nth(0),rows.nth(2),True)
        page.wait_for_function('([key,id])=>JSON.parse(localStorage.getItem(key)).wishes[2].id===id',arg=[KEY,before[0]['id']])
        rows=root(page).locator('[data-life-wish]');mouse_move_row(page,rows.nth(2),rows.nth(0),False)
        page.wait_for_function('([key,id])=>JSON.parse(localStorage.getItem(key)).wishes[0].id===id',arg=[KEY,before[0]['id']])
        require(read_doc(page)['wishes']==before,'Moving back lost content, identity or linked vision')
    check('pointer handle drag changes only order and preserves complete row content',pointer_drag,page)

    def motto_drag():
        before=read_doc(page)['principles'];rows=root(page).locator('[data-life-principle]')
        mouse_move_row(page,rows.nth(0),rows.nth(2),True)
        page.wait_for_function('([key,id])=>JSON.parse(localStorage.getItem(key)).principles[2].id===id',arg=[KEY,before[0]['id']])
    check('mottos use the same draggable block handle, not up/down controls',motto_drag,page)

    def assistant_write():
        root(page).get_by_role('button',name='展开详情',exact=True).click()
        category=root(page).locator('[data-life-category="creation"]');f=category.get_by_role('textbox').last
        f.fill('完成一个自己的软件');f.press('Enter');wait_count(page,'wishes',5)
        require(read_doc(page)['wishes'][-1]['category']=='creation','Writing lost category')
        page.screenshot(path=str(OUT/'assistant-filled.png'))
        root(page).get_by_role('button',name='收起详情',exact=True).click()
        expect(root(page).get_by_role('heading',name='座右铭',exact=True)).to_be_visible()
        require(len(read_doc(page)['principles'])==6,'Assistant deleted mottos')
    check('write within an assistant category, then return to the same notebook and mottos',assistant_write,page)

    def native_project():
        root(page).locator('.lp-vision-title').first.click();sheet=note(page)
        sheet.locator('[data-life-stage]').first.hover()
        sheet.get_by_role('button',name='增加项目安排',exact=True).first.click()
        modal=page.locator('.lp-project-mask')
        expect(modal.get_by_role('heading',name='新建项目',exact=True)).to_be_visible()
        expect(modal.locator('input').first).to_have_value('出版1本书')
        modal.get_by_role('button',name='创建项目',exact=True).click();expect(modal).not_to_be_visible()
        expect(sheet.get_by_role('button',name='打开项目规划',exact=True)).to_be_visible()
        save_vision(page);page.wait_for_timeout(300)
        d=read_doc(page);pid=d['wishes'][0]['visions'][0]['steps'][0]['projectId'];native=native_snapshot(page)
        project=next((p for p in native['day-planner-projects'] if p['id']==pid),None)
        require(project and project['title']=='出版1本书' and project['targetDate']=='2027-09-20','Native project or calendar date incorrect')
        require(len(native['day-planner-projects'])==2,'Duplicate native project')
        require(native['day-planner-unscheduled']==original_native['day-planner-unscheduled'],'Created unsolicited tasks')
    check('quiet stage action opens the original ProjectForm and creates one linked native project',native_project,page)

    def stage_drag():
        root(page).locator('.lp-vision-title').first.click();sheet=note(page)
        before=read_doc(page)['wishes'][0]['visions'][0]['steps']
        # Stage UI now shows absolute offsets, not successive durations.
        # A move that would reverse time must fail without losing the links.
        handle=sheet.locator('.lp-block-handle').first
        handle.focus();handle.press('Space');handle.press('End');handle.press('Space')
        expect(sheet.get_by_role('alert')).to_be_visible()
        expect(sheet.get_by_label('第1阶段的数值',exact=True)).to_have_value('1')
        require(read_doc(page)['wishes'][0]['visions'][0]['steps']==before,'Rejected move changed saved links')
        # Change the offsets, then reorder into a valid chronology through the
        # real handle. Both stage identities and their project links must follow.
        sheet.get_by_label('第1阶段的时长',exact=True).fill('3')
        sheet.get_by_label('第2阶段的时长',exact=True).fill('1')
        handle.focus();handle.press('Space');handle.press('End');handle.press('Space')
        expect(sheet.get_by_label('第1阶段的数值',exact=True)).to_have_value('2')
        save_vision(page)
        current=read_doc(page)['wishes'][0]['visions'][0]['steps']
        require([s['id'] for s in current]==[s['id'] for s in reversed(before)],'Valid drag failed')
        require(current[1].get('projectId')==before[0].get('projectId'),'Stage move lost native link')
        require([s['amount'] for s in current]==[1,2],'Absolute offsets were not stored as successive durations')
        root(page).locator('.lp-vision-title').first.click();sheet=note(page)
        sheet.get_by_label('第1阶段的时长',exact=True).fill('3')
        sheet.get_by_label('第2阶段的时长',exact=True).fill('1')
        handle=sheet.locator('.lp-block-handle').first
        handle.focus();handle.press('Space');handle.press('End');handle.press('Space');save_vision(page)
        require(read_doc(page)['wishes'][0]['visions'][0]['steps']==before,'Restoring order lost stage data')
    check('stage drag rejects reversed time and preserves links through a valid chronological move',stage_drag,page)

    def failed_write():
        before=read_doc(page)
        page.evaluate("""key=>{const orig=Storage.prototype.setItem;window.restoreNotebookStorage=()=>{Storage.prototype.setItem=orig;};Storage.prototype.setItem=function(k,v){if(k===key)throw Error('test quota');return orig.call(this,k,v);};}""",KEY)
        f=root(page).get_by_label('空白愿望行 1',exact=True);f.fill('留给未来的愿望');f.press('Enter')
        expect(root(page).get_by_role('alert')).to_contain_text('保存失败');expect(f).to_have_value('留给未来的愿望')
        require(read_doc(page)==before,'Failed write modified durable document')
        page.evaluate('()=>window.restoreNotebookStorage()');root(page).get_by_role('button',name='重试保存',exact=True).click()
        wait_count(page,'wishes',len(before['wishes'])+1)
    check('inline save failure retains text; retry persists exactly one wish',failed_write,page)

    def stale_text():
        f=root(page).get_by_label('人生愿望 · 1',exact=True);f.fill('本地尚未保存的文字')
        simulate_external(page,'doc.wishes[0].title="另一处的新标题"')
        f.press('Enter');expect(root(page).get_by_role('alert')).to_contain_text('其他地方被修改')
        expect(f).to_have_value('本地尚未保存的文字');require(read_doc(page)['wishes'][0]['title']=='另一处的新标题','Stale text overwrote remote text')
        f.press('Escape');expect(f).to_have_value('另一处的新标题')
    check('stale inline title cannot overwrite newer content; Escape cancels only that draft',stale_text,page)

    def vision_conflict_and_validation():
        root(page).locator('.lp-vision-title').first.click();sheet=note(page)
        sheet.get_by_label('现状值',exact=True).fill('9')
        simulate_external(page,'doc.wishes[0].visions[0].current=1')
        page.keyboard.press('Escape')
        expect(sheet.get_by_role('alert')).to_contain_text('其他地方被修改');expect(sheet.get_by_label('现状值',exact=True)).to_have_value('9')
        require(read_doc(page)['wishes'][0]['visions'][0]['current']==1,'Stale note overwrote data')
        # A conflicting note deliberately keeps its draft. Reload explicitly discards
        # that local draft without asking the product to bypass its safety guard.
        page.reload(wait_until='domcontentloaded')
        page.get_by_role('button',name='生活规划',exact=True).first.click()
        expect(root(page)).to_be_visible()
        root(page).locator('.lp-vision-title').first.click();sheet=note(page)
        sheet.get_by_label('愿景期限',exact=True).fill('2');page.keyboard.press('Escape')
        expect(sheet.get_by_role('alert')).to_be_visible();require(read_doc(page)['wishes'][0]['visions'][0]['amount']==3,'Invalid horizon saved')
        # A conflicting note deliberately keeps its draft. Reload explicitly discards
        # that local draft without asking the product to bypass its safety guard.
        page.reload(wait_until='domcontentloaded')
        page.get_by_role('button',name='生活规划',exact=True).first.click()
        expect(root(page)).to_be_visible()
    check('minimal note retains conflict and horizon validation; invalid data never saves',vision_conflict_and_validation,page)

    def delete_undo():
        before=native_snapshot(page);count=len(read_doc(page)['wishes'])
        handle=root(page).locator('[data-life-wish]').first.locator('.lp-block-handle')
        handle.focus();handle.press('Shift+F10')
        root(page).locator('.lp-block-menu').get_by_role('button',name='删除',exact=True).click();wait_count(page,'wishes',count-1)
        root(page).get_by_role('button',name='撤销',exact=True).click();wait_count(page,'wishes',count)
        require(native_snapshot(page)==before,'Delete cascaded into native project')
        require(read_doc(page)['wishes'][0]['visions'][0]['steps'][0]['projectId'],'Undo lost project link')
    check('block menu deletion and undo preserve linked native projects',delete_undo,page)

    def backup_restore():
        before=read_doc(page)
        root(page).get_by_role('button',name='更多操作',exact=True).click()
        with page.expect_download() as download:
            root(page).get_by_role('button',name='导出生活规划',exact=True).click()
        dest=OUT/'notebook-backup.json';download.value.save_as(str(dest))
        backup=json.loads(dest.read_text());require(backup['document']['wishes']==before['wishes'],'Export lost wishes')
        root(page).get_by_role('button',name='更多操作',exact=True).click()
        root(page).locator('input[type=file]').set_input_files(str(dest))
        expect(root(page).get_by_role('status').filter(has_text='已导入')).to_be_visible()
        require(read_doc(page)['wishes']==before['wishes'],'Round trip lost data')
        require(read_doc(page)['principles']==before['principles'],'Round trip lost mottos')
    check('same JSON backup/import keeps notebook and native links intact',backup_restore,page)

    def reload():
        before=read_doc(page);page.reload(wait_until='domcontentloaded');page.wait_for_timeout(1200)
        if page.locator('[data-planning-choices]').count():page.locator('.planning-choices-snooze').click()
        page.get_by_role('button',name='生活规划',exact=True).first.click()
        require(read_doc(page)==before,'Reload changed data')
    check('saved document survives closing and reopening the production app',reload,page)
    data_snapshot=read_doc(page)
    context.close()

    for mobile,dark,english,width in [(False,False,True,1440),(False,True,False,1440),(False,False,False,1024),(True,False,False,393),(True,True,True,320)]:
        context,page=profile(browser,mobile=mobile,dark=dark,english=english,width=width)
        page.on('dialog',lambda dialog:dialog.accept())
        def layout():
            # Load the same synthetic old-schema document before re-opening.
            page.evaluate('([key,value])=>localStorage.setItem(key,value)',[KEY,json.dumps(data_snapshot)])
            root(page).get_by_role('button',name='Close' if english else '关闭',exact=True).first.click()
            page.get_by_role('button',name='Life planning' if english else '生活规划',exact=True).first.click()
            no_overflow(page)
            suffix=f'{width}-'+('en' if english else 'zh')+('-dark' if dark else '-light')
            page.mouse.move(1,1);page.screenshot(path=str(OUT/f'notebook-{suffix}.png'))
            root(page).locator('.lp-vision-title').first.click();sheet=note(page)
            require(sheet.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),'Note horizontal overflow')
            page.mouse.move(1,1);sheet.screenshot(path=str(OUT/f'note-{suffix}.png'))
            page.keyboard.press('Escape');expect(sheet).not_to_be_visible()
            root(page).get_by_role('button',name='Show details' if english else '展开详情',exact=True).click()
            require(root(page).locator('[data-life-category]').count()==11,'Category hidden on narrow layout')
            no_overflow(page)
            page.screenshot(path=str(OUT/f'assistant-{suffix}.png'))
            scroller=root(page).locator('[data-lp-scroll]')
            if width<1120:
                require(scroller.evaluate('(el)=>el.scrollWidth>el.clientWidth'),'Wide handwritten spread should scroll within its own page')
                scroller.evaluate('(el)=>el.scrollLeft=el.scrollWidth')
                page.screenshot(path=str(OUT/f'assistant-writing-{suffix}.png'))
        check(f'{width}px {"English" if english else "Chinese"} {"dark" if dark else "light"} notebook, full assistant and note; no page overflow',layout,page)
        context.close()
    browser.close()
report={'screenshots':'Compiled real application in Chromium, synthetic fixtures, not physical-device captures.','tests':RESULTS,'uncaughtErrors':ERRORS}
(OUT/'notebook-browser-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
if ERRORS or any(not result['passed'] for result in RESULTS):raise SystemExit(1)
