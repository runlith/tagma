import * as Schema from 'effect/Schema';
import type { Nobody, NobodyWhy } from '../contract/wire/holdings.js';
import { DebtWindowSchema, owedOf, type Debt } from './owed.js';
import { ReleasedSpanSchema, releasedOf, type ReleasedLine } from './released.js';
import { LandedPieceSchema, type Landed } from './landed.js';
import type { Proven } from './projection.js';
import { lineIn, shareText, type TextSlice } from './text.js';

export type DebtRecord = { readonly commit: string; readonly windows: string; readonly windowCount: number };
export type ReleasedRecord = { readonly row: string; readonly thread: string; readonly reason: string; readonly span: string };
export type LandedRecord = {
  readonly digest: string;
  readonly head: string | null;
  readonly working: string | null;
  readonly pieces: string;
};
export type Witnesses = {
  readonly released: readonly ReleasedRecord[];
  readonly debts: readonly DebtRecord[];
  readonly landed: readonly LandedRecord[];
};
export const NO_WITNESSES: Witnesses = { released: [], debts: [], landed: [] };
export type FoldEvidence = { readonly outside: NobodyWhy; readonly witnesses: Witnesses };

type SharedDebt = Omit<DebtRecord, 'windows'> & { readonly windows: TextSlice };
type SharedRelease = Omit<ReleasedRecord, 'span'> & { readonly span: TextSlice };
type SharedLanding = Omit<LandedRecord, 'pieces'> & { readonly pieces: TextSlice };
export type SharedEvidence = {
  readonly outside: NobodyWhy;
  readonly debts: readonly SharedDebt[];
  readonly released: readonly SharedRelease[];
  readonly landed: readonly SharedLanding[];
};
export type ReadEvidence = {
  readonly outside: NobodyWhy;
  readonly debts: readonly Debt[];
  readonly released: readonly ReleasedLine[];
  readonly landed: readonly Landed[];
};

export const shareEvidence = ({ outside, witnesses }: FoldEvidence): SharedEvidence => {
  const text = (value: string) => shareText(value, [0, value.length]);
  return {
    outside,
    debts: witnesses.debts.map((one) => ({ commit: one.commit, windowCount: one.windowCount, windows: text(one.windows) })),
    released: witnesses.released.map((one) => ({ row: one.row, thread: one.thread, reason: one.reason, span: text(one.span) })),
    landed: witnesses.landed.map((one) => ({ digest: one.digest, head: one.head, working: one.working, pieces: text(one.pieces) })),
  };
};

const debtWindows = Schema.decodeUnknownSync(Schema.Array(DebtWindowSchema));
const releaseSpan = Schema.decodeUnknownSync(ReleasedSpanSchema);
const landedPieces = Schema.decodeUnknownSync(Schema.Array(LandedPieceSchema));

export const readEvidence = (given: SharedEvidence): ReadEvidence => ({
  outside: given.outside,
  debts: given.debts.map((one) => ({ commit: one.commit, windows: debtWindows(JSON.parse(lineIn(one.windows, 0))) })),
  released: given.released.map((one) => ({
    row: one.row,
    thread: one.thread,
    reason: one.reason,
    span: releaseSpan(JSON.parse(lineIn(one.span, 0))),
  })),
  landed: given.landed.map((one) => ({
    digest: one.digest,
    head: one.head,
    working: one.working,
    pieces: landedPieces(JSON.parse(lineIn(one.pieces, 0))),
  })),
});

export const nobodyOf = (verdict: Proven, evidence: ReadEvidence): readonly Nobody[] => {
  const { added, removed } = verdict.nobody;
  if (added + removed === 0) return verdict.existence === 'external' ? [{ added: 0, removed: 0, why: evidence.outside }] : [];
  if (verdict.lines === 'unweighed' || (evidence.released.length === 0 && evidence.debts.length === 0))
    return [{ added, removed, why: evidence.outside }];
  const released = releasedOf(verdict, evidence.released);
  const owed = owedOf(verdict, evidence.debts);
  const groups = new Map<string, { why: NobodyWhy; added: number; removed: number }>();
  for (const [index, line] of verdict.lines.entries()) {
    if (line.mark !== 'external') continue;
    const release = released.get(index);
    const commit = owed.get(index);
    const why: NobodyWhy =
      release !== undefined ? { kind: 'released', ...release } : commit !== undefined ? { kind: 'steps', commit } : evidence.outside;
    const key = JSON.stringify(why);
    const group = groups.get(key) ?? { why, added: 0, removed: 0 };
    group[line.kind] += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
};
