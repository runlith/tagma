import type { LineMarker, LineRange, Mark, Strip } from './marks';

const sameList = <T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean =>
  a === b || (a.length === b.length && a.every((item, at) => same(item, b[at] as T)));

export const sameMark = (a: Mark | null, b: Mark | null): boolean =>
  a === b || (a !== null && b !== null && a.id === b.id && a.label === b.label && a.colour === b.colour);

export const sameStrips = (a: readonly Strip[], b: readonly Strip[]): boolean =>
  sameList(a, b, (x, y) => x.from === y.from && x.to === y.to && x.kind === y.kind && sameMark(x.mark, y.mark));

export const sameMarkers = (a: readonly LineMarker[], b: readonly LineMarker[]): boolean =>
  sameList(a, b, (x, y) => x.line === y.line && x.label === y.label && x.colour === y.colour);

export const sameConflicts = (a: readonly LineRange[], b: readonly LineRange[]): boolean =>
  sameList(a, b, (x, y) => x.from === y.from && x.to === y.to);
