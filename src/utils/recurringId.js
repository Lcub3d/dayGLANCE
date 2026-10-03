// A recurring occurrence's id is `recurring-<templateId>-<YYYY-MM-DD>`. The
// template id may itself contain dashes (a UUID), so the date is read from
// the last three segments and the template id is everything between.
export const parseRecurringId = (id) => {
  if (typeof id !== 'string' || !id.startsWith('recurring-')) return null;
  const parts = id.split('-');
  const dateStr = parts.slice(-3).join('-');
  const rawTemplateId = parts.slice(1, -3).join('-');
  const templateId = /^\d+$/.test(rawTemplateId) ? Number(rawTemplateId) : rawTemplateId;
  return { templateId, dateStr };
};
