import { AsyncLocalStorage } from 'node:async_hooks';
import { join, relative } from 'node:path';
import { kindOf, type Kind } from './files.ts';
import { installGuards, type GuardHooks, type Reach } from './guards.ts';
import { makeLedger, type Item, type Meter, type NotRunReason, type WorldTaken } from './ledger.ts';
import { pristine } from './pristine.ts';
import type { Processes } from './processes.ts';
import { NetworkReached, Refused, siteOf } from './refusal.ts';
import { confine, fs, type Confined, type Run } from './run.ts';
import { makeWatch, type Hold, type Origin } from './watch.ts';

const KEY = Symbol.for('runlith.testbed');
const SKIP = ['/packages/testbed/src/'];

export type Continuity = { readonly seq: number; readonly end: { readonly wall: number; readonly own: number } | undefined };

export type ContinuityStore = { readonly get: () => Continuity; readonly put: (next: Continuity) => void };

export type BedOptions = {
  readonly runner: 'bun' | 'vitest';
  readonly repo: string;
  readonly file: () => string;
  readonly refusing: boolean;
  readonly expose: GuardHooks['expose'];
  readonly exempt?: (stack: string | undefined) => boolean;
};

const between = (from: Meter, to: Meter) => ({ cpu: to.own - from.own + (to.kids - from.kids), wall: to.wall - from.wall });

const memoryContinuity = (): ContinuityStore => {
  let held: Continuity = { seq: 0, end: undefined };
  return { get: () => held, put: (next) => (held = next) };
};

export const makeBed = (options: BedOptions) => {
  let processes: Processes | undefined;
  let run: Run | undefined;
  let continuity = memoryContinuity();
  let current: { readonly file: string; readonly kind: Kind; readonly confined: Confined; ready: boolean } | undefined;
  let pending: { readonly from: Meter; readonly to: Meter } | undefined;
  let last: Meter | undefined;
  const lingering: string[] = [];
  const seen = new Set<string>();
  const origin = new AsyncLocalStorage<Origin>();
  const author = (): Origin => origin.getStore() ?? { file: options.file(), world: false };
  const watch = makeWatch({
    processes: () => processes,
    file: options.file,
    author,
    site: (stack) => siteOf(stack, SKIP),
    cwd: options.repo,
  });
  const ledger = makeLedger({
    runner: options.runner,
    repo: options.repo,
    run: () => run ?? { root: '', report: '' },
    kids: () => watch.children.cpu(),
  });

  const reach: GuardHooks['reach'] = (found: Reach, via) => {
    const { file } = author();
    if (kindOf(file) === 'unit' && !(options.exempt?.(new Error().stack) ?? false)) {
      const name = relative(options.repo, file);
      const refusal = new Refused(name, found.resource, via);
      const loading = file === options.file() && (current?.file !== file || !current.ready);
      const key = `${name}\0${found.resource}\0${loading}`;
      if (!seen.has(key)) {
        seen.add(key);
        ledger.refusal({ file, resource: found.resource, via, loading, site: siteOf(refusal.stack, SKIP), message: refusal.reason });
      }
      if (options.refusing) throw refusal;
    }
    if (found.external !== undefined) throw new NetworkReached(found.external);
  };

  return {
    watch,
    ledger,
    get run(): Run | undefined {
      return run;
    },
    get processes(): Processes | undefined {
      return processes;
    },
    get file(): string | undefined {
      return current?.file;
    },
    get lastTest(): Meter | undefined {
      return last;
    },
    useRun(next: Run, store?: ContinuityStore): void {
      run = next;
      if (store !== undefined) continuity = store;
    },
    useProcesses(next: Processes): void {
      processes = next;
    },
    install(): void {
      installGuards({ reach, process: watch.process, expose: options.expose });
    },
    within: <T>(file: string, work: () => T): T => origin.run({ file, world: false }, work),
    building: <T>(work: () => T): T => origin.run({ file: author().file, world: true }, work),
    pend(from: Meter, to: Meter): void {
      pending = { from, to };
    },
    enter(file: string, start?: Meter, skip?: { readonly cpu: number; readonly wall: number }): void {
      const now = ledger.meter();
      const before = continuity.get();
      const from = start ?? (before.end !== undefined ? { ...before.end, kids: now.kids } : (pending?.from ?? now));
      ledger.open(file, kindOf(file), from, before.seq + 1, skip === undefined ? undefined : { ...skip });
      if (pending !== undefined) {
        ledger.guard(between(pending.from, pending.to));
        pending = undefined;
      }
      watch.begin();
      last = undefined;
      current = { file, kind: kindOf(file), confined: confine(), ready: false };
      ledger.guard(between(now, ledger.meter()));
    },
    ready(): void {
      if (current === undefined || current.ready) return;
      current.ready = true;
      ledger.ready();
    },
    testStart(): void {
      ledger.testStart();
    },
    testEnd(name?: string, outcome: () => string | undefined = () => undefined): void {
      ledger.testEnd(name, outcome);
      current?.confined.seen();
      last = ledger.meter();
    },
    async leave(closingAt?: Meter, resumedAt?: Meter): Promise<string | undefined> {
      const leaving = current;
      if (leaving === undefined) return undefined;
      const closing = closingAt ?? ledger.meter();
      const resumed = resumedAt ?? closing;
      const counts = watch.spawnedCount();
      const residue = await watch.verdict(leaving.confined.token, leaving.confined.root, leaving.file);
      const before = lingering.splice(0);
      const left = leaving.confined.retire();
      for (const root of before) pristine(fs().rmSync)(root, { recursive: true, force: true });
      if (left !== undefined) lingering.push(left);
      current = undefined;
      watch.children.settle();
      const end = ledger.meter();
      ledger.close(closing, resumed, end, residue?.count ?? 0, counts);
      ledger.flush();
      continuity.put({ seq: continuity.get().seq + 1, end: { wall: end.wall, own: end.own } });
      return residue?.message;
    },
    span: (item: Item): (() => void) => ledger.span(item),
    hold: (child: Parameters<typeof watch.hold>[0], hold?: Hold): void => watch.hold(child, hold),
    holding: (): (() => void) => watch.holding(),
    claim: (home: string): (() => void) => watch.claim(home),
    release: (pid: number): void => watch.release(pid),
    world: (taken: WorldTaken): void => ledger.world(taken),
    notRun(name: string, reason: NotRunReason): void {
      ledger.notRun(options.file(), name, reason);
      ledger.flush();
    },
  };
};

export type Bed = ReturnType<typeof makeBed>;

export const carried = (): Bed | undefined => (globalThis as unknown as Record<symbol, Bed | undefined>)[KEY];

export const carry = (bed: Bed): Bed => {
  (globalThis as unknown as Record<symbol, Bed>)[KEY] = bed;
  return bed;
};

export const diskContinuity = (root: string): ContinuityStore => {
  const files = fs();
  const path = join(root, `w.${process.pid}.json`);
  return {
    get: () => {
      try {
        return JSON.parse(files.readFileSync(path, 'utf8')) as Continuity;
      } catch {
        return { seq: 0, end: undefined };
      }
    },
    put: (next) => pristine(files.writeFileSync)(path, JSON.stringify(next)),
  };
};
