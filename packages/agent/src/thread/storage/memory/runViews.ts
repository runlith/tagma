import type { ThreadRunRow } from '../../rows';
import type { ThreadSettledPosition } from '../runs';
import type { HeldRun } from './state';

export function newestSettled(
  left: { readonly finishedAt: Date | null; readonly id: string },
  right: ThreadSettledPosition | HeldRun,
): number {
  return (right.finishedAt?.getTime() ?? 0) - (left.finishedAt?.getTime() ?? 0) || right.id.localeCompare(left.id);
}

export function viewOf(run: HeldRun): ThreadRunRow {
  const { startKey: _k, startDigest: _d, endDigest: _e, endResult: _r, appliedSeq: _a, receipt: _t, ...row } = run;
  return row;
}
