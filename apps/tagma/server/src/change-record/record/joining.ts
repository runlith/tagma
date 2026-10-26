import { Effect } from 'effect';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { LineHunk } from '@runlith/files/hunk';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import type { IntakeFact } from '../contract/service/intake.js';
import type { WalkUnfinished, Walks } from '../lines/walks.js';
import { standing, workspaceChange } from '../store/tables.js';
import { versionTexts } from './evidence.js';
import type { StoreShape } from './places.js';
import { releaseVersions } from './versions.js';
import { putHunkText } from './hunks.js';

export type Joining = {
  readonly row: string;
  readonly into: string;
  readonly since: number;
  readonly place: PlacedPath;
  readonly before: string;
  readonly after: string;
  readonly hunk: LineHunk | null;
};

export type Written = { readonly id: string; readonly place: PlacedPath; readonly fact: IntakeFact };

export type Windowed = (checkout: string, since: number) => boolean;

const OPERATOR_KEY = holderKey(OPERATOR);

const BASES_KEPT = 8;

export class BaseTexts {
  private readonly kept = new Map<string, string>();

  read(
    units: MachineUnits['Service'],
    store: StoreShape,
    digests: readonly string[],
  ): Effect.Effect<ReadonlyMap<string, string>, StoreFailure> {
    const asked = digests.filter((digest) => !this.kept.has(digest));
    const known = (): ReadonlyMap<string, string> =>
      new Map(digests.flatMap((digest) => (this.kept.has(digest) ? [[digest, this.kept.get(digest) as string] as const] : [])));
    if (asked.length === 0) return Effect.sync(known);
    return Effect.map(versionTexts(units, store, asked), (read) => {
      for (const [digest, text] of read) {
        this.kept.delete(digest);
        this.kept.set(digest, text);
        if (this.kept.size > BASES_KEPT) this.kept.delete(this.kept.keys().next().value as string);
      }
      return known();
    });
  }
}

const joins = (fact: IntakeFact): boolean =>
  fact.origin !== 'delete' &&
  fact.movedFrom === undefined &&
  (fact.reverts?.length ?? 0) === 0 &&
  fact.before !== undefined &&
  fact.after !== undefined &&
  fact.afterText !== undefined;

const latestOther = (store: StoreShape, place: PlacedPath, row: string) =>
  store.db
    .select({
      id: workspaceChange.id,
      holder: workspaceChange.holder,
      state: workspaceChange.state,
      origin: workspaceChange.origin,
      movedFrom: workspaceChange.movedFrom,
      beforeHash: workspaceChange.beforeHash,
      afterHash: workspaceChange.afterHash,
      reverts: workspaceChange.reverts,
      at: workspaceChange.at,
    })
    .from(workspaceChange)
    .where(and(eq(workspaceChange.checkout, place.checkout), eq(workspaceChange.path, place.path), standing, ne(workspaceChange.id, row)))
    .orderBy(desc(workspaceChange.at), desc(workspaceChange.id))
    .limit(1);

type Target = { readonly written: Written; readonly into: string; readonly since: number; readonly base: string | null };

const targetOf = (
  units: MachineUnits['Service'],
  store: StoreShape,
  windowed: Windowed,
  written: Written,
): Effect.Effect<Target | null, StoreFailure> =>
  Effect.map(
    units.read((unit) => unit.run(latestOther(store, written.place, written.id))),
    (rows): Target | null => {
      const last = rows[0];
      if (
        last === undefined ||
        last.holder !== OPERATOR_KEY ||
        last.state !== 'held' ||
        last.origin === 'delete' ||
        last.movedFrom !== null ||
        (last.reverts?.length ?? 0) > 0 ||
        last.afterHash !== written.fact.before ||
        windowed(written.place.checkout, last.at.getTime())
      )
        return null;
      return { written, into: last.id, since: last.at.getTime(), base: last.beforeHash };
    },
  );

export const joinable = Effect.fnUntraced(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  walks: Walks,
  bases: BaseTexts,
  windowed: Windowed,
  written: readonly Written[],
): Effect.fn.Return<readonly Joining[], StoreFailure | WalkUnfinished> {
  const candidates = written.filter((one) => joins(one.fact));
  if (candidates.length === 0) return [];
  const targets = (yield* Effect.forEach(candidates, (one) => targetOf(units, store, windowed, one))).filter(
    (target): target is Target => target !== null,
  );
  if (targets.length === 0) return [];
  const digests = targets.flatMap((target) => (target.base === null ? [] : [target.base]));
  const texts = digests.length === 0 ? new Map<string, string>() : yield* bases.read(units, store, digests);
  const known = targets.filter((target) => target.base === null || texts.has(target.base));
  if (known.length === 0) return [];
  const hunks = yield* walks.hunks(
    known.map((target) => ({
      before: { text: target.base === null ? '' : (texts.get(target.base) as string) },
      after: { text: target.written.fact.afterText as string },
      normalized: false,
    })),
  );
  return known.flatMap((target, at): Joining[] => {
    const answer = hunks[at];
    const { fact } = target.written;
    if (answer === undefined || answer.afterDigest !== fact.after) return [];
    return [
      {
        row: target.written.id,
        into: target.into,
        since: target.since,
        place: target.written.place,
        before: fact.before as string,
        after: fact.after as string,
        hunk: answer.hunk,
      },
    ];
  });
});

export const joined = Effect.fnUntraced(function* (store: StoreShape, joining: Joining, mode: string | null) {
  const last = (yield* latestOther(store, joining.place, joining.row))[0];
  if (last === undefined || last.id !== joining.into || last.state !== 'held' || last.afterHash !== joining.before) return false;
  const hunk = joining.hunk;
  yield* store.db
    .update(workspaceChange)
    .set({
      afterHash: joining.after,
      mode,
      firstLine: hunk?.firstLine ?? null,
      lines: hunk?.newLines ?? null,
      oldLines: hunk?.oldLines ?? null,
      windowBefore: hunk?.windowBefore ?? null,
    })
    .where(and(eq(workspaceChange.id, joining.into), eq(workspaceChange.afterHash, joining.before)));
  yield* putHunkText(store.db, joining.into, hunk?.oldText ?? null, hunk?.newText ?? null);
  yield* store.db.delete(workspaceChange).where(eq(workspaceChange.id, joining.row));
  yield* releaseVersions(store.db, [joining.before]);
  return true;
});
