import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Loader, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { aiJSON, PROVIDER_LABELS } from '../../ai.js';
import { MAX_SWOT_STRATEGIES, SWOT_FACTORS, SWOT_GROUPS, uid } from '../../lifeplanner/model.js';
import { acceptSwotSuggestion, editableSwot, parseSwotSuggestions, saveSwot, swotPrompts } from '../../lifeplanner/swot.js';
import useDialogFocus from './useDialogFocus.js';
import VisionEditor from './VisionEditor.jsx';
import './swot.css';

function StrategyField({ value, label, onChange, disabled, inputRef }) {
  const ref = useRef(null);
  const setRef = element => {
    ref.current = element;
    inputRef?.(element);
  };
  useLayoutEffect(() => {
    const element = ref.current;
    const fit = () => {
      element.style.height = '1px';
      element.style.height = `${Math.max(44, element.scrollHeight)}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return <textarea ref={setRef} rows={1} value={value} maxLength={2000} disabled={disabled}
    aria-label={label} onChange={event => onChange(event.target.value)} />;
}

export default function SwotEditor({ wish, store, onClose, onOpenProject }) {
  const ctx = useDayPlannerCtx();
  const { aiConfig, multiUserEnabled } = useFeaturesCtx();
  const { t, i18n } = useTranslation();
  const S = (key, options) => t(`lifeplanner.swot.${key}`, options);
  const [draft, setDraft] = useState(() => editableSwot(wish.swot));
  const baseline = useRef(draft), expected = useRef(wish.swot ?? null);
  const root = useRef(null), saving = useRef(false), request = useRef(0), strategyRefs = useRef(new Map()), pendingFocus = useRef(null);
  const [busy, setBusy] = useState(false), [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState(''), [aiError, setAiError] = useState('');
  const [suggestions, setSuggestions] = useState(null);
  const [vision, setVision] = useState(null);
  const readOnly = !!multiUserEnabled || !!store.error();
  const disabled = busy || readOnly;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.current);
  const configured = aiConfig?.enabled && (aiConfig.apiKey || aiConfig.provider === 'ollama');
  const hasFactors = SWOT_FACTORS.some(key => draft.factors[key].trim());
  useEffect(() => () => { request.current += 1; }, []);
  useLayoutEffect(() => {
    const field = strategyRefs.current.get(pendingFocus.current);
    if (!field) return;
    field.focus();
    pendingFocus.current = null;
  }, [draft.strategies]);

  const close = () => {
    if (saving.current) return;
    if (!dirty || window.confirm(t('lifeplanner.discard'))) onClose();
  };
  useDialogFocus(root, close, !vision);
  const explain = err => t(`lifeplanner.errors.${err.message}`, { defaultValue: t('lifeplanner.errors.unknown') });
  const changeFactor = (key, value) => setDraft(current => ({ ...current, factors: { ...current.factors, [key]: value } }));
  const changeRows = (group, transform) => setDraft(current => ({ ...current, strategies: { ...current.strategies, [group]: transform(current.strategies[group]) } }));
  const addStrategy = group => {
    const id = uid();
    pendingFocus.current = id;
    changeRows(group, rows => [...rows, { id, text: '' }]);
  };

  async function persist() {
    if (readOnly) return null;
    try {
      const next = await store.commit(current => saveSwot(current, wish.id, draft, expected.current));
      const saved = next.wishes.find(item => item.id === wish.id);
      expected.current = saved.swot;
      // Keep empty writing lines in the editor; they need not become records.
      baseline.current = draft;
      setError('');
      return saved;
    } catch (err) { setError(explain(err)); return null; }
  }
  async function save(event) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true);
    if (await persist()) onClose();
    saving.current = false; setBusy(false);
  }
  async function promote(group, row) {
    if (saving.current || !row.text.trim()) return;
    saving.current = true; setBusy(true);
    const saved = await persist();
    if (saved) {
      const source = saved.swot.strategies[group].find(item => item.id === row.id);
      const original = saved.visions.find(item => item.id === source.visionId) || null;
      if (!original && saved.visions.length >= 30) setError(t('lifeplanner.errors.limit'));
      else setVision({ wish: saved, original, seed: source.text, strategySource: { ...source, group } });
    }
    saving.current = false; setBusy(false);
  }
  function closeVision() {
    const live = store.get().wishes.find(item => item.id === wish.id);
    if (live) {
      const next = editableSwot(live.swot);
      expected.current = live.swot ?? null; baseline.current = next; setDraft(next);
    }
    setVision(null);
  }
  async function analyze() {
    if (!configured || !hasFactors || aiBusy || readOnly) return;
    const ticket = ++request.current;
    setAiBusy(true); setAiError('');
    const prompts = swotPrompts(wish, draft, i18n.resolvedLanguage || i18n.language);
    try {
      const result = parseSwotSuggestions(await aiJSON(prompts.system, prompts.user, aiConfig));
      if (ticket === request.current) setSuggestions(result);
    } catch { if (ticket === request.current) setAiError(S('aiError')); }
    finally { if (ticket === request.current) setAiBusy(false); }
  }
  function adopt(group, text) {
    try { setDraft(acceptSwotSuggestion(draft, group, text)); setError(''); }
    catch (err) { setError(explain(err)); }
  }
  return <>
    <div className="lp-swot-mask" onClick={event => { if (event.target === event.currentTarget && !vision) close(); }}>
      <form ref={root} className={`lp-swot-sheet ${ctx.darkMode ? 'lp-paper-dark' : ''}`} data-life-swot
        role="dialog" aria-modal={!vision} aria-label="SWOT" inert={vision ? '' : undefined} tabIndex={-1} onSubmit={save}>
        <header className="lp-swot-header">
          <button type="button" className="lp-swot-close lp-icon" data-initial-focus aria-label={t('lifeplanner.close')} disabled={busy} onClick={close}><X size={20} /></button>
        </header>
        <div className="lp-swot-body">
          <section aria-labelledby="lp-swot-factors"><h3 id="lp-swot-factors" className="sr-only">{S('factorsTitle')}</h3>
            <div className="lp-swot-grid lp-swot-factors">{SWOT_FACTORS.map(key => <label key={key}>
              <span className="lp-swot-label"><b>{key.toUpperCase()}</b>{S(`factors.${key}.label`)}</span>
              <textarea rows={2} maxLength={4000} value={draft.factors[key]}
                aria-label={`${key.toUpperCase()} · ${S(`factors.${key}.label`)}`} disabled={disabled} onChange={event => changeFactor(key, event.target.value)} />
            </label>)}</div>
          </section>
          <section className="lp-swot-strategies" aria-labelledby="lp-swot-strategies">
            <div className="lp-swot-section-bar"><h3 id="lp-swot-strategies">{S('strategiesTitle')}</h3>
              <button type="button" className="lp-swot-ai-button" title={configured ? S('aiHint', { provider: PROVIDER_LABELS[aiConfig.provider] || aiConfig.provider }) : S('aiSetup')}
                onClick={analyze} disabled={disabled || aiBusy || !configured || !hasFactors}>
                {aiBusy ? <Loader size={15} className="animate-spin" /> : <Sparkles size={15} />}{S(aiBusy ? 'analyzing' : 'analyze')}</button>
            </div>
            {aiBusy && <p role="status" className="lp-swot-help">{S('analyzing')}</p>}
            {aiError && <p role="alert" className="lp-error">{aiError}</p>}
            {suggestions && <div className="lp-swot-suggestions" aria-label={S('aiSuggestions')}>{SWOT_GROUPS.map(group => suggestions[group].map((text, index) => {
              const adopted = draft.strategies[group].some(row => row.text.trim() === text);
              return <div key={`${group}-${index}`} className="lp-swot-suggestion"><b>{group.toUpperCase()}</b><p>{text}</p>
                <button type="button" className="lp-button" disabled={disabled || adopted} onClick={() => adopt(group, text)}>{adopted ? <Check size={14} /> : <Plus size={14} />}{S(adopted ? 'adopted' : 'adopt')}</button></div>;
            }))}</div>}
            <div className="lp-swot-grid">{SWOT_GROUPS.map(group => <section key={group} aria-label={`${group.toUpperCase()} · ${S(`groups.${group}`)}`}>
              <div className="lp-swot-group-heading"><h4 className="lp-swot-label">{S(`groups.${group}`)}</h4>
                <button type="button" className="lp-swot-add" disabled={disabled || draft.strategies[group].length >= MAX_SWOT_STRATEGIES}
                  aria-label={`${S('addStrategy')} · ${group.toUpperCase()}`} title={S('addStrategy')} onClick={() => addStrategy(group)}><Plus size={14} /></button>
              </div>
              <div className="lp-swot-rows">{draft.strategies[group].map((row, index) => {
                const linked = wish.visions.some(item => item.id === row.visionId);
                return <div className="lp-swot-strategy" key={row.id} data-swot-strategy={row.id}>
                  <StrategyField value={row.text} label={S('strategyLabel', { group: group.toUpperCase(), number: index + 1 })} disabled={disabled}
                    inputRef={element => {
                      if (element) strategyRefs.current.set(row.id, element);
                      else strategyRefs.current.delete(row.id);
                    }}
                    onChange={text => changeRows(group, rows => rows.map(item => item.id === row.id ? { ...item, text } : item))} />
                  <button type="button" className={`lp-swot-promote ${linked ? 'is-linked' : ''}`} disabled={disabled || !row.text.trim()}
                    aria-label={`${S(linked ? 'openVision' : 'addVision')} · ${row.text || group.toUpperCase()}`} title={S(linked ? 'openVision' : 'addVision')} onClick={() => promote(group, row)}>
                    {linked ? <Check size={15} /> : <ArrowUpRight size={16} />}</button>
                  <button type="button" className="lp-icon lp-swot-remove" disabled={disabled} aria-label={`${t('lifeplanner.delete')} · ${S('strategyLabel', { group: group.toUpperCase(), number: index + 1 })}`}
                    title={t('lifeplanner.delete')} onClick={() => changeRows(group, rows => rows.filter(item => item.id !== row.id))}><Trash2 size={14} /></button>
                </div>;
              })}</div>
            </section>)}</div>
          </section>
          {(error || readOnly) && <p role="alert" className="lp-error">{error || t(multiUserEnabled ? 'lifeplanner.multiUser' : 'lifeplanner.errors.storageRead')}</p>}
        </div>
        <footer className="lp-swot-footer">
          <button type="button" className="lp-button" disabled={busy} onClick={close}>{t('lifeplanner.cancel')}</button>
          <button type="submit" className="lp-button lp-swot-save" disabled={disabled}><Check size={15} />{t('lifeplanner.save')}</button></footer>
      </form>
    </div>
    {vision && <VisionEditor key={vision.original?.id || vision.strategySource.id} {...vision} store={store} onClose={closeVision} onOpenProject={onOpenProject} />}
  </>;
}
