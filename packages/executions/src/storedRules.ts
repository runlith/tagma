//! Wire 26 stored a rule copy's absent `thread`/`through` as null; a stored row drops those keys before the strict decode.
export const withoutNullRuleKeys = (stored: unknown): unknown => {
  if (typeof stored !== 'object' || stored === null || !('rules' in stored) || !Array.isArray(stored.rules)) return stored;
  const rules = stored.rules.map((rule: unknown) => {
    if (typeof rule !== 'object' || rule === null) return rule;
    const entries = Object.entries(rule).filter(([key, value]) => !((key === 'thread' || key === 'through') && value === null));
    return Object.fromEntries(entries);
  });
  return { ...stored, rules };
};
