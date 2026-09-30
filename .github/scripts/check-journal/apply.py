from pathlib import Path
import json
import re
import shutil
import hashlib
import subprocess

root = Path(__file__).resolve().parent

def replace(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert s.count(old) == 1, (path, old[:70])
    p.write_text(s.replace(old, new))

for name in ['CheckPanel.jsx', 'CheckPanel.test.jsx', 'checkJournal.js', 'checkJournal.test.js']:
    shutil.copy2(root / 'files' / name, Path('src/components/jobo') / name)

for suffix in ['.js', '.test.js']:
    old = Path('src/components/jobo/checkSummary' + suffix)
    new = Path('src/jobo/checkSummary' + suffix)
    assert not new.exists()
    old.rename(new)
    s = new.read_text().replace("'../../jobo/", "'./").replace("'../../utils/", "'../utils/")
    for old_value, value in [('p1', 'high'), ('p2', 'medium'), ('p3', 'low'), ('p4', 'none')]:
        s = s.replace("'" + old_value + "'", "'" + value + "'").replace('priorities.' + old_value, 'priorities.' + value)
    s = s.replace('Check text projection of the existing day model', 'Statistics seed from the existing day model')
    new.write_text(s)
replace('src/jobo/checkSummary.js', '// Check-only presentation rollup. It reads the committed day model and the\n// existing core/statistics APIs; it owns no records, grouping rule or writer.', '// Dormant seed for the separately proposed Statistics view (#1882 review).\n// The Check journal does not import this rollup. No records or writes owned here.')
replace('src/jobo/checkSummary.js', '''// Native priority is 3 (highest) through 0. A missing field may have been
// stripped on scheduling; do NOT reconstruct it from a tag or call it P4.
// Nor is today's priority a historical snapshot of a Do's priority.
export function checkPriority(task) {
  return Number.isInteger(task?.priority) && task.priority >= 0 && task.priority <= 3
    ? `p${4 - task.priority}` : 'unknown';
}''', '''// Native priority: 0 = none, then low, medium, high. Missing task metadata
// stays unknown; neither a title nor a tag proves the current priority.
export function checkPriority(task) {
  if (!task) return 'unknown';
  const value = task.priority;
  return Number.isInteger(value) && value >= 0 && value <= 3
    ? ['none', 'low', 'medium', 'high'][value] : 'unknown';
}''')
replace('src/components/JoboView.jsx', '  const liveDetail = details && doItems.find((item) => item.id === details.item.id);', '''  const openCheckNotes = (task) => {
    setCheckOpen(false);
    if (sidebar && lookup.some(candidate => String(candidate.id) === String(task.id))) {
      setSelectedTaskId(task.id);
      return;
    }
    // Leave the read-only journal before opening native task notes. Spotlight's
    // existing navigation handles off-day plans, Inbox and archived projects.
    const isInbox = (ctx.unscheduledTasks || []).some(candidate => String(candidate.id) === String(task.id));
    ctx.handleSpotlightSelect({ task, source: task.archived ? 'archived' : isInbox ? 'inbox' : 'scheduled' });
    ctx.setExpandedNotesTaskId(task.id);
  };
  const canOpenCheckNotes = typeof ctx.handleSpotlightSelect === 'function'
    && typeof ctx.setExpandedNotesTaskId === 'function';
  const liveDetail = details && doItems.find((item) => item.id === details.item.id);''')
replace('src/components/JoboView.jsx', '          inboxTasks={(ctx.unscheduledTasks || []).filter(task => typeof isVisibleForUser !== \'function\' || isVisibleForUser(task))}', '          onOpenNotes={canOpenCheckNotes ? openCheckNotes : undefined} formatTime={ctx.formatTime}')

keys = ['button', 'title', 'actual', 'session', 'untimed', 'otherDays', 'noRecords', 'unavailable', 'invalid']
translations = {
'en': ['Check', 'Check', 'Actual', 'Session {{number}}', 'Time not recorded', 'Includes sessions on other days.', 'No executions recorded for this day. This does not mean no work happened.', 'Execution records are unavailable. Try again after the ledger loads.', 'Some records could not be read. This journal may be incomplete; timing comparisons are hidden.'],
'zh-CN': ['复盘', '复盘', '实际', '第 {{number}} 次执行', '未记录时间', '包含其他日期的执行。', '这一天没有执行记录，但不代表没有做事。', '执行记录暂不可用，请在记录加载后重试。', '部分记录无法读取。日志可能不完整，暂不显示时间对比。'],
'de': ['Rückblick', 'Rückblick', 'Tatsächlich', 'Einheit {{number}}', 'Zeit nicht erfasst', 'Enthält Einheiten an anderen Tagen.', 'Für diesen Tag sind keine Ausführungen erfasst. Das bedeutet nicht, dass nichts erledigt wurde.', 'Ausführungsdaten sind nicht verfügbar. Bitte nach dem Laden der Aufzeichnungen erneut versuchen.', 'Einige Aufzeichnungen konnten nicht gelesen werden. Das Journal ist möglicherweise unvollständig; Zeitvergleiche werden ausgeblendet.'],
'es': ['Revisión', 'Revisión', 'Real', 'Sesión {{number}}', 'Tiempo no registrado', 'Incluye sesiones de otros días.', 'No hay ejecuciones registradas para este día. Esto no significa que no se haya trabajado.', 'Los registros de ejecución no están disponibles. Inténtalo de nuevo cuando se hayan cargado.', 'No se pudieron leer algunos registros. El diario puede estar incompleto; se ocultan las comparaciones de tiempo.'],
'fr': ['Bilan', 'Bilan', 'Réel', 'Séance {{number}}', 'Temps non enregistré', 'Inclut des sessions sur d’autres jours.', 'Aucune exécution enregistrée pour cette journée. Cela ne signifie pas qu’aucun travail n’a été effectué.', 'Les enregistrements d’exécution sont indisponibles. Réessayez une fois leur chargement terminé.', 'Certains enregistrements n’ont pas pu être lus. Le journal est peut-être incomplet ; les comparaisons de temps sont masquées.'],
'it': ['Riepilogo', 'Riepilogo', 'Effettivo', 'Sessione {{number}}', 'Tempo non registrato', 'Include sessioni di altri giorni.', 'Nessuna esecuzione registrata per questo giorno. Ciò non significa che non sia stato svolto alcun lavoro.', 'I dati di esecuzione non sono disponibili. Riprova dopo il caricamento delle registrazioni.', 'Alcune registrazioni non sono leggibili. Il diario potrebbe essere incompleto; i confronti temporali sono nascosti.'],
'pl': ['Przegląd', 'Przegląd', 'Rzeczywiste', 'Sesja {{number}}', 'Nie zarejestrowano czasu', 'Obejmuje sesje z innych dni.', 'Brak zarejestrowanych wykonań z tego dnia. Nie oznacza to, że nie wykonano żadnej pracy.', 'Zapisy wykonania są niedostępne. Spróbuj ponownie po ich wczytaniu.', 'Nie udało się odczytać niektórych zapisów. Dziennik może być niekompletny; porównania czasu są ukryte.'],
'pt-BR': ['Revisão', 'Revisão', 'Real', 'Sessão {{number}}', 'Tempo não registrado', 'Inclui sessões de outros dias.', 'Nenhuma execução registrada neste dia. Isso não significa que nenhum trabalho foi realizado.', 'Os registros de execução estão indisponíveis. Tente novamente após o carregamento.', 'Não foi possível ler alguns registros. O diário pode estar incompleto; as comparações de tempo estão ocultas.'],
'pt-PT': ['Revisão', 'Revisão', 'Real', 'Sessão {{number}}', 'Tempo não registado', 'Inclui sessões de outros dias.', 'Nenhuma execução registada neste dia. Isto não significa que não tenha sido realizado trabalho.', 'Os registos de execução estão indisponíveis. Tente novamente após o carregamento.', 'Não foi possível ler alguns registos. O diário pode estar incompleto; as comparações de tempo estão ocultas.'],
'uk': ['Огляд', 'Огляд', 'Фактично', 'Сеанс {{number}}', 'Час не записано', 'Включає сеанси за інші дні.', 'За цей день немає записів про виконання. Це не означає, що роботу не виконували.', 'Записи про виконання недоступні. Спробуйте ще раз після їх завантаження.', 'Деякі записи не вдалося прочитати. Журнал може бути неповним; порівняння часу приховано.'],
}
for lang, values in translations.items():
    p = Path(f'public/locales/{lang}/translation.json')
    s = p.read_text()
    d = json.loads(s)
    match = re.search(r'^    "check": ', s, re.M)
    assert match, p
    start = match.end()
    obj, end = json.JSONDecoder().raw_decode(s[start:])
    assert obj == d['jobo']['check']
    new = json.dumps(dict(zip(keys, values)), ensure_ascii=False, indent=2).replace('\n', '\n    ')
    p.write_text(s[:start] + new + s[start + end:])
    changed = json.loads(p.read_text())
    changed['jobo'].pop('check')
    d['jobo'].pop('check')
    assert changed == d

hashes = {
'src/components/jobo/CheckPanel.jsx': '9456574376d761d44f6d39a3778ed996c80d9447ab334f6ece1da0d2ceb09d0e',
'src/components/jobo/CheckPanel.test.jsx': '9677d091e97f54518e997b5d2cf05279e9f1ba65aac8b809ec98b19d1f617d08',
'src/components/jobo/checkJournal.js': 'eba661c8ced240776fd8a39264613bb258300f8085f438ea553221468b05c825',
'src/components/jobo/checkJournal.test.js': '00b22a7e2b62e2546f0ebddf5191f8790ae0e9286f677e43d97fd8f675c79039',
'src/components/JoboView.jsx': 'b30af1be8c8e0503cf11e00136054d62cfd877a05c58d274444cd10a5c6ec728',
'src/jobo/checkSummary.js': '8ef73998348bcea13cf38a971bcde80afccf45825e9f7998450afeed953a4207',
'src/jobo/checkSummary.test.js': 'f0a8b864ee0e69d5aa3d57fb168cef44fe75377ec7585a46acb43ebde23d040a',
}
for name, expected in hashes.items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected, name
allowed = set(hashes) | {f'public/locales/{lang}/translation.json' for lang in translations} | {'src/components/jobo/checkSummary.js', 'src/components/jobo/checkSummary.test.js'}
changed = set(subprocess.check_output(['git', 'diff', '--name-only'], text=True).splitlines())
changed.update(subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], text=True).splitlines())
assert changed == allowed, sorted(changed ^ allowed)
print('Reviewed source hashes match; only Check, retained statistics seed, and jobo.check locales changed.')
