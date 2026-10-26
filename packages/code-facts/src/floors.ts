import type { ImportEdge } from './imports';

export type Floors = readonly (readonly string[])[];

export type Siblings = 'cross' | 'allow';

export type FloorCrossing = {
  readonly from: string;
  readonly to: string;
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
};

type Entry = { readonly entry: string; readonly floor: number; readonly at: string };

export function floorCrossings(edges: readonly ImportEdge[], floors: Floors, siblings: Siblings): FloorCrossing[] {
  const entries = floors
    .flatMap((floor, index) => floor.map((entry) => ({ entry, floor: index, at: entry.replace(/\/$/, '') })))
    .sort((left, right) => right.at.length - left.at.length);
  const crossings: FloorCrossing[] = [];
  for (const edge of edges) {
    const from = standsOn(edge.file, entries);
    if (from === undefined) continue;
    const to = standsOn(edge.to, entries);
    if (to === undefined || to.entry === from.entry || from.floor > to.floor) continue;
    if (from.floor === to.floor && siblings === 'allow') continue;
    crossings.push({ from: from.entry, to: to.entry, file: edge.file, line: edge.line, specifier: edge.specifier });
  }
  return crossings;
}

function standsOn(path: string, entries: readonly Entry[]): Entry | undefined {
  return entries.find(({ at }) => path === at || path.startsWith(`${at}/`));
}
