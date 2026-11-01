import type { Holding, HoldingGit, Nobody, UnprovenReason } from '../contract/wire/holdings.js';
import { holderAt } from '../../workspace/contract/wire/checkout.js';
import type { Unknown } from '../lines/folding.js';
import type { Verdict } from '../lines/projection.js';
import { standingOf, type Probe } from './inputs.js';

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

export const holdingOf = (probe: Probe, git: HoldingGit, verdict: Verdict, nobody: readonly Nobody[]): Holding => {
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
      nobody,
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
