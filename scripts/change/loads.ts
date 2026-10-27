import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Deltas } from './deltas.ts';

export type Load = { readonly type: 'load'; readonly file: string; readonly importer: string; readonly target: string };
type Delta = {
  readonly importers: readonly { readonly importer: string; readonly stamp: string; readonly targets: readonly string[] }[];
  readonly tests: Readonly<Record<string, Readonly<Record<string, string>> | null>>;
};
const COMPACT = 64;
const VERSION = createHash('sha256')
  .update(readFileSync(import.meta.path))
  .update(readFileSync(join(import.meta.dir, 'testing/trace.ts')))
  .digest('hex')
  .slice(0, 16);

export class Loads {
  private readonly targetsOf = new Map<string, Set<string>>();
  private readonly marks = new Map<string, Readonly<Record<string, string>>>();
  private readonly deltas: Deltas<Delta> | undefined;

  constructor(cache?: string) {
    this.deltas = cache === undefined ? undefined : new Deltas(join(cache, `loads-${VERSION}`));
    if (this.deltas === undefined) return;
    const { names, deltas } = this.deltas.read();
    for (const delta of deltas) this.fold(delta);
    if (names.length > COMPACT) this.deltas.replace(names, this.snapshot());
  }

  private fold(delta: Delta): void {
    for (const { importer, stamp, targets } of delta.importers) {
      const key = `${importer}\0${stamp}`;
      const held = this.targetsOf.get(key) ?? new Set();
      for (const target of targets) held.add(target);
      this.targetsOf.set(key, held);
    }
    for (const [test, marks] of Object.entries(delta.tests))
      if (marks === null) this.marks.delete(test);
      else this.marks.set(test, marks);
  }

  private snapshot(): Delta {
    return {
      importers: [...this.targetsOf].map(([key, targets]) => {
        const [importer, stamp] = key.split('\0') as [string, string];
        return { importer, stamp, targets: [...targets].sort() };
      }),
      tests: Object.fromEntries(this.marks),
    };
  }

  targets(importer: string, stamp: string): readonly string[] {
    return [...(this.targetsOf.get(`${importer}\0${stamp}`) ?? [])];
  }

  covers(test: string, importer: string, stamp: string): boolean {
    return this.marks.get(test)?.[importer] === stamp && this.targetsOf.has(`${importer}\0${stamp}`);
  }

  record(
    loads: readonly Load[],
    traced: ReadonlyMap<string, Readonly<Record<string, string>>>,
    cleared: readonly string[],
    stamp: (path: string) => string,
  ): void {
    const importers = new Set([...loads.map((load) => load.importer), ...[...traced.values()].flatMap((marks) => Object.keys(marks))]);
    const delta: Delta = {
      importers: [...importers].sort().map((importer) => ({
        importer,
        stamp: stamp(importer),
        targets: [...new Set(loads.filter((load) => load.importer === importer).map((load) => load.target))].sort(),
      })),
      tests: Object.fromEntries([...cleared.map((test) => [test, null] as const), ...traced]),
    };
    this.fold(delta);
    this.deltas?.write(delta);
  }
}
