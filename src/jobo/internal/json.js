// Shared JSON primitives for JOBO pure core. Internal only.

export const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export const plain = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export const nonempty = value => typeof value === 'string' && value.trim().length > 0;
/**
 * Canonical JSON for the final tie-break, including ALL nested keys. Arrays
 * retain their order. No localeCompare, top-level replacer whitelist, coercion
 * of undefined/NaN to null, or dependence on property insertion order.
 */
export function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if ((!plain(value) && !Array.isArray(value)) || ancestors.has(value)) {
    throw new TypeError('Record must contain only acyclic JSON data');
  }
  ancestors.add(value);
  let text;
  if (Array.isArray(value)) {
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!own(value, index)) throw new TypeError('Sparse arrays are not record data');
      entries.push(canonicalJson(value[index], ancestors));
    }
    text = `[${entries.join(',')}]`;
  } else {
    text = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`).join(',')}}`;
  }
  ancestors.delete(value);
  return text;
}
export const copy = value => JSON.parse(canonicalJson(value));

