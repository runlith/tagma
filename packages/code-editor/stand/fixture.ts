import type { LineEdit } from '@runlith/files/lines';
import type { DiffLine, Mark } from '../src/marks';

const BLOCK = [
  '/**',
  ' * Block {n}: reads a record, folds its fields and reports the total.',
  ' */',
  'export async function fold{n}(input: readonly Record<string, number>[], limit = {n}): Promise<number> {',
  '  let total = 0;',
  "  const label = `block-{n}`; // template literal with ${'nesting'}",
  '  for (const record of input.slice(0, limit)) {',
  '    for (const [key, value] of Object.entries(record)) {',
  "      if (key.startsWith('skip')) continue;",
  '      total += value * 0x{n} + /[a-z]+\\d*/.exec(key)?.length ?? 0;',
  '    }',
  '  }',
  '  return total > 1e6 ? Math.round(total / 1_000) : total;',
  '}',
  '',
];

export function codeLines(count: number): string[] {
  const lines: string[] = [];
  for (let block = 0; lines.length < count; block += 1) {
    for (const line of BLOCK) {
      if (lines.length >= count) break;
      lines.push(line.replaceAll('{n}', String(block)));
    }
  }
  return lines;
}

export const codeText = (count: number): string => `${codeLines(count).join('\n')}\n`;

let seed = 7;
const random = (): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

export function remoteDelta(lines: number, size = 10, near?: number): LineEdit[] {
  const anchor = near ?? Math.floor(random() * Math.max(lines - size, 1));
  const from = Math.min(Math.max(anchor, 0), Math.max(lines - size, 0));
  const body = Array.from({ length: size }, (_, at) => `  const agent${from}_${at} = ${Math.floor(random() * 1000)}; // agent wrote this`);
  return [{ from, to: from + size, lines: body }];
}

const AGENT: Mark = { id: 'thread-a', label: 'Agent · refactor', colour: 'oklch(0.7 0.15 300)' };
const YOU: Mark = { id: 'operator', label: 'You', colour: 'oklch(0.72 0.14 200)' };

export const HIDDEN_FROM = 200;

export function diffRows(count: number, hidden: number): DiffLine[] {
  const source = codeLines(count);
  const rows: DiffLine[] = [];
  let before = 1;
  let after = 1;
  source.forEach((text, at) => {
    if (at >= HIDDEN_FROM && at < HIDDEN_FROM + hidden) {
      before += 1;
      after += 1;
      return;
    }
    if (hidden > 0 && at === HIDDEN_FROM + hidden) {
      rows.push({
        kind: 'context',
        text,
        before: before++,
        after: after++,
        mark: null,
        spans: [],
        hiddenBefore: hidden,
        hiddenAt: HIDDEN_FROM + 1,
      });
      return;
    }
    const stretch = at % 97;
    if (stretch === 10) {
      rows.push({
        kind: 'removed',
        text,
        before: before++,
        after: null,
        mark: AGENT,
        spans: [{ start: 2, end: 9 }],
        hiddenBefore: 0,
        hiddenAt: 0,
      });
      rows.push({
        kind: 'added',
        text: text.replace('total', 'sum'),
        before: null,
        after: after++,
        mark: AGENT,
        spans: [{ start: 2, end: 7 }],
        hiddenBefore: 0,
        hiddenAt: 0,
      });
      return;
    }
    if (stretch === 40) {
      rows.push({
        kind: 'added',
        text: '  // a line the operator added',
        before: null,
        after: after++,
        mark: YOU,
        spans: [],
        hiddenBefore: 0,
        hiddenAt: 0,
      });
    }
    rows.push({ kind: 'context', text, before: before++, after: after++, mark: null, spans: [], hiddenBefore: 0, hiddenAt: 0 });
  });
  return rows;
}
