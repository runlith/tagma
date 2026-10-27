import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Deltas } from './deltas.ts';

export type Loaded = { readonly stamp: string; readonly lines: string };
export type Covered = {
  readonly run: string;
  readonly at: number;
  readonly closure: ReadonlySet<string>;
  readonly loaded: ReadonlyMap<string, Loaded>;
  readonly mains: readonly string[];
  readonly bundled: ReadonlySet<string>;
  readonly opaque: readonly string[];
};
type Encoded = {
  readonly run: string;
  readonly at: number;
  readonly closure: string;
  readonly bundled: string;
  readonly loaded: string;
  readonly lines: readonly number[];
  readonly mains: readonly string[];
  readonly opaque: readonly string[];
};
type Delta = {
  readonly paths: readonly string[];
  readonly sources: readonly (readonly [number, string])[];
  readonly variants: readonly string[];
  readonly tests: Readonly<Record<string, Encoded | null>>;
};
const COMPACT = 32;
const code = new Bun.Transpiler({ loader: 'ts', target: 'bun' });
const VERSION = createHash('sha256')
  .update(Bun.version)
  .update(
    [import.meta.path, join(import.meta.dir, 'map.ts'), join(import.meta.dir, 'testing/spawned.ts')]
      .map((path) => code.transformSync(readFileSync(path, 'utf8')))
      .join('\0'),
  )
  .digest('hex')
  .slice(0, 16);

const bits = (size: number, set: Iterable<number>): string => {
  const bytes = new Uint8Array(Math.ceil(size / 8));
  for (const at of set) bytes[at >> 3]! |= 1 << (at & 7);
  return Buffer.from(bytes).toString('base64');
};
const members = (encoded: string): number[] => {
  const bytes = Buffer.from(encoded, 'base64');
  const found: number[] = [];
  for (let at = 0; at < bytes.length * 8; at++) if ((bytes[at >> 3]! >> (at & 7)) & 1) found.push(at);
  return found;
};

export const rangesOf = (lines: Iterable<number>): string => {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let at = 0; at < sorted.length;) {
    let end = at;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) end++;
    parts.push(end === at ? String(sorted[at]) : `${sorted[at]}-${sorted[end]}`);
    at = end + 1;
  }
  return parts.join(',');
};

type Held = {
  readonly run: string;
  readonly at: number;
  readonly closure: Int32Array;
  readonly bundled: Int32Array;
  readonly loaded: Int32Array;
  readonly lines: Int32Array;
  readonly mains: readonly string[];
  readonly opaque: readonly string[];
};

export class Batch {
  private readonly paths: string[] = [];
  private readonly pathAt = new Map<string, number>();
  private readonly sources: (readonly [number, string])[] = [];
  private readonly sourceAt = new Map<string, number>();
  private readonly variants: string[] = [];
  private readonly variantAt = new Map<string, number>();
  private readonly tests = new Map<string, Held | null>();

  private intern(table: string[], at: Map<string, number>, value: string): number {
    let index = at.get(value);
    if (index === undefined) {
      index = table.push(value) - 1;
      at.set(value, index);
    }
    return index;
  }

  get size(): number {
    return this.tests.size;
  }

  add(test: string, covered: Covered | null): void {
    if (covered === null) {
      this.tests.set(test, null);
      return;
    }
    const path = (one: string): number => this.intern(this.paths, this.pathAt, one);
    const loaded = [...covered.loaded]
      .map(([one, { stamp, lines }]) => {
        const key = `${one}\0${stamp}`;
        let at = this.sourceAt.get(key);
        if (at === undefined) {
          at = this.sources.push([path(one), stamp]) - 1;
          this.sourceAt.set(key, at);
        }
        return [at, this.intern(this.variants, this.variantAt, lines)] as const;
      })
      .sort((a, b) => a[0] - b[0]);
    this.tests.set(test, {
      run: covered.run,
      at: covered.at,
      closure: Int32Array.from(covered.closure, path),
      bundled: Int32Array.from(covered.bundled, path),
      loaded: Int32Array.from(loaded, ([at]) => at),
      lines: Int32Array.from(loaded, ([, lines]) => lines),
      mains: covered.mains,
      opaque: covered.opaque,
    });
  }

  delta(): Delta {
    const tests: Record<string, Encoded | null> = {};
    for (const [test, held] of this.tests)
      tests[test] =
        held === null
          ? null
          : {
              run: held.run,
              at: held.at,
              closure: bits(this.paths.length, held.closure),
              bundled: bits(this.paths.length, held.bundled),
              loaded: bits(this.sources.length, held.loaded),
              lines: [...held.lines],
              mains: held.mains,
              opaque: held.opaque,
            };
    return { paths: this.paths, sources: this.sources, variants: this.variants, tests };
  }
}

const decode = (delta: Delta, encoded: Encoded): Covered => {
  const loaded = new Map<string, Loaded>();
  members(encoded.loaded).forEach((at, index) => {
    const [path, stamp] = delta.sources[at]!;
    loaded.set(delta.paths[path]!, { stamp, lines: delta.variants[encoded.lines[index]!]! });
  });
  return {
    run: encoded.run,
    at: encoded.at,
    closure: new Set(members(encoded.closure).map((at) => delta.paths[at]!)),
    loaded,
    mains: encoded.mains,
    bundled: new Set(members(encoded.bundled).map((at) => delta.paths[at]!)),
    opaque: encoded.opaque,
  };
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export class Coverage {
  private readonly latest = new Map<string, { readonly delta: Delta; readonly encoded: Encoded } | null>();
  private readonly decoded = new Map<string, Covered | undefined>();
  private readonly texts = new Map<string, string | undefined>();
  private readonly directory: string;
  private readonly deltas: Deltas<Delta>;

  constructor(cache: string) {
    this.directory = join(cache, `map-${VERSION}`);
    this.deltas = new Deltas(this.directory);
    mkdirSync(join(this.directory, 'texts'), { recursive: true });
    mkdirSync(join(this.directory, 'leases'), { recursive: true });
    const { names, deltas } = this.deltas.read();
    for (const delta of deltas)
      for (const [test, encoded] of Object.entries(delta.tests)) this.latest.set(test, encoded === null ? null : { delta, encoded });
    if (names.length <= COMPACT) return;
    const live = new Batch();
    const kept = new Set<string>();
    for (const test of this.latest.keys()) {
      const covered = this.of(test);
      if (covered === undefined) continue;
      live.add(test, covered);
      for (const { stamp } of covered.loaded.values()) kept.add(stamp);
      this.decoded.delete(test);
    }
    this.deltas.replace(names, live.delta());
    const leases = readdirSync(join(this.directory, 'leases'));
    for (const lease of leases.filter((name) => !alive(Number(name.split('-')[0]))))
      rmSync(join(this.directory, 'leases', lease), { force: true });
    if (leases.some((name) => alive(Number(name.split('-')[0])))) return;
    for (const name of readdirSync(join(this.directory, 'texts')))
      if (!kept.has(name) && !name.includes('.')) rmSync(join(this.directory, 'texts', name), { force: true });
  }

  lease(): () => void {
    const path = join(this.directory, 'leases', `${process.pid}-${randomUUID()}`);
    writeFileSync(path, '');
    return () => rmSync(path, { force: true });
  }

  of(test: string): Covered | undefined {
    if (this.decoded.has(test)) return this.decoded.get(test);
    const held = this.latest.get(test);
    const covered = held === undefined || held === null ? undefined : decode(held.delta, held.encoded);
    this.decoded.set(test, covered);
    return covered;
  }

  text(stamp: string): string | undefined {
    if (this.texts.has(stamp)) return this.texts.get(stamp);
    const path = join(this.directory, 'texts', stamp);
    const text = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    this.texts.set(stamp, text);
    return text;
  }

  keep(stamp: string, text: string): void {
    if (this.texts.get(stamp) !== undefined) return;
    const path = join(this.directory, 'texts', stamp);
    if (!existsSync(path)) {
      const staged = `${path}.${process.pid}.${randomUUID()}`;
      writeFileSync(staged, text);
      renameSync(staged, path);
    }
    this.texts.set(stamp, text);
  }

  record(batch: Batch): void {
    if (batch.size === 0) return;
    const delta = batch.delta();
    this.deltas.write(delta);
    for (const [test, encoded] of Object.entries(delta.tests)) {
      this.decoded.delete(test);
      this.latest.set(test, encoded === null ? null : { delta, encoded });
    }
  }
}
