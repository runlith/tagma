export function pulseWords(counts: { readonly working: number; readonly awaiting: number }): string {
  return [counts.working > 0 ? `${counts.working} working` : null, counts.awaiting > 0 ? `${counts.awaiting} waiting for you` : null]
    .filter((part) => part !== null)
    .join(', ');
}

const SHOWN_COUNT = 99;

export const countOf = (count: number): string => (count > SHOWN_COUNT ? `${SHOWN_COUNT}+` : String(count));
