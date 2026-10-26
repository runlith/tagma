import type { Holding, HoldingGit, Nobody, NobodyWhy, UnprovenReason } from '../contract/wire/holdings.js';
import { holderAt } from '../../workspace/contract/wire/checkout.js';
import type { Unknown } from '../lines/folding.js';
import { owedOf } from '../lines/owed.js';
import type { Proven, Verdict } from '../lines/projection.js';
import { releasedOf } from '../lines/released.js';
import { standingOf, type Probe, type Unattributed } from './inputs.js';
import { NO_WITNESSES, type Witnesses } from './witnesses.js';

const reasonOf = (unknown: Unknown): UnprovenReason => {
  switch (unknown.reason) {
    case 'budget':
      return { kind: unknown.reason };
    case 'opaque':
      return { kind: 'opaque', side: unknown.side ?? 'projection', row: unknown.row ?? null, cause: unknown.cause };
    case 'unread':
      return { kind: 'unread', side: unknown.side, cause: unknown.cause };
    case 'alignment':
      return { kind: 'worker', cause: 'the fold state no longer matches its base' };
    case 'sequence':
      return { kind: 'worker', cause: `the fold expected row ${unknown.expected ?? 'none'} and met ${unknown.received ?? 'none'}` };
  }
};

const nobodyOf = (verdict: Proven, unattributed: Unattributed | null, witnesses: Witnesses): readonly Nobody[] => {
  const external: NobodyWhy = unattributed === null ? { kind: 'external' } : { kind: 'unattributed', ...unattributed };
  const { added, removed } = verdict.nobody;
  if (added + removed === 0) return verdict.existence === 'external' ? [{ added: 0, removed: 0, why: external }] : [];
  if (verdict.lines === 'unweighed' || (witnesses.released.length === 0 && witnesses.debts.length === 0))
    return [{ added, removed, why: external }];
  const released = releasedOf(verdict, witnesses.released);
  const owed = owedOf(verdict, witnesses.debts);
  const groups = new Map<string, { why: NobodyWhy; added: number; removed: number }>();
  for (const [index, line] of verdict.lines.entries()) {
    if (line.mark !== 'external') continue;
    const release = released.get(index);
    const commit = owed.get(index);
    const why: NobodyWhy =
      release !== undefined ? { kind: 'released', ...release } : commit !== undefined ? { kind: 'steps', commit } : external;
    const key = JSON.stringify(why);
    const group = groups.get(key) ?? { why, added: 0, removed: 0 };
    if (line.kind === 'added') group.added += 1;
    else group.removed += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map(({ why, added: plus, removed: minus }) => ({ added: plus, removed: minus, why }));
};

export const holdingOf = (probe: Probe, git: HoldingGit, verdict: Verdict, witnesses: Witnesses = NO_WITNESSES): Holding => {
  const base = { path: probe.path, from: probe.from, git };
  if (verdict.verdict === 'unknown')
    return {
      ...base,
      verdict: {
        verdict: 'unknown',
        reason: reasonOf(verdict),
        writers: [...new Set(verdict.writers.map((writer) => writer.holder))].map(holderAt),
      },
      lines: 'unweighed',
    };
  return {
    ...base,
    verdict: {
      verdict: 'proven',
      hands: verdict.hands.map((hand) => ({
        holder: holderAt(hand.holder),
        added: hand.added,
        removed: hand.removed,
        writing: false,
        retired: false,
      })),
      nobody: nobodyOf(verdict, probe.unattributed, witnesses),
    },
    lines: verdict.counts,
  };
};

export const unreadOf = (probe: Probe, git: HoldingGit, reason: UnprovenReason): Holding => ({
  path: probe.path,
  from: probe.from,
  git,
  verdict: { verdict: 'unknown', reason, writers: [...new Set(standingOf(probe.rows).map((row) => row.holder))].map(holderAt) },
  lines: 'unweighed',
});
