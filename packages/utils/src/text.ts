const STROKE_LETTERS: Record<string, string> = {
  đ: 'd',
  Đ: 'D',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  ħ: 'h',
  Ħ: 'H',
  ŧ: 't',
  Ŧ: 'T',
};

export function foldDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐøØłŁħĦŧŦ]/g, (ch) => STROKE_LETTERS[ch] ?? ch);
}

export function clipLabel(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3).trimEnd()}...` : value;
}

export function normalizeLoose(value: string): string {
  return foldDiacritics(value.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' '));
}

export function normalizeExact(value: string): string {
  return value.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === '' || b === '') return Math.max(a.length, b.length);
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = matrix[i] as number[];
      const prev = matrix[i - 1] as number[];
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
  }
  return (matrix[a.length] as number[])[b.length] as number;
}

export function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function escapeHtml(value: string): string {
  return escapeAttribute(value).replaceAll("'", '&#39;');
}
