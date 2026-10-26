import type { RunLife } from '@runlith/agent/transcript/live';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';

export type Team = {
  readonly working: number;
  readonly asking: number;
  readonly failed: number;
  readonly cut: number;
  readonly unseen: number;
  readonly pinned: number;
  readonly size: number;
  readonly workers: readonly string[];
};

export type ThreadTreeNode = {
  readonly row: ThreadListRow;
  readonly children: readonly ThreadTreeNode[];
  readonly life: RunLife;
  readonly lifeBelow: RunLife;
  readonly lastEventAt: string;
  readonly liveSince: string | null;
  readonly team: Team;
};

export const TEAM_NAMED = 3;

export const NO_TEAM: Team = { working: 0, asking: 0, failed: 0, cut: 0, unseen: 0, pinned: 0, size: 0, workers: [] };

export type RowOrder = (left: ThreadListRow, right: ThreadListRow) => number;

export function feedOrder(left: ThreadListRow, right: ThreadListRow): number {
  if (left.readerOrderAt !== right.readerOrderAt) return left.readerOrderAt < right.readerOrderAt ? 1 : -1;
  return right.id.localeCompare(left.id);
}

export function isQuiet(node: ThreadTreeNode): boolean {
  return node.life === 'idle' && node.lifeBelow === 'idle';
}

export function unseenFailure(row: ThreadListRow, life: RunLife): 'failed' | 'cut' | null {
  const outcome = row.outcome;
  if (outcome == null || outcome.isSeen || row.archivedAt !== null || life !== 'idle') return null;
  return outcome.status === 'failed' || outcome.status === 'cut' ? outcome.status : null;
}

type Aggregate = {
  active: number;
  working: number;
  asking: number;
  failed: number;
  cut: number;
  unseen: number;
  pinned: number;
  size: number;
  workers: readonly string[];
  event: string | null;
  live: string | null;
};

type Entry = { node: ThreadTreeNode; parent: Entry | null; aggregate: Aggregate };

function ownEvent(row: ThreadListRow): string {
  const finished = row.outcome?.finishedAt;
  return finished !== undefined && finished > row.readerOrderAt ? finished : row.readerOrderAt;
}

function workerName(node: ThreadTreeNode): string {
  return node.row.name ?? node.row.agentId;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left === right || (left.length === right.length && left.every((name, index) => name === right[index]));
}

function sameWorkers(was: ThreadTreeNode | null, now: ThreadTreeNode | null): boolean {
  const wasWorking = was?.life === 'working';
  const nowWorking = now?.life === 'working';
  if (wasWorking !== nowWorking) return false;
  if (was !== null && now !== null && wasWorking && workerName(was) !== workerName(now)) return false;
  return sameNames(was?.team.workers ?? [], now?.team.workers ?? []);
}

function namesWork(node: ThreadTreeNode): boolean {
  return node.life === 'working' || node.team.workers.length > 0;
}

function namedWorkers(children: readonly ThreadTreeNode[]): readonly string[] {
  const named: string[] = [];
  for (const child of children) {
    if (child.life === 'working') named.push(workerName(child));
    for (const name of child.team.workers) {
      if (named.length >= TEAM_NAMED) break;
      named.push(name);
    }
    if (named.length >= TEAM_NAMED) break;
  }
  return named.length > TEAM_NAMED ? named.slice(0, TEAM_NAMED) : named;
}

type Share = { active: number; working: number; asking: number; failed: number; cut: number; unseen: number; pinned: number; size: number };

export function unseenOutcome(row: ThreadListRow, life: RunLife): boolean {
  return life === 'idle' && row.outcome?.status === 'completed' && !row.outcome.isSeen;
}

function share(node: ThreadTreeNode | null): Share {
  if (node === null) return { active: 0, working: 0, asking: 0, failed: 0, cut: 0, unseen: 0, pinned: 0, size: 0 };
  const failure = unseenFailure(node.row, node.life);
  return {
    active: isQuiet(node) ? 0 : 1,
    working: (node.life === 'working' ? 1 : 0) + node.team.working,
    asking: (node.life === 'awaiting' ? 1 : 0) + node.team.asking,
    failed: (failure === 'failed' ? 1 : 0) + node.team.failed,
    cut: (failure === 'cut' ? 1 : 0) + node.team.cut,
    unseen: (unseenOutcome(node.row, node.life) ? 1 : 0) + node.team.unseen,
    pinned: (node.row.pinnedAt !== null ? 1 : 0) + node.team.pinned,
    size: 1 + node.team.size,
  };
}

function lowerBound<T>(list: readonly T[], probe: T, order: (left: T, right: T) => number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (order(list[middle] as T, probe) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function fits<T>(list: readonly T[], at: number, probe: T, order: (left: T, right: T) => number): boolean {
  return (at === 0 || order(list[at - 1] as T, probe) < 0) && (at === list.length - 1 || order(probe, list[at + 1] as T) < 0);
}

function swapped<T>(list: readonly T[], was: T | null, now: T | null, order: (left: T, right: T) => number): readonly T[] {
  const from = was === null ? -1 : lowerBound(list, was, order);
  if (now === null) return from < 0 ? list : list.toSpliced(from, 1);
  if (from >= 0 && fits(list, from, now, order)) return list.with(from, now);
  const rest = from >= 0 ? list.toSpliced(from, 1) : list;
  return rest.toSpliced(lowerBound(rest, now, order), 0, now);
}

function bandedOrder(siblings: RowOrder): (left: ThreadTreeNode, right: ThreadTreeNode) => number {
  return (left, right) => {
    const leftPinned = left.row.pinnedAt !== null;
    if (leftPinned !== (right.row.pinnedAt !== null)) return leftPinned ? -1 : 1;
    const leftQuiet = isQuiet(left);
    if (leftQuiet !== isQuiet(right)) return leftQuiet ? 1 : -1;
    if (leftQuiet) {
      if (left.lastEventAt !== right.lastEventAt) return left.lastEventAt < right.lastEventAt ? 1 : -1;
    } else if (left.liveSince !== right.liveSince) {
      if (left.liveSince === null) return 1;
      if (right.liveSince === null) return -1;
      return left.liveSince < right.liveSince ? -1 : 1;
    }
    return siblings(left.row, right.row);
  };
}

function flatOrder(siblings: RowOrder): (left: ThreadTreeNode, right: ThreadTreeNode) => number {
  return (left, right) => siblings(left.row, right.row);
}

export class ThreadForest {
  private readonly entries = new Map<string, Entry>();
  private readonly declared = new Map<string, Set<string>>();
  private readonly rootOrder: (left: ThreadTreeNode, right: ThreadTreeNode) => number;
  private readonly nodeOrder: (left: ThreadTreeNode, right: ThreadTreeNode) => number;
  private current: readonly ThreadTreeNode[] = [];
  private stamp = 0;
  private sorted: { readonly stamp: number; readonly rows: readonly ThreadListRow[] } = { stamp: -1, rows: [] };

  constructor(
    private readonly siblings: RowOrder = feedOrder,
    banded = true,
  ) {
    this.nodeOrder = flatOrder(siblings);
    this.rootOrder = banded ? bandedOrder(siblings) : this.nodeOrder;
  }

  get roots(): readonly ThreadTreeNode[] {
    return this.current;
  }

  get revision(): number {
    return this.stamp;
  }

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  row(id: string): ThreadListRow | undefined {
    return this.entries.get(id)?.node.row;
  }

  node(id: string): ThreadTreeNode | undefined {
    return this.entries.get(id)?.node;
  }

  rows(): readonly ThreadListRow[] {
    if (this.sorted.stamp !== this.stamp) {
      const rows = [...this.entries.values()].map((entry) => entry.node.row).sort(this.siblings);
      this.sorted = { stamp: this.stamp, rows };
    }
    return this.sorted.rows;
  }

  put(row: ThreadListRow): void {
    const entry = this.entries.get(row.id);
    if (entry === undefined) {
      this.insert(row);
      return;
    }
    if (entry.node.row === row) return;
    this.stamp += 1;
    const parent = this.parentFor(entry, row);
    if (parent === entry.parent) {
      this.regrow(entry, row);
      return;
    }
    this.lift(entry);
    this.regrow(entry, row, false);
    this.land(entry, parent);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.stamp += 1;
    const children = entry.node.children.map((child) => this.entries.get(child.row.id) as Entry);
    this.lift(entry);
    this.entries.delete(id);
    this.undeclare(entry.node.row);
    for (const child of children) this.land(child, null);
  }

  private insert(row: ThreadListRow): void {
    this.stamp += 1;
    const entry: Entry = { node: undefined as unknown as ThreadTreeNode, parent: null, aggregate: emptyAggregate() };
    entry.node = growNode(entry.aggregate, row, []);
    this.entries.set(row.id, entry);
    this.declare(row);
    this.land(entry, this.parentFor(entry, row));
    const waiting = this.declared.get(row.id);
    if (waiting === undefined) return;
    for (const id of [...waiting]) {
      const child = this.entries.get(id);
      if (child === undefined || child.parent !== null || this.within(entry, child)) continue;
      this.lift(child);
      this.land(child, entry);
    }
  }

  private parentFor(entry: Entry, row: ThreadListRow): Entry | null {
    const id = row.parentThreadId;
    if (id === null || id === row.id) return null;
    const parent = this.entries.get(id);
    if (parent === undefined || this.within(parent, entry)) return null;
    return parent;
  }

  private within(candidate: Entry, ancestor: Entry): boolean {
    for (let at: Entry | null = candidate; at !== null; at = at.parent) if (at === ancestor) return true;
    return false;
  }

  private declare(row: ThreadListRow): void {
    const id = row.parentThreadId;
    if (id === null || id === row.id) return;
    const held = this.declared.get(id);
    if (held === undefined) this.declared.set(id, new Set([row.id]));
    else held.add(row.id);
  }

  private undeclare(row: ThreadListRow): void {
    const id = row.parentThreadId;
    if (id === null) return;
    const held = this.declared.get(id);
    if (held === undefined) return;
    held.delete(row.id);
    if (held.size === 0) this.declared.delete(id);
  }

  private regrow(entry: Entry, row: ThreadListRow, publish = true): void {
    const was = entry.node;
    if (was.row.parentThreadId !== row.parentThreadId) {
      this.undeclare(was.row);
      this.declare(row);
    }
    const next = growNode(entry.aggregate, row, was.children, was);
    entry.node = next;
    if (publish) this.climb(entry.parent, was, next);
  }

  private lift(entry: Entry): void {
    this.climb(entry.parent, entry.node, null);
    entry.parent = null;
  }

  private land(entry: Entry, parent: Entry | null): void {
    entry.parent = parent;
    this.climb(parent, null, entry.node);
  }

  private climb(start: Entry | null, was: ThreadTreeNode | null, now: ThreadTreeNode | null): void {
    let parent = start;
    let before = was;
    let after = now;
    while (parent !== null) {
      const children = swapped(parent.node.children, before, after, this.nodeOrder);
      foldInto(parent.aggregate, children, before, after, before !== null && after !== null && this.nodeOrder(before, after) !== 0);
      const grown = growNode(parent.aggregate, parent.node.row, children, parent.node);
      before = parent.node;
      after = grown;
      parent.node = grown;
      parent = parent.parent;
    }
    this.current = swapped(this.current, before, after, this.rootOrder);
  }
}

function foldInto(
  aggregate: Aggregate,
  children: readonly ThreadTreeNode[],
  was: ThreadTreeNode | null,
  now: ThreadTreeNode | null,
  moved: boolean,
  workers = true,
): void {
  const gone = share(was);
  const come = share(now);
  aggregate.active += come.active - gone.active;
  aggregate.working += come.working - gone.working;
  aggregate.asking += come.asking - gone.asking;
  aggregate.failed += come.failed - gone.failed;
  aggregate.cut += come.cut - gone.cut;
  aggregate.unseen += come.unseen - gone.unseen;
  aggregate.pinned += come.pinned - gone.pinned;
  aggregate.size += come.size - gone.size;
  if (workers && (!sameWorkers(was, now) || (moved && now !== null && namesWork(now)))) aggregate.workers = namedWorkers(children);
  const event = now?.lastEventAt ?? null;
  if (aggregate.event === null || (event !== null && event > aggregate.event)) aggregate.event = event;
  else if (was !== null && was.lastEventAt === aggregate.event && (event === null || event < was.lastEventAt)) {
    aggregate.event = children.reduce<string | null>(
      (latest, child) => (latest === null || child.lastEventAt > latest ? child.lastEventAt : latest),
      null,
    );
  }
  const live = now?.liveSince ?? null;
  if (live !== null && (aggregate.live === null || live < aggregate.live)) aggregate.live = live;
  else if (was?.liveSince != null && was.liveSince === aggregate.live && (live === null || live > was.liveSince)) {
    aggregate.live = children.reduce<string | null>(
      (earliest, child) => (child.liveSince !== null && (earliest === null || child.liveSince < earliest) ? child.liveSince : earliest),
      null,
    );
  }
}

function growNode(
  total: Aggregate,
  row: ThreadListRow,
  children: readonly ThreadTreeNode[],
  previous: ThreadTreeNode | null = null,
): ThreadTreeNode {
  const event = ownEvent(row);
  const ownLive = row.life === 'idle' ? null : row.liveSpellStartedAt;
  const live = ownLive !== null && (total.live === null || ownLive < total.live) ? ownLive : total.live;
  return {
    row,
    children,
    life: row.life,
    lifeBelow: total.asking > 0 ? 'awaiting' : total.working > 0 ? 'working' : total.active > 0 ? 'stalled' : 'idle',
    lastEventAt: total.event !== null && total.event > event ? total.event : event,
    liveSince: live,
    team: teamOf(total, previous?.team ?? NO_TEAM),
  };
}

function emptyAggregate(): Aggregate {
  return { active: 0, working: 0, asking: 0, failed: 0, cut: 0, unseen: 0, pinned: 0, size: 0, workers: [], event: null, live: null };
}

function teamOf(total: Aggregate, previous: Team): Team {
  if (total.size === 0) return NO_TEAM;
  if (
    previous.working === total.working &&
    previous.asking === total.asking &&
    previous.failed === total.failed &&
    previous.cut === total.cut &&
    previous.unseen === total.unseen &&
    previous.pinned === total.pinned &&
    previous.size === total.size &&
    sameNames(previous.workers, total.workers)
  ) {
    return previous;
  }
  return {
    working: total.working,
    asking: total.asking,
    failed: total.failed,
    cut: total.cut,
    unseen: total.unseen,
    pinned: total.pinned,
    size: total.size,
    workers: total.workers,
  };
}

function arrival(): RowOrder {
  const seen = new Map<string, number>();
  const rank = (id: string): number => {
    let place = seen.get(id);
    if (place === undefined) {
      place = seen.size;
      seen.set(id, place);
    }
    return place;
  };
  return (left, right) => rank(left.id) - rank(right.id);
}

export function threadTree(rows: readonly ThreadListRow[]): readonly ThreadTreeNode[] {
  return builtFrom(rows, false);
}

export function composeNode(row: ThreadListRow, children: readonly ThreadTreeNode[]): ThreadTreeNode {
  const aggregate = emptyAggregate();
  for (const child of children) foldInto(aggregate, children, null, child, false, false);
  aggregate.workers = namedWorkers(children);
  return growNode(aggregate, row, children);
}

export function bandedRoots(nodes: readonly ThreadTreeNode[]): readonly ThreadTreeNode[] {
  return nodes.toSorted(bandedOrder(feedOrder));
}

export function feedRoots(nodes: readonly ThreadTreeNode[]): readonly ThreadTreeNode[] {
  return nodes.toSorted((left, right) => feedOrder(left.row, right.row));
}

export function bandedTree(rows: readonly ThreadListRow[]): readonly ThreadTreeNode[] {
  return builtFrom(rows, true);
}

function builtFrom(rows: readonly ThreadListRow[], banded: boolean): readonly ThreadTreeNode[] {
  const order = arrival();
  for (const row of rows) order(row, row);
  const forest = new ThreadForest(order, banded);
  for (const row of rows) forest.put(row);
  return forest.roots;
}
