from pathlib import Path
import sys

root = Path(sys.argv[1])
mode = sys.argv[2]
def edit(path, old, new):
    file = root / path
    text = file.read_text()
    assert text.count(old) == 1, (path, old[:100], text.count(old))
    file.write_text(text.replace(old, new))
def append(path, text):
    file = root / path
    assert text.strip() not in file.read_text()
    file.write_text(file.read_text() + text)

if mode == 'tests':
    append('src/jobo/checkJournal.test.js', r'''

describe('Check journal chronology regressions', () => {
  it('orders midnight-clipped rows by actual start rather than their end', () => {
    const first = record({ id: 'first', date: '2026-09-23', startTime: '23:00', endTime: '01:00' });
    const second = record({ id: 'second', date: '2026-09-23', startTime: '23:50', endTime: '00:10' });
    expect(ids(journal([second, first]))).toEqual(['first', 'second']);
    expect(ids(journal([first, second]))).toEqual(['first', 'second']);
  });
  it('uses the documented id tie-break at equal starts, not interval length', () => {
    const a = record({ id: 'a-long', endTime: '10:00' });
    const z = record({ id: 'z-short', endTime: '09:10' });
    expect(ids(journal([z, a]))).toEqual(['a-long', 'z-short']);
    expect(ids(journal([a, z]))).toEqual(['a-long', 'z-short']);
  });
});
''')
    append('src/components/jobo/JoboCheckPanel.test.jsx', r'''

describe('Check evidence and boundary regressions', () => {
  it.each([
    ['untimed manual', { taskId: null, timing: 'untimed', startTime: null, endDate: null, endTime: null }],
    ['untimed completion', { source: 'completion', progress: 'completed', timing: 'untimed', startTime: null, endDate: null, endTime: null }],
    ['plan-duration estimate', { timingBasis: 'planDuration' }],
  ])('does not present unknown duration as zero measured metrics: %s', (_, extra) => {
    const html = render([make(extra)]);
    expect(html).not.toContain('data-jobo-check-measured');
    expect(html).not.toContain('data-jobo-check-metrics');
    expect(html).toContain('Unmeasured attempts');
  });
  it('retains measured gap and overlap metrics when a group also has an estimate', () => {
    const html = render([
      make(),
      make({ id: 'measured-2', startTime: '09:20', endTime: '10:00' }),
      make({ id: 'estimate', startTime: '11:00', endTime: '12:00', timingBasis: 'planDuration' }),
    ]);
    for (const key of ['recordedLabel', 'elapsedLabel', 'gapLabel', 'overlapLabel']) {
      expect(html).toContain(`>${i18n.t(`jobo.view.${key}`)}</dt>`);
    }
  });
  it('labels an estimated off-day attempt inside a measured row’s full group', () => {
    const html = render([
      make(),
      make({ id: 'estimate', date: '2026-09-25', endDate: '2026-09-25', timingBasis: 'planDuration' }),
    ]);
    const group = html.split('data-jobo-check-group')[1].split('data-jobo-check-notes')[0];
    expect(group).toContain(i18n.t('jobo.view.inferredPlanDuration'));
  });
  it('does not pass the full task action context into the read-only Check panel', () => {
    const view = readFileSync(new URL('../JoboView.jsx', import.meta.url), 'utf8');
    const props = view.match(/<JoboCheckPanel[\s\S]*?\/>/)[0];
    expect(props).not.toContain('ctx={ctx}');
    for (const key of ['cardBg', 'textPrimary', 'textSecondary', 'borderClass', 'darkMode', 'formatTime']) {
      expect(props).toContain(key);
    }
  });
  it('renders checklist notes as read-only text rather than task actions', () => {
    const html = render([make()], {}, [{ ...task, notes: '- [ ] Next thought\n- [x] Previous thought' }]);
    expect(html).toContain('Next thought');
    expect(html).toContain('Previous thought');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<textarea');
  });
});
''')
elif mode == 'source':
    edit('src/jobo/checkJournal.js',
        '    .sort((a, b) => a.startMinute - b.startMinute\n      || a.endMinute - b.endMinute || byId(a.id, b.id));',
        '''    // Clipping two overnight records to 00:00 must not reverse their
    // real start order. For genuinely equal starts, use identity rather than
    // duration, which can change when an interval is corrected.
    .sort((a, b) => a.startMinute - b.startMinute
      || byId(attemptStart(a.record), attemptStart(b.record)) || byId(a.id, b.id));''')
    edit('src/components/jobo/JoboCheckPanel.jsx',
        'function JournalEntry({ item, ctx, t, openInObsidian }) {',
        '''function EvidenceHint({ record, ctx, t }) {
  if (record.timingBasis === 'planDuration') {
    return <p className={`mt-2 text-xs ${ctx.textSecondary}`} data-jobo-check-estimated>{t('jobo.view.inferredPlanDuration')}</p>;
  }
  if (record.timing === 'untimed') {
    return <p className={`mt-2 text-xs ${ctx.textSecondary}`} data-jobo-check-untimed>{t('jobo.check.untimed')}</p>;
  }
  return null;
}

function JournalEntry({ item, ctx, t, openInObsidian }) {''')
    edit('src/components/jobo/JoboCheckPanel.jsx',
        '  const metrics = metricRows(item.comparison, item.comparisonMeta, t);',
        '''  // Zero from an empty measured subset is not a duration measurement.
  // Consume the model's measured comparison directly, including gap/overlap
  // when estimates make the whole-group comparison unavailable.
  const metrics = item.measuredSessions > 0
    ? metricRows(item.comparisonMeta?.measuredComparison || item.comparison, item.comparisonMeta, t)
    : [];''')
    edit('src/components/jobo/JoboCheckPanel.jsx',
        '''    {record.timing === 'untimed' && <p className={`mt-2 text-xs ${ctx.textSecondary}`}>{t('jobo.check.untimed')}</p>}
    {record.timingBasis === 'planDuration' && <p className={`mt-2 text-xs ${ctx.textSecondary}`}>{t('jobo.view.inferredPlanDuration')}</p>}''',
        '    <EvidenceHint record={record} ctx={ctx} t={t} />')
    edit('src/components/jobo/JoboCheckPanel.jsx',
        '''      <ul className={`mt-3 divide-y text-xs ${ctx.borderClass}`}>{attempts.map(attempt => <li key={attempt.id} className="py-2 break-words">
        <p>{actualText(attempt, ctx, t)} · {progressText(attempt, t)}</p>
        <p>{renderTitle(attempt.title)}</p>
      </li>)}</ul>''',
        '''      <ul className={`mt-3 divide-y text-xs ${ctx.borderClass}`}>{attempts.map(attempt => <li key={attempt.id} data-jobo-check-attempt={attempt.id} className="py-2 break-words">
        <p>{actualText(attempt, ctx, t)} · {progressText(attempt, t)}</p>
        <p>{renderTitle(attempt.title)}</p>
        <EvidenceHint record={attempt} ctx={ctx} t={t} />
      </li>)}</ul>''')
    edit('src/components/jobo/JoboCheckPanel.jsx',
        '''  }, []);
  const onKeyDown = event => {''',
        '''  }, []);
  useEffect(() => {
    // A remote deletion or read-error transition can remove the focused row.
    // Keep keyboard navigation in the panel instead of the underlying view.
    if (dialog.current && !dialog.current.contains(document.activeElement)) {
      closeButton.current?.focus();
    }
  }, [model, loaded, error]);
  const onKeyDown = event => {''')
    edit('src/components/JoboView.jsx',
        '    loaded={joboLoaded} error={joboError} onClose={closeCheck} ctx={ctx} t={t} />;',
        '''    loaded={joboLoaded} error={joboError} onClose={closeCheck}
    ctx={{ darkMode: ctx.darkMode, cardBg: ctx.cardBg, textPrimary: ctx.textPrimary,
      textSecondary: ctx.textSecondary, borderClass: ctx.borderClass, formatTime: ctx.formatTime }} t={t} />;''')
    append('docs/jobo-check-journal.md', '''
## Review follow-up

The first-pass scope is unchanged. Check receives only display/formatting context, not the task-action context. Its journal orders overnight slices by their real starts before applying the ID tie-break. Correcting an end time does not reorder records with equal starts.

An entirely unmeasured group has no measured-duration metrics, rather than displaying zero as if it were an observation. Mixed groups consume the existing day model's measured comparison for recorded, elapsed, gap and overlap figures. Each expanded attempt retains its own untimed/estimated label, including attempts outside the selected day.

When a committed update or error removes a focused journal entry, focus returns to the panel's close control. No mutation, queue, storage, task action, new grouping rule or shared-model change is introduced by these fixes.
''')
else:
    raise SystemExit('mode must be tests or source')
