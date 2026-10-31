import {
  REVIEW_LENSES,
  type ReviewLens,
  type ReviewPolicy,
  type TeamEdit,
  type TeamModel,
  type TeamModelEdit,
  type TeamModelKey,
} from '@runlith/agent/collaboration/team';

export type RowCheck = 'on' | 'reviews';

export type Rating = 'open' | 'depth' | 'taste' | 'ui' | 'spend';

type RatingBase = { readonly value: number; readonly below: boolean };

export type RowField = Exclude<keyof TeamModelEdit, keyof TeamModelKey | 'removed'>;

export type RowFields = Partial<Pick<TeamModelEdit, RowField>>;

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

const standingFrom = (edits: readonly TeamEdit[], row: TeamModelKey): number =>
  edits.findLastIndex((one) => 'model' in one && sameRow(one, row) && one.removed === true) + 1;

export function withoutFields(edits: readonly TeamEdit[], row: TeamModelKey, fields: readonly RowField[]): readonly TeamEdit[] {
  const from = standingFrom(edits, row);
  return edits.map((one, index) =>
    index < from || !('model' in one) || !sameRow(one, row)
      ? one
      : (Object.fromEntries(Object.entries(one).filter(([field]) => !fields.includes(field as RowField))) as TeamModelEdit),
  );
}

export const withoutRow = (edits: readonly TeamEdit[], row: TeamModelKey): readonly TeamEdit[] =>
  edits.filter((one) => !('model' in one) || !sameRow(one, row));

export function rowEdit(edits: readonly TeamEdit[], row: TeamModelKey): TeamModelEdit | undefined {
  const standing = edits.slice(standingFrom(edits, row)).filter((one): one is TeamModelEdit => 'model' in one && sameRow(one, row));
  return standing.length === 0 ? undefined : Object.assign({}, ...standing);
}

export function rowChecked(edits: readonly TeamEdit[], row: TeamModelKey & Readonly<Record<RowCheck, boolean>>, check: RowCheck): boolean {
  const said = edits.findLast((one): one is TeamModelEdit => 'model' in one && sameRow(one, row) && one[check] !== undefined);
  return said?.[check] ?? row[check];
}

export function ratingBase(below: TeamModelEdit | undefined, row: TeamModel, field: Rating): RatingBase | null {
  const machine = below?.[field];
  if (machine !== undefined) return { value: machine, below: true };
  return row.shipped === null ? null : { value: row.shipped[field], below: false };
}

export const ratingEdited = (edit: TeamModelEdit | undefined, below: TeamModelEdit | undefined, row: TeamModel, field: Rating): boolean =>
  edit?.[field] !== undefined && ratingBase(below, row, field) !== null;

export function providerOn(edits: readonly TeamEdit[], provider: string, standing: boolean): boolean {
  const said = edits.findLast((one) => !('model' in one) && one.provider === provider);
  return said === undefined || 'model' in said ? standing : said.on;
}

export const editsRow = (edits: readonly TeamEdit[], row: TeamModelKey): boolean =>
  edits.some((one) => 'model' in one && sameRow(one, row));

export function withLens(policy: ReviewPolicy, lens: ReviewLens): ReviewPolicy {
  const lenses = policy.lenses.includes(lens)
    ? policy.lenses.filter((each) => each !== lens)
    : REVIEW_LENSES.filter((each) => each === lens || policy.lenses.includes(each));
  return { ...policy, lenses };
}
