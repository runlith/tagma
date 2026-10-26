export const unreturned = (text: string): string => (text.includes('\r\n') ? text.replaceAll('\r\n', '\n') : text);

export const returns = (...texts: readonly (string | null | undefined)[]): boolean =>
  texts.some((text) => text !== null && text !== undefined && text.includes('\r'));

export type Ends = { readonly base: string | null; readonly bytes: string | null; readonly normalized: boolean };

const loose = (text: string | null): string | null => (text === null ? null : unreturned(text));

export const endsOf = (ends: Ends): Ends => (ends.normalized ? { ...ends, base: loose(ends.base), bytes: loose(ends.bytes) } : ends);
