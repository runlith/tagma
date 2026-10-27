import { Context } from 'effect';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import { and, eq, gte, inArray, lt, or } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { among } from '../../platform/store/rows.js';
import { unique } from '@runlith/utils/collection';

export type StoreShape = Context.Service.Shape<typeof MachineStore>;

type PlaceColumns = {
  readonly checkout: SQLiteColumn;
  readonly path: SQLiteColumn;
};

export function samePlace(on: PlaceColumns, place: PlacedPath) {
  return and(eq(on.checkout, place.checkout), eq(on.path, place.path));
}

const below = (column: SQLiteColumn, prefix: string) =>
  prefix === '.' || prefix === '' ? undefined : and(gte(column, `${prefix}/`), lt(column, `${prefix}0`));

export function within(on: PlaceColumns, place: PlacedPath) {
  const under = below(on.path, place.path);
  return and(eq(on.checkout, place.checkout), under === undefined ? undefined : or(eq(on.path, place.path), under));
}

export const PLACES_PER_STATEMENT = rowsPerStatement(2);

export function samePlaces(on: PlaceColumns, places: readonly PlacedPath[]) {
  const byCheckout = new Map<string, string[]>();
  for (const place of places) {
    const paths = byCheckout.get(place.checkout);
    if (paths === undefined) byCheckout.set(place.checkout, [place.path]);
    else paths.push(place.path);
  }
  if (byCheckout.size === 0) return eq(on.checkout, '');
  return or(...[...byCheckout].map(([checkout, paths]) => and(eq(on.checkout, checkout), inArray(on.path, among(unique(paths))))));
}

export const placeKey = (place: PlacedPath): string => `${place.checkout}\0${place.path}`;
