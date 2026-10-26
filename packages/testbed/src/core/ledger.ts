import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { CHILD_KINDS, type ByKind } from './children.ts';
import type { Kind } from './files.ts';
import { pristine } from './pristine.ts';

export type Item = 'world' | 'tenant';
export type Cost = { cpu: number; wall: number };
export type Meter = { readonly wall: number; readonly own: number; readonly kids: number };

type Fs = typeof import('node:fs');

const none = (): Cost => ({ cpu: 0, wall: 0 });
const round = (value: number): number => Math.round(value * 10) / 10;
const rounded = (cost: Cost): Cost => ({ cpu: round(cost.cpu), wall: round(cost.wall) });
const between = (from: Meter, to: Meter): Cost => ({ cpu: to.own - from.own + (to.kids - from.kids), wall: to.wall - from.wall });
const add = (into: Cost, cost: Cost): void => {
  into.cpu += cost.cpu;
  into.wall += cost.wall;
};
const minus = (left: Cost, ...right: Cost[]): Cost => ({
  cpu: right.reduce((value, cost) => value - cost.cpu, left.cpu),
  wall: right.reduce((value, cost) => value - cost.wall, left.wall),
});

export type FileRow = {
  readonly type: 'file';
  readonly run: string;
  readonly runner: 'bun' | 'vitest';
  readonly worker: number;
  readonly seq: number;
  readonly file: string;
  readonly kind: Kind;
  readonly tests: number;
  readonly load: Cost;
  readonly world: Cost;
  readonly tenant: Cost;
  readonly body: Cost;
  readonly guard: Cost;
  readonly total: Cost;
  readonly children: ByKind<Spawned>;
  readonly residue: number;
};

export type Spawned = { readonly count: number; readonly cpu: number; readonly unmeasured: number };

export type TestRow = {
  readonly type: 'test';
  readonly run: string;
  readonly worker: number;
  readonly file: string;
  readonly test: number;
  readonly name?: string;
  readonly outcome?: string;
  readonly body: Cost;
  readonly tenant: Cost;
  readonly world: Cost;
};

export type RefusalRow = {
  readonly type: 'refusal';
  readonly run: string;
  readonly file: string;
  readonly resource: string;
  readonly via: string;
  readonly loading: boolean;
  readonly site: string | undefined;
  readonly message: string;
};

export type WorldRow = {
  readonly type: 'world';
  readonly run: string;
  readonly worker: number;
  readonly file: string;
  readonly kind: string;
  readonly key: string;
  readonly built: boolean;
  readonly own: string | null;
  readonly cost: Cost;
};

export type WorldTaken = Pick<WorldRow, 'kind' | 'key' | 'built' | 'own' | 'cost'>;

export type Row = FileRow | TestRow | RefusalRow | WorldRow | Readonly<Record<string, unknown> & { type: string }>;

type Span = { readonly item: Item; readonly start: Meter; inner: Cost };

type Open = {
  readonly file: string;
  readonly kind: Kind;
  readonly start: Meter;
  readonly seq: number;
  readonly skip: Cost;
  ready: Meter | undefined;
  readonly guardLoad: Cost;
  readonly guardPhase: Cost;
  readonly tenantIn: Cost;
  readonly tenantOut: Cost;
  readonly worldIn: Cost;
  readonly body: Cost;
  readonly tests: Cost;
  count: number;
  test: { readonly start: Meter; readonly tenant: Cost; readonly world: Cost } | undefined;
  readonly kids: ByKind<number>;
};

export type LedgerOptions = {
  readonly runner: 'bun' | 'vitest';
  readonly run: () => { readonly root: string; readonly report: string };
  readonly repo: string;
  readonly kids: () => ByKind<number>;
};

export const makeLedger = (options: LedgerOptions) => {
  const files = createRequire(import.meta.url)('node:fs') as Fs;
  const append = pristine(files.appendFileSync);
  const kidsTotal = (): number => {
    const kids = options.kids();
    return kids.sqlite + kids.git + kids.other;
  };
  const meter = (): Meter => {
    const usage = process.cpuUsage();
    return { wall: Number(process.hrtime.bigint()) / 1e6, own: (usage.user + usage.system) / 1000, kids: kidsTotal() };
  };
  const rows: (() => Row)[] = [];
  const spans: Span[] = [];
  let open: Open | undefined;

  const push = (row: Row | (() => Row)): void => {
    rows.push(typeof row === 'function' ? row : () => row);
  };

  return {
    meter,
    get file(): string | undefined {
      return open?.file;
    },
    get testing(): boolean {
      return open?.test !== undefined;
    },
    open(file: string, kind: Kind, start: Meter, seq: number, skip: Cost = none()): void {
      open = {
        file,
        kind,
        start,
        seq,
        skip,
        ready: undefined,
        guardLoad: none(),
        guardPhase: none(),
        tenantIn: none(),
        tenantOut: none(),
        worldIn: none(),
        body: none(),
        tests: none(),
        count: 0,
        test: undefined,
        kids: { ...options.kids() },
      };
    },
    ready(at: Meter = meter()): void {
      if (open !== undefined && open.ready === undefined) open.ready = at;
    },
    since(): Meter | undefined {
      return open === undefined ? undefined : (open.ready ?? open.start);
    },
    guard(cost: Cost): void {
      if (open !== undefined) add(open.ready === undefined ? open.guardLoad : open.guardPhase, cost);
    },
    span(item: Item): () => void {
      const span: Span = { item, start: meter(), inner: none() };
      spans.push(span);
      return () => {
        const at = spans.lastIndexOf(span);
        if (at === -1) return;
        spans.splice(at, 1);
        const whole = between(span.start, meter());
        const cost = minus(whole, span.inner);
        const parent = spans[at - 1];
        if (parent !== undefined) add(parent.inner, whole);
        if (open === undefined) return;
        if (open.test !== undefined) add(item === 'tenant' ? open.test.tenant : open.test.world, cost);
        else if (item === 'tenant') add(open.tenantOut, cost);
      };
    },
    testStart(): void {
      if (open !== undefined) open.test = { start: meter(), tenant: none(), world: none() };
    },
    testEnd(name: string | undefined, outcome: () => string | undefined): void {
      const current = open?.test;
      if (open === undefined || current === undefined) return;
      open.test = undefined;
      const whole = between(current.start, meter());
      const body = minus(whole, current.tenant, current.world);
      open.count += 1;
      add(open.tests, whole);
      add(open.tenantIn, current.tenant);
      add(open.worldIn, current.world);
      add(open.body, body);
      const row = {
        type: 'test' as const,
        run: options.run().root,
        worker: process.pid,
        file: relative(options.repo, open.file),
        test: open.count,
        body: rounded(body),
        tenant: rounded(current.tenant),
        world: rounded(current.world),
      };
      push((): TestRow => {
        const settled = outcome();
        return { ...row, ...(name === undefined ? {} : { name }), ...(settled === undefined ? {} : { outcome: settled }) };
      });
    },
    refusal(row: Omit<RefusalRow, 'type' | 'run'>): void {
      push({ type: 'refusal', run: options.run().root, ...row, file: relative(options.repo, row.file) });
    },
    world(taken: WorldTaken): void {
      push({
        type: 'world',
        run: options.run().root,
        worker: process.pid,
        file: open === undefined ? '' : relative(options.repo, open.file),
        ...taken,
        cost: rounded(taken.cost),
      });
    },
    close(closing: Meter, resumed: Meter, end: Meter, residue: number, counts: ByKind<{ count: number; unmeasured: number }>): void {
      if (open === undefined) return;
      const file = open;
      open = undefined;
      const ready = file.ready ?? file.start;
      const guard = between(resumed, end);
      const total = minus(between(file.start, closing), file.skip);
      add(total, guard);
      const load = minus(between(file.start, ready), file.guardLoad, file.skip);
      const world = minus(between(ready, closing), file.tests, file.guardPhase, file.tenantOut);
      add(world, file.worldIn);
      const tenant = { ...file.tenantIn };
      add(tenant, file.tenantOut);
      add(guard, file.guardLoad);
      add(guard, file.guardPhase);
      const kids = options.kids();
      const children = Object.fromEntries(
        CHILD_KINDS.map((kind) => [kind, { ...counts[kind], cpu: round(kids[kind] - file.kids[kind]) }]),
      ) as ByKind<Spawned>;
      push({
        type: 'file',
        run: options.run().root,
        runner: options.runner,
        worker: process.pid,
        seq: file.seq,
        file: relative(options.repo, file.file),
        kind: file.kind,
        tests: file.count,
        load: rounded(load),
        world: rounded(world),
        tenant: rounded(tenant),
        body: rounded(file.body),
        guard: rounded(guard),
        total: rounded(total),
        children,
        residue,
      });
    },
    flush(): void {
      if (rows.length === 0) return;
      append(
        options.run().report,
        `${rows
          .splice(0)
          .map((row) => JSON.stringify(row()))
          .join('\n')}\n`,
      );
    },
  };
};

export type Ledger = ReturnType<typeof makeLedger>;
