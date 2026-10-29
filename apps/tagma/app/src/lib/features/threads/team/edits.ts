import {
  REVIEW_LENSES,
  type ReviewLens,
  type ReviewPolicy,
  type TeamEdit,
  type TeamModelEdit,
  type TeamModelKey,
} from '@runlith/agent/collaboration/team';

export const sameRow = (left: TeamModelKey, right: TeamModelKey): boolean =>
  left.provider === right.provider && left.model === right.model && left.reasoning === right.reasoning;

export const rowKey = (row: TeamModelKey): string => JSON.stringify([row.provider, row.model, row.reasoning]);

export function withEdit(edits: readonly TeamEdit[], edit: TeamEdit): readonly TeamEdit[] {
  if (!('model' in edit)) return [...edits.filter((one) => 'model' in one || one.provider !== edit.provider), edit];
  const at = edits.findLastIndex((one) => 'model' in one && sameRow(one, edit));
  const last = at === -1 ? undefined : (edits[at] as TeamModelEdit);
  if (last === undefined || last.removed === true || edit.removed === true) return [...edits, edit];
  return edits.map((one, index) => (index === at ? { ...last, ...edit } : one));
}

export const withoutRow = (edits: readonly TeamEdit[], row: TeamModelKey): readonly TeamEdit[] =>
  edits.filter((one) => !('model' in one) || !sameRow(one, row));

export function rowOn(edits: readonly TeamEdit[], row: TeamModelKey & { readonly on: boolean }): boolean {
  const said = edits.findLast((one): one is TeamModelEdit => 'model' in one && sameRow(one, row) && one.on !== undefined);
  return said?.on ?? row.on;
}

export function providerOn(edits: readonly TeamEdit[], provider: string, standing: boolean): boolean {
  const said = edits.findLast((one) => !('model' in one) && one.provider === provider);
  return said === undefined || 'model' in said ? standing : said.on;
}

export const editsRow = (edits: readonly TeamEdit[], row: TeamModelKey): boolean =>
  edits.some((one) => 'model' in one && sameRow(one, row));

export const pooled = (policy: ReviewPolicy, row: TeamModelKey): boolean => policy.pool.some((key) => sameRow(key, row));

export const poolRows = <Row extends TeamModelKey>(policy: ReviewPolicy, rows: readonly Row[]): readonly Row[] =>
  policy.pool.flatMap((key) => rows.filter((row) => sameRow(row, key)));

export function withPooled(policy: ReviewPolicy, row: TeamModelKey): ReviewPolicy {
  return withPool(policy, [row], !pooled(policy, row));
}

export function withPool(policy: ReviewPolicy, rows: readonly TeamModelKey[], on: boolean): ReviewPolicy {
  const keys = rows.map(({ provider, model, reasoning }) => ({ provider, model, reasoning }));
  if (on) return { ...policy, pool: [...policy.pool, ...keys.filter((key) => !pooled(policy, key))] };
  return { ...policy, pool: policy.pool.filter((one) => !keys.some((key) => sameRow(key, one))) };
}

export function withLens(policy: ReviewPolicy, lens: ReviewLens): ReviewPolicy {
  const lenses = policy.lenses.includes(lens)
    ? policy.lenses.filter((each) => each !== lens)
    : REVIEW_LENSES.filter((each) => each === lens || policy.lenses.includes(each));
  return { ...policy, lenses };
}
