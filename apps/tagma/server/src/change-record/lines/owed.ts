import { stepsIn } from '@runlith/utils/sequenceDiff';
import * as Schema from 'effect/Schema';
import { contentDigest } from '@runlith/files/content';
import { alignWindow } from './alignment.js';
import { tokensOf } from './marks.js';
import type { FormedLine, Proven } from './projection.js';

export const DebtWindowSchema = Schema.Struct({
  lead: Schema.NullOr(Schema.String),
  before: Schema.Array(Schema.String),
  after: Schema.Array(Schema.String),
  trail: Schema.NullOr(Schema.String),
});
export type DebtWindow = typeof DebtWindowSchema.Type;

export type Debt = { readonly commit: string; readonly windows: readonly DebtWindow[] };
export type DebtReference = Pick<Debt, 'commit'>;

const WINDOW_STEPS = 4_000_000;

export function debtWindows(before: string, after: string): readonly DebtWindow[] | null {
  const older = tokensOf(before);
  const newer = tokensOf(after);
  const aligned = alignWindow({ before: older, after: newer, normalized: false }, stepsIn(WINDOW_STEPS));
  if ('reason' in aligned) return null;
  return aligned.changes.map((change) => ({
    lead: change.before.start > 0 ? (older[change.before.start - 1] as string) : null,
    before: older.slice(change.before.start, change.before.end),
    after: newer.slice(change.after.start, change.after.end),
    trail: change.before.end < older.length ? (older[change.before.end] as string) : null,
  }));
}

export const windowText = (window: DebtWindow, side: 'before' | 'after', context: boolean): string =>
  context ? `${window.lead ?? ''}${window[side].join('')}${window.trail ?? ''}` : window[side].join('');

export function formedLines(debts: readonly Debt[]): readonly FormedLine[] {
  const formed: FormedLine[] = [];
  for (const debt of debts)
    for (const window of debt.windows) {
      if (window.before.length === 0) continue;
      if (window.before.length !== window.after.length) {
        for (const line of window.after) formed.push({ formed: line, from: window.before });
        continue;
      }
      for (const [at, from] of window.before.entries()) {
        const line = window.after[at] as string;
        if (line !== from) formed.push({ formed: line, from: [from] });
      }
    }
  return formed;
}

export function owedOf(verdict: Proven, debts: readonly Debt[]): ReadonlyMap<number, string> {
  const owed = new Map<number, string>();
  if (verdict.lines === 'unweighed' || debts.length === 0) return owed;
  const claims = new Map<string, string>();
  for (const debt of debts)
    for (const window of debt.windows) {
      for (const line of window.before) claims.set(`added:${contentDigest(line)}`, debt.commit);
      for (const line of window.after) claims.set(`removed:${contentDigest(line)}`, debt.commit);
    }
  for (const [index, line] of verdict.lines.entries()) {
    if (line.mark !== 'external') continue;
    const commit = claims.get(`${line.kind}:${contentDigest(line.text)}`);
    if (commit !== undefined) owed.set(index, commit);
  }
  return owed;
}
