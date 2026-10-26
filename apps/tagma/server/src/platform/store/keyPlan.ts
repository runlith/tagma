import { schemaStatement, type StatementWrite } from './statementTarget.js';

export type ForeignKey = {
  readonly child: string;
  readonly parent: string;
  readonly id: number;
  readonly from: readonly string[];
  readonly to: readonly string[];
};

export type KeyChange = { readonly parent: string; readonly to: readonly string[]; readonly removed: number | 'unread' };

export type AddedColumn = { readonly table: string; readonly column: string };
export type KeyPlan = {
  readonly full: readonly string[];
  readonly checks: readonly ForeignKey[];
  readonly defaults: readonly ForeignKey[];
  readonly probes: readonly ForeignKey[];
};

export type KeyReach = {
  readonly existed: ReadonlySet<string>;
  readonly touched: ReadonlySet<string>;
  readonly written: readonly StatementWrite[];
  readonly rekeyed: ReadonlyMap<string, ReadonlySet<number>>;
  readonly restored: ReadonlySet<string>;
  readonly added: readonly AddedColumn[];
  readonly moved: number;
  readonly keys: readonly ForeignKey[];
};

export type KeyPlanInput = KeyReach & { readonly changes: readonly KeyChange[] };

export const keySetName = (parent: string, to: readonly string[]): string =>
  `${parent.toLowerCase()}(${to.map((column) => column.toLowerCase()).join(',')})`;

const lower = (names: ReadonlySet<string>) => new Set([...names].map((name) => name.toLowerCase()));

const intersects = (write: StatementWrite, columns: readonly string[]): boolean =>
  write.columns === 'all' || columns.some((column) => write.columns !== 'all' && write.columns.has(column.toLowerCase()));

export const removesKey = (write: StatementWrite, key: ForeignKey): boolean =>
  write.table === key.parent.toLowerCase() &&
  (write.verb === 'delete' || write.replacing || ((write.verb === 'update' || write.updating === true) && intersects(write, key.to)));

const writesKey = (write: StatementWrite, key: ForeignKey): boolean =>
  write.table === key.child.toLowerCase() &&
  (write.verb === 'insert' || write.replacing || (write.verb === 'update' && intersects(write, key.from)));

export const keyPlan = (input: KeyPlanInput): KeyPlan => {
  const touched = lower(input.touched);
  const existed = lower(input.existed);
  const written = new Map<string, StatementWrite[]>();
  if (input.moved > 0)
    for (const write of input.written) {
      const listed = written.get(write.table) ?? [];
      listed.push(write);
      written.set(write.table, listed);
    }
  const changes = new Map(input.changes.map((change) => [keySetName(change.parent, change.to), change.removed] as const));
  const captured = new Set(input.changes.map((change) => change.parent.toLowerCase()));
  const full = lower(input.restored);
  const checks: ForeignKey[] = [];
  const defaults: ForeignKey[] = [];
  const probes: ForeignKey[] = [];
  for (const key of input.keys) {
    const child = key.child.toLowerCase();
    const parent = key.parent.toLowerCase();
    if (full.has(child)) continue;
    if ((written.get(child) ?? []).some((write) => writesKey(write, key))) {
      checks.push(key);
      continue;
    }
    if (input.rekeyed.get(child)?.has(key.id)) {
      if (key.from.length === 1 && input.added.some((added) => added.table === child && added.column === key.from[0]!.toLowerCase()))
        defaults.push(key);
      else checks.push(key);
      continue;
    }
    const removed = changes.get(keySetName(parent, key.to));
    if (removed === 'unread') {
      if (input.restored.size > 0) full.add(child);
      else checks.push(key);
    } else if (removed !== undefined) {
      if (removed > 0) probes.push(key);
    } else if (
      (written.get(parent) ?? []).some((write) => removesKey(write, key)) ||
      (touched.has(parent) && (!existed.has(parent) || captured.has(parent)))
    ) {
      if (input.restored.size > 0) full.add(child);
      else checks.push(key);
    }
  }
  return {
    full: [...full].sort(),
    checks: checks.filter((key) => !full.has(key.child.toLowerCase())),
    defaults,
    probes: probes.filter((key) => !full.has(key.child.toLowerCase())),
  };
};

export const rebuiltBy = (statements: readonly string[]): ReadonlySet<string> => {
  const rebuilt = new Set<string>();
  for (const statement of statements) {
    const target = schemaStatement(statement);
    if (target.kind === 'drop-table' && !target.temporary) rebuilt.add(target.table);
    else if (target.kind === 'alter-table' && !target.temporary && target.renameTo !== null) {
      rebuilt.add(target.table);
      rebuilt.add(target.renameTo);
    }
  }
  return rebuilt;
};
