export type SnapshotCut = {
  readonly pending: readonly { readonly name: string; readonly hash: string }[];
  readonly source: string;
};

export const reusableCut = (before: SnapshotCut, after: SnapshotCut): boolean =>
  after.pending.length > 0 &&
  before.source === after.source &&
  before.pending.length === after.pending.length &&
  before.pending.every((step, index) => step.name === after.pending[index]?.name && step.hash === after.pending[index]?.hash);

export const snapshotRetention = (
  completed: string | undefined,
  boot: string,
  applied: boolean,
  admitted: boolean,
): 'keep' | 'complete' | 'queue' | 'release' =>
  !applied ? 'keep' : completed === undefined ? 'complete' : completed === boot ? 'keep' : admitted ? 'release' : 'queue';
