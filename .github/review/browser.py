import json, os
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(os.environ.get('REVIEW_OUTPUT','/tmp/jobo-results'));out.mkdir(parents=True,exist_ok=True)
date='2026-09-27';stamp='2026-09-27T12:00:00+08:00'
def task(id,title,start,duration,color,completed=False):
 return dict(id=id,title=title,date=date,startTime=start,duration=duration,color=color,completed=completed,notes='仅用于界面审查的合成任务。',lastModified=stamp)
tasks=[task('a','核对设计方案','09:00',60,'bg-blue-500'),task('b','整理项目资料','10:30',45,'bg-teal-500',True),task('c','阅读与笔记','13:00',30,'bg-violet-500'),task('d','安排明日工作','15:00',30,'bg-orange-500'),task('e','测试完成与补录','16:00',30,'bg-green-500')]
def record(id,t,start,end,**over):
 r=dict(id=id,taskId=t['id'],title=t['title'],date=date,startTime=start,endDate=date,endTime=end,timing='timed',source='manual',progress='partial',planSnapshot={k:t[k] for k in ['date','startTime','duration']},createdAt=stamp,updatedAt=stamp,observedAt=stamp,deleted=False);r.update(over);return r
records=[record('a-1',tasks[0],'09:10','09:50'),record('a-2',tasks[0],'09:40','10:20'),record('b-1',tasks[1],'10:20','10:50',progress='completed'),record('c-1',tasks[2],'13:00','13:30'),record('d-1',tasks[3],None,None,timing='untimed',endDate=None,progress='started')]
checks=[];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':2048,'height':1120},locale='zh-CN',timezone_id='Asia/Shanghai',device_scale_factor=1)
 context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(('http://127.0.0.1:5199','ws://127.0.0.1:5199','data:','blob:')) else route.abort())
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.clock.install(time=datetime(2026,9,27,4,0,0,tzinfo=timezone.utc))
 page.add_init_script("""if(!sessionStorage.getItem('seeded')){const fixture=%s;localStorage.setItem('day-planner-jobo-enabled','true');localStorage.setItem('day-planner-default-view',JSON.stringify('jobo'));localStorage.setItem('day-planner-tasks',JSON.stringify(fixture));localStorage.setItem('day-planner-unscheduled','[]');localStorage.setItem('day-planner-recurring-tasks','[]');localStorage.setItem('gettingStartedDismissed','true');localStorage.setItem('i18nextLng','zh-CN');localStorage.setItem('day-planner-darkmode','false');sessionStorage.setItem('seeded','true');}"""%json.dumps(tasks,ensure_ascii=False))
 def rows():return page.evaluate("async()=>{const m=await import('/src/jobo/store.js');return(await m.createJoboStore().read()).value||[];}")
 def native():return page.evaluate("JSON.parse(localStorage.getItem('day-planner-tasks'))")
 try:
  page.goto('http://127.0.0.1:5199/?view=jobo&date='+date,wait_until='networkidle',timeout=60000)
  assert page.evaluate("async rows=>{const m=await import('/src/jobo/store.js');return(await m.createJoboStore().write(rows)).ok;}",records)
  page.reload(wait_until='networkidle');page.locator('[data-jobo-day-stats]').wait_for(timeout=30000)
  page.wait_for_function("document.querySelector('[data-jobo-day-stats]')?.dataset.recordedMinutes==='130'")
  stats=page.locator('[data-jobo-day-stats]');assert stats.get_attribute('data-comparable-groups')=='3'
  assert '1 / 5' in page.locator('[data-jobo-daily-tile=native]').inner_text()
  for dim in ['start','finish','duration']:assert '1 / 3' in page.locator('[data-jobo-daily-tile='+dim+']').inner_text()
  checks.append('header: union 130, native 1/5, independent offsets each 1/3, one untimed group excluded')
  page.screenshot(path=str(out/'jobo-day-light.png'))
  trigger=page.locator('[data-jobo-daily-tile=start]');trigger.click();page.locator('.jobo-day-details').wait_for();page.screenshot(path=str(out/'jobo-day-details.png'))
  page.keyboard.press('Escape');assert page.locator('.jobo-day-details').count()==0;assert trigger.evaluate('(el)=>el===document.activeElement');checks.append('details opens, Escape closes and restores focus')
  card=page.locator('[data-jobo-plan-link]').filter(has_text='测试完成与补录').first
  card.locator('button[class*="border-2"][class*="border-white"]').first.click()
  page.wait_for_function("async()=>{const m=await import('/src/jobo/store.js');return((await m.createJoboStore().read()).value||[]).some(r=>r.taskId==='e');}")
  completion=next(r for r in rows() if r['taskId']=='e');assert completion['timing']=='untimed' and completion['progress']=='completed' and completion['endDate'] is None
  assert next(t for t in native() if t['id']=='e')['completed'];checks.append('native completion creates a canonical untimed record')
  untimed=page.locator('.jobo-s5-untimed-card').filter(has_text='测试完成与补录').first
  untimed.get_by_role('button',name='编辑',exact=True).click()
  dialog=page.get_by_role('dialog').filter(has=page.locator('form'));dialog.wait_for()
  dialog.locator('select').first.select_option('timed')
  dialog.locator('input[type=time]').nth(0).fill('16:00');dialog.locator('input[type=time]').nth(1).fill('16:20')
  dialog.get_by_role('button',name='保存',exact=True).click();page.wait_for_function("async()=>{const m=await import('/src/jobo/store.js');return((await m.createJoboStore().read()).value||[]).some(r=>r.taskId==='e'&&r.timing==='timed');}")
  corrected=[r for r in rows() if r['taskId']=='e'];assert len(corrected)==1
  for key in ['id','title','planSnapshot','source','createdAt','observedAt']:assert corrected[0][key]==completion[key],key
  checks.append('untimed interval correction preserves one id and captured history')
  do=page.locator('.jobo-s5-do-card').filter(has_text='测试完成与补录').first
  # A temporary failure is accepted by the existing ledger but not reported as durable.
  page.evaluate("""(()=>{window.__failJobo=true;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(window.__failJobo&&this.transaction.db.name==='dayglance-jobo')throw new DOMException('synthetic review fault','QuotaExceededError');return put.apply(this,args);};})()""")
  do.locator('select[data-progress-current]').select_option('partial')
  page.wait_for_function("[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('待保存'))")
  assert next(r for r in rows() if r['taskId']=='e')['progress']=='completed';assert next(t for t in native() if t['id']=='e')['completed']
  page.evaluate('window.__failJobo=false');page.clock.fast_forward(2500)
  page.wait_for_function("async()=>{const m=await import('/src/jobo/store.js');return((await m.createJoboStore().read()).value||[]).some(r=>r.taskId==='e'&&r.progress==='partial');}")
  assert next(t for t in native() if t['id']=='e')['completed'];checks.append('held edit remains pending until retry, progress never reverse-writes native completion')
  page.evaluate("localStorage.setItem('day-planner-darkmode','true')");page.set_viewport_size({'width':1680,'height':1000});page.reload(wait_until='networkidle');page.locator('[data-jobo-day-stats]').wait_for();page.screenshot(path=str(out/'jobo-day-dark.png'));checks.append('light/dark desktop rendering')
  assert not errors,errors
 except Exception as error:
  errors.append(repr(error));page.screenshot(path=str(out/'browser-failure.png'));raise
 finally:
  (out/'browser-results.json').write_text(json.dumps({'checks':checks,'errors':errors,'pageText':page.locator('body').inner_text()},ensure_ascii=False,indent=2))
  browser.close()
