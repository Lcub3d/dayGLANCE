"""One-shot, fail-closed integration onto the known v5.2 Jobo source.
The review workflow removes this helper after committing the resulting files.
"""
from pathlib import Path
import json

def replace(text, before, after):
    assert text.count(before) == 1, 'Unexpected integration baseline: '+before[:100]
    return text.replace(before, after)

p = Path('src/components/MobileLayout.jsx')
s = p.read_text()
s = replace(s, "import MobileTimeGrid from './MobileTimeGrid.jsx';", "import MobileTimeGrid from './MobileTimeGrid.jsx';\nimport { JoboMobileRoute, useJoboAvailable } from './jobo/JoboRoutes.jsx';")
s = replace(s, 'const MobileLayout = () => {', 'const MobileLayout = () => {\n  const joboAvailable = useJoboAvailable();\n  const [joboGrid, setJoboGrid] = useState(true);')
s = replace(s, '  const { t, i18n } = useTranslation();', "  const { t, i18n } = useTranslation();\n  const showMobileJobo = joboAvailable && isPhone && joboGrid && mobileViewMode === 'grid';")
s = replace(s, "                    {mobileViewMode === 'month' && <MonthStats compact />}", """                    {joboAvailable && isPhone && mobileViewMode === 'grid' && <button type="button"
                      data-jobo-mobile-toggle aria-pressed={showMobileJobo}
                      aria-label={t('joboMobile.toggle')}
                      className={`px-2 min-w-[64px] text-[10px] font-semibold ${showMobileJobo ? 'text-orange-500' : textSecondary} ${hoverBg}`}
                      onClick={() => setJoboGrid(value => !value)}>Plan / Do</button>}
                    {mobileViewMode === 'month' && <MonthStats compact />}""")
s = replace(s, "{mobileViewMode === 'grid' && <MobileAllDaySection />}", "{mobileViewMode === 'grid' && !showMobileJobo && <MobileAllDaySection />}")
s = replace(s, "{mobileViewMode === 'grid' && <MobileTimeGrid />}", "{mobileViewMode === 'grid' && (showMobileJobo ? <JoboMobileRoute fallback={<MobileTimeGrid />} /> : <MobileTimeGrid />)}")
s = replace(s, "{mobileViewMode === 'grid' && <SummaryStrip compact fabClearance />}", "{mobileViewMode === 'grid' && !showMobileJobo && <SummaryStrip compact fabClearance />}")
s = replace(s, "{/* FAB - Floating Action Button (timeline only) */}\n          {mobileActiveTab === 'timeline' && (", "{/* FAB - Floating Action Button (timeline only; Jobo has inline add controls) */}\n          {mobileActiveTab === 'timeline' && !showMobileJobo && (")
p.write_text(s)
p = Path('src/components/MobileSettingsPanel.jsx')
s = replace(p.read_text(), "import TodoistSettings from './TodoistSettings.jsx';", "import TodoistSettings from './TodoistSettings.jsx';\nimport { JoboSettings } from './jobo/JoboRoutes.jsx';")
s = replace(s, '      {/* View default */}', '      <JoboSettings />\n\n      {/* View default */}')
p.write_text(s)
english = {'view':'Plan / Actual','toggle':'Switch between Plan / Actual and the original time grid','tasks':'Tasks','addTask':'Add task','tools':'Journal actions','recordTask':'Record actual time for {{title}}','addPlan':'Add plan','timeAxis':'Shared hour axis','editNote':'Edit daily note','notePlaceholder':'Write a note…','linkTask':'Link task','unlinked':'No linked task','nextDay':'End time is on the following day','details':'More','sourceNotes':'Edit shared task notes','deleteConfirm':'Delete this actual record? The original task and plan will not change.','errorTitle':'Enter a title.','errorDate':'Choose a valid date.','errorTime':'Enter different, valid start and end times.','errorProgress':'Choose a valid progress level.','errorMissing':'This record was deleted elsewhere. Close and refresh.','errorStorage':'Could not save. Your input is still in the editor. Copy it before checking storage or refreshing.','actual':'Actual','daily':'Daily note'}
chinese = {'view':'计划 / 实际','toggle':'切换计划对照与原始时间网格','tasks':'任务清单','addTask':'添加任务','tools':'账簿操作','recordTask':'记录「{{title}}」的实际时间','addPlan':'添加计划','timeAxis':'共用小时轴','editNote':'编辑今日笔记','notePlaceholder':'记一笔…','linkTask':'关联任务','unlinked':'不关联任务','nextDay':'结束时间为次日','details':'更多','sourceNotes':'编辑共享任务笔记','deleteConfirm':'删除这条实际记录？原任务和计划不会改变。','errorTitle':'请填写名称。','errorDate':'请选择有效日期。','errorTime':'请填写不同的有效起止时间。','errorProgress':'请选择有效进度。','errorMissing':'这条记录已在其他地方删除，请关闭后刷新。','errorStorage':'保存失败，输入仍保留在编辑框中。请先复制内容，再检查存储空间或刷新。','actual':'实际','daily':'今日笔记'}
for p in Path('public/locales').glob('*/translation.json'):
    data = json.loads(p.read_text())
    assert 'joboMobile' not in data, 'Mobile keys already exist'
    zh = p.parent.name == 'zh-CN'
    data['joboMobile'] = chinese if zh else english
    data['jobo']['localOnly'] = '本地实验功能。执行记录不会同步到其他设备，也不包含在原生日历同步中；请单独导出 Jobo 备份。' if zh else 'Local experimental feature. Actual records are not synced to other devices or included in calendar sync. Export a separate Jobo backup.'
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
