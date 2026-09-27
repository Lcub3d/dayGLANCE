// The five seeded mottos are stored as ordinary user text. Keep this table
// local and static so recognizing historical seeds never loads every locale
// bundle eagerly. A saved item is eligible for translation only when both its
// seeded id and exact text match a known value below.
export const PRINCIPLE_KEYS = Object.freeze([
  'longTerm',
  'important',
  'health',
  'honesty',
  'margin',
]);

export const PRINCIPLE_IDS = Object.freeze(PRINCIPLE_KEYS.map((_, index) => `principle-${index}`));

export const PRINCIPLE_TEXTS = Object.freeze({
  de: Object.freeze({
    longTerm: 'Langfristig denken',
    important: 'Wichtiges vor Dringendem',
    health: 'Die eigene Gesundheit nicht aufs Spiel setzen',
    honesty: 'Ehrlich sein',
    margin: 'Bei wichtigen Entscheidungen eine Sicherheitsmarge lassen',
  }),
  en: Object.freeze({
    longTerm: 'Think long term',
    important: 'Important before urgent',
    health: 'Do not borrow against your health',
    honesty: 'Be honest',
    margin: 'Keep a margin of safety in key decisions',
  }),
  es: Object.freeze({
    longTerm: 'Pensar a largo plazo',
    important: 'Lo importante antes que lo urgente',
    health: 'No hipotecar la salud',
    honesty: 'Ser honesto',
    margin: 'Dejar un margen de seguridad en las decisiones clave',
  }),
  fr: Object.freeze({
    longTerm: 'Penser à long terme',
    important: 'L’important avant l’urgent',
    health: 'Ne pas sacrifier sa santé',
    honesty: 'Être honnête',
    margin: 'Garder une marge de sécurité dans les décisions importantes',
  }),
  it: Object.freeze({
    longTerm: 'Pensare a lungo termine',
    important: 'Prima l’importante dell’urgente',
    health: 'Non sacrificare la salute',
    honesty: 'Essere onesti',
    margin: 'Lasciare un margine di sicurezza nelle decisioni importanti',
  }),
  'pt-BR': Object.freeze({
    longTerm: 'Pensar no longo prazo',
    important: 'O importante antes do urgente',
    health: 'Não comprometer a saúde',
    honesty: 'Ser honesto',
    margin: 'Manter uma margem de segurança nas decisões importantes',
  }),
  'pt-PT': Object.freeze({
    longTerm: 'Pensar a longo prazo',
    important: 'O importante antes do urgente',
    health: 'Não comprometer a saúde',
    honesty: 'Ser honesto',
    margin: 'Manter uma margem de segurança nas decisões importantes',
  }),
  'zh-CN': Object.freeze({
    longTerm: '长期主义',
    important: '先重要后紧急',
    health: '不透支健康',
    honesty: '诚实',
    margin: '关键决策保留安全边际',
  }),
});

// One key can have several historical spellings, one from each shipped locale.
// The arrays are exported so callers and tests can inspect the exact allowlist.
export const PRINCIPLE_ALIASES = Object.freeze(Object.fromEntries(
  PRINCIPLE_KEYS.map(key => [key, Object.freeze(Object.values(PRINCIPLE_TEXTS).map(texts => texts[key]))]),
));

const localeTags = Object.keys(PRINCIPLE_TEXTS);

function normalizeLanguage(language) {
  if (typeof language !== 'string' || !language) return 'en';
  const exact = localeTags.find(tag => tag.toLowerCase() === language.toLowerCase());
  if (exact) return exact;
  const base = language.split('-')[0].toLowerCase();
  if (base === 'pt') return 'pt-PT';
  return localeTags.find(tag => tag.split('-')[0].toLowerCase() === base) || 'en';
}

export function principleKeyFor(principleOrId, text) {
  const id = typeof principleOrId === 'string' ? principleOrId : principleOrId?.id;
  const value = typeof principleOrId === 'string' ? text : principleOrId?.text;
  const index = PRINCIPLE_IDS.indexOf(id);
  if (index < 0 || typeof value !== 'string') return null;
  const key = PRINCIPLE_KEYS[index];
  return PRINCIPLE_ALIASES[key].includes(value) ? key : null;
}

export function isKnownDefaultPrinciple(principleOrId, text) {
  return !!principleKeyFor(principleOrId, text);
}

export const isDefaultPrinciple = isKnownDefaultPrinciple;

export function principleDefaultsForLanguage(language = 'en') {
  const values = PRINCIPLE_TEXTS[normalizeLanguage(language)];
  return PRINCIPLE_KEYS.map(key => values[key]);
}

export function defaultPrincipleText(key, language = 'en') {
  if (!PRINCIPLE_KEYS.includes(key)) return '';
  return PRINCIPLE_TEXTS[normalizeLanguage(language)][key];
}

/**
 * Return a display value while leaving the stored principle untouched.
 * `translate` is normally the i18next `t` function; passing a language tag is
 * also supported for pure callers and tests. Unrecognized/user-edited text is
 * returned verbatim.
 */
export function localizedPrincipleText(principle, translate) {
  const raw = typeof principle?.text === 'string' ? principle.text : '';
  const key = principleKeyFor(principle);
  if (!key) return raw;
  if (typeof translate === 'function') {
    const path = `lifeplanner.defaults.${key}`;
    const value = translate(path, { defaultValue: raw });
    if (typeof value === 'string' && value && value !== path) return value;
  }
  if (typeof translate === 'string') return defaultPrincipleText(key, translate);
  return defaultPrincipleText(key, 'en') || raw;
}
