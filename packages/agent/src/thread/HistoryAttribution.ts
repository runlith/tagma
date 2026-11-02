import type { Message } from '@runlith/llm/schema/messages';
import { Chunk, Effect, HashMap, HashSet, Option } from 'effect';
import { sha256 } from '@runlith/utils/sha256';
import { estimateThreadTokens } from './compaction/measurement';
import { ThreadStorageFailed } from './persisted';
import { agentOriginOf, agentReaderInput, agentReaderPosition, opensTurnMessage, withAgentReaderInput } from '../agent/AgentSignal';
import type { ThreadRewindScope } from '../transcript/eventFold';
import type { ThreadEntryReader } from '../transcript/kinds';
import { readThreadRecordsAsOf, type ThreadEventBody } from './events';
import { spliceThreadHistory } from './HistoryFold';
import type { ThreadPortFailure } from './ThreadBorder';
import type { ThreadEventLogStorage } from './storage/eventLog';
import {
  opensTurnEntry,
  type ThreadRewindBlocked,
  type ThreadRewindCut,
  type ThreadRewindInsert,
  type ThreadRewindPoint,
  type ThreadRewindPoints,
  type ThreadRewindStanding,
} from './rewind';
export type AttributedMessage = {
  readonly position: number;
  readonly index: number;
  readonly insert?: number;
};
type Description = {
  readonly source: AttributedMessage;
  readonly userKey: string | null;
  readonly summary: boolean;
  readonly opening: boolean;
  readonly tokens: number;
};
type Held = Description & {
  readonly run: string | null;
  readonly seq: number;
};
type RunRecord = {
  readonly first: number;
  readonly opens: boolean;
  readonly appended: boolean;
  readonly ended: boolean;
  readonly withdrawn: boolean;
  readonly summarized: boolean;
  readonly heldBy: string | null;
  readonly messages: number;
};
type RewindRecord = {
  readonly position: number;
  readonly scope: ThreadRewindScope;
  readonly runIds: readonly string[];
  readonly blocks: readonly (readonly Held[])[];
  readonly restored: boolean;
  readonly superseded: boolean;
};
export type AttributionRestore = {
  readonly runIds: readonly string[];
  readonly inserts: readonly {
    readonly at: number;
    readonly messages: readonly AttributedMessage[];
  }[];
};
export type ThreadRewindPlan =
  | {
      readonly runIds: readonly string[];
      readonly cuts: readonly ThreadRewindCut[];
    }
  | {
      readonly blocked: ThreadRewindBlocked;
    };
export type ThreadRestorePlan =
  | AttributionRestore
  | {
      readonly refused: 'restore-superseded' | 'restore-unknown';
    };
const HEAD = -1;
const DESCRIPTOR_BYTES = 512;
export class HistoryAttribution {
  private held = Chunk.empty<Held>();
  private next = 0;
  private open: string | null = null;
  private runs = HashMap.empty<string, RunRecord>();
  private order = Chunk.empty<string>();
  private rewinds = HashMap.empty<string, RewindRecord>();
  private rewindOrder = Chunk.empty<string>();
  private namedBytes = 0;
  private removed = 0;
  private taken = HashSet.empty<string>();
  fold(position: number, event: ThreadEventBody): void {
    const { payload } = event;
    const named = this.see(position, event);
    if (payload.withdrawn) {
      const keep = Math.max(0, Math.min(this.held.length, payload.withdrawn.keepMessages));
      for (let at = keep; at < this.held.length; at += 1) this.count(Chunk.getUnsafe(this.held, at).run, -1);
      this.held = packed(Chunk.toReadonlyArray(Chunk.take(this.held, keep)));
      return;
    }
    if (payload.compacted) return this.compact(position, payload.compacted.keepFrom, payload.compacted.messages);
    if (payload.branched) return this.branch(payload.branched.cuts, payload.branched.hidden);
    if (payload.rewound)
      return this.rewind(position, payload.rewound.id, payload.rewound.scope, payload.rewound.runIds, payload.rewound.cuts);
    if (payload.restored) return this.restore(position, payload.restored.rewindId, payload.restored.inserts);
    const messages = payload.messages;
    if (!messages?.length) return;
    const run = named ?? (event.kind === 'context' && payload.entry === undefined ? this.open : null);
    if (run !== null) this.appendedBy(run);
    for (const [index, message] of messages.entries()) {
      this.held = Chunk.append(this.held, { ...describe(message, { position, index }), run, seq: this.next++ });
      this.count(run, 1);
    }
  }
  copy(): HistoryAttribution {
    const copy = new HistoryAttribution();
    copy.held = this.held;
    copy.next = this.next;
    copy.open = this.open;
    copy.runs = this.runs;
    copy.order = this.order;
    copy.rewinds = this.rewinds;
    copy.rewindOrder = this.rewindOrder;
    copy.namedBytes = this.namedBytes;
    copy.removed = this.removed;
    copy.taken = this.taken;
    return copy;
  }
  get retainedBytes(): number {
    return this.namedBytes + (this.held.length + this.removed) * DESCRIPTOR_BYTES;
  }
  rewriteTokens(cuts: readonly ThreadRewindCut[]): number {
    const held = Chunk.toReadonlyArray(this.held);
    let tokens = 0;
    for (const [at, cut] of cuts.entries()) {
      for (let index = cut.to; index < (cuts[at + 1]?.from ?? held.length); index += 1) tokens += held[index]!.tokens;
    }
    return tokens;
  }
  get size(): number {
    return this.held.length;
  }
  plan(target: string, scope: ThreadRewindScope): ThreadRewindPlan {
    const blocked = this.standing(target);
    if (blocked !== null) return { blocked };
    const runIds = scope === 'turn' ? [target] : this.fromOn(target);
    const taken = new Set(runIds);
    const cuts: ThreadRewindCut[] = [];
    let said = false;
    for (const [index, held] of Chunk.toReadonlyArray(this.held).entries()) {
      if (held.run === null || !taken.has(held.run)) continue;
      if (held.run === target) said = true;
      const last = cuts[cuts.length - 1];
      if (last !== undefined && last.to === index) cuts[cuts.length - 1] = { from: last.from, to: index + 1 };
      else cuts.push({ from: index, to: index + 1 });
    }
    return said ? { runIds, cuts } : { blocked: 'rewind-unknown' };
  }
  restorePlan(rewindId: string): ThreadRestorePlan {
    const rewind = Option.getOrUndefined(HashMap.get(this.rewinds, rewindId));
    if (rewind === undefined || rewind.restored) return { refused: 'restore-unknown' };
    if (rewind.superseded) return { refused: 'restore-superseded' };
    const inserts = rewind.blocks.map((block) => ({ at: this.firstAbove(block[0]!.seq), messages: block.map((held) => held.source) }));
    return { runIds: rewind.runIds, inserts };
  }
  turns(runIds: readonly string[]): number {
    return runIds.filter((runId) => this.run(runId)?.opens === true).length;
  }
  turnStarts(): readonly number[] {
    const seen = new Set<string>();
    const starts: number[] = [];
    for (const [index, held] of Chunk.toReadonlyArray(this.held).entries()) {
      if (!held.opening || (held.run !== null && seen.has(held.run))) continue;
      starts.push(index);
      if (held.run !== null) seen.add(held.run);
    }
    return starts;
  }
  runsBefore(index: number): readonly string[] | null {
    const before = new Set(this.kept());
    if (before.size === 0) return null;
    for (const held of Chunk.drop(this.held, index)) if (held.run !== null) before.delete(held.run);
    return [...new Set([...before, ...this.cut()])];
  }
  cut(): readonly string[] {
    return Array.from(this.taken);
  }
  kept(): readonly string[] {
    return Chunk.toReadonlyArray(this.order).filter((runId) => !HashSet.has(this.taken, runId) && this.run(runId)!.messages > 0);
  }
  rewound(): readonly string[] {
    return Chunk.toReadonlyArray(this.order).filter((runId) => this.run(runId)!.heldBy !== null);
  }
  points(): ThreadRewindPoints {
    const points: ThreadRewindPoint[] = [];
    for (const runId of this.order) {
      const run = this.run(runId)!;
      if (!run.opens || run.withdrawn) continue;
      const reason = this.standing(runId) ?? (run.messages === 0 ? 'rewind-unknown' : null);
      points.push(reason === null ? { runId, rewindable: true } : { runId, rewindable: false, reason });
    }
    const rewinds: ThreadRewindStanding[] = [];
    for (const rewindId of this.rewindOrder) {
      const rewind = HashMap.getUnsafe(this.rewinds, rewindId);
      if (!rewind.restored) rewinds.push({ rewindId, scope: rewind.scope, runIds: rewind.runIds, restorable: !rewind.superseded });
    }
    return { points, rewinds };
  }
  private run(id: string): RunRecord | undefined {
    return Option.getOrUndefined(HashMap.get(this.runs, id));
  }
  private count(id: string | null, by: number): void {
    const run = id === null ? undefined : this.run(id);
    if (run !== undefined && id !== null) this.runs = HashMap.set(this.runs, id, { ...run, messages: run.messages + by });
  }
  private see(position: number, event: ThreadEventBody): string | null {
    const { entry, context, withdrawn, runId } = event.payload;
    const named = entry?.runId ?? context?.runId ?? runId ?? withdrawn?.runId ?? null;
    if (named === null) return null;
    let run = this.run(named);
    if (run === undefined) {
      run = {
        first: position,
        opens: false,
        appended: false,
        ended: false,
        withdrawn: false,
        summarized: false,
        heldBy: null,
        messages: 0,
      };
      this.order = Chunk.append(this.order, named);
      this.namedBytes += DESCRIPTOR_BYTES + named.length * 2;
    }
    if (opensTurnEntry(entry)) run = { ...run, opens: true };
    if (entry?.type === 'run-end' || withdrawn) {
      run = { ...run, ended: true, withdrawn: run.withdrawn || withdrawn !== undefined };
      if (withdrawn !== undefined) this.taken = HashSet.add(this.taken, named);
      if (this.open === named) this.open = null;
    } else if (!run.ended) this.open = named;
    this.runs = HashMap.set(this.runs, named, run);
    return entry?.runId ?? context?.runId ?? runId ?? null;
  }
  private compact(position: number, keepFrom: number, messages: readonly Message[]): void {
    const held = Chunk.toReadonlyArray(this.held);
    const described = messages.map((message, index) => describe(message, { position, index }));
    const kept = Math.max(0, Math.min(keepFrom, held.length));
    let leading = 0;
    while (leading < described.length && described[leading]!.summary) leading += 1;
    let copies = Math.min(kept, messages.length - leading);
    const pin = copies > 0 ? this.pinnedSource(described[leading]!.userKey, kept - copies) : -1;
    if (pin >= 0) copies -= 1;
    const covered = kept - copies;
    for (let at = 0; at < kept; at += 1) {
      const item = held[at]!;
      this.count(item.run, -1);
      if (at < covered && at !== pin && item.run !== null) {
        const run = this.run(item.run);
        if (run !== undefined) this.runs = HashMap.set(this.runs, item.run, { ...run, summarized: true });
      }
    }
    const head = messages.length - copies;
    const replaced = described.map((message, index): Held => {
      const source = index === leading && pin >= 0 ? held[pin] : index < head ? undefined : held[covered + index - head];
      this.count(source?.run ?? null, 1);
      return { ...message, run: source?.run ?? null, seq: source?.seq ?? HEAD };
    });
    this.held = packed([...replaced, ...held.slice(kept)]);
    for (const [id, rewind] of this.rewinds) this.supersede(id, rewind);
  }
  private branch(cuts: readonly ThreadRewindCut[], hidden: readonly string[]): void {
    const held = Chunk.toReadonlyArray(this.held);
    const emptied = new Set(hidden);
    for (const cut of cuts) {
      for (const item of held.slice(cut.from, cut.to)) {
        this.count(item.run, -1);
        if (item.run !== null && this.run(item.run)?.messages === 0) emptied.add(item.run);
      }
    }
    this.held = packed(
      spliceThreadHistory(
        held,
        cuts.map((cut) => ({ from: cut.from, to: cut.to, insert: [] })),
      ),
    );
    for (const runId of emptied) {
      const run = this.run(runId);
      if (run === undefined) continue;
      this.runs = HashMap.set(this.runs, runId, { ...run, ended: true, withdrawn: true });
      this.taken = HashSet.add(this.taken, runId);
    }
  }
  private pinnedSource(wanted: string | null, positional: number): number {
    const held = Chunk.toReadonlyArray(this.held);
    if (wanted === null || held[positional]?.userKey === wanted) return -1;
    for (let at = positional - 1; at >= 0; at -= 1) if (held[at]!.userKey === wanted) return at;
    return -1;
  }
  private rewind(
    position: number,
    id: string,
    scope: ThreadRewindScope,
    runIds: readonly string[],
    cuts: readonly ThreadRewindCut[],
  ): void {
    const held = Chunk.toReadonlyArray(this.held);
    const blocks = cuts.map((cut) => held.slice(cut.from, cut.to));
    for (const block of blocks) {
      this.removed += block.length;
      for (const item of block) this.count(item.run, -1);
    }
    this.held = packed(
      spliceThreadHistory(
        held,
        cuts.map((cut) => ({ from: cut.from, to: cut.to, insert: [] })),
      ),
    );
    for (const runId of runIds) {
      const run = this.run(runId);
      if (run === undefined) continue;
      this.runs = HashMap.set(this.runs, runId, { ...run, heldBy: id });
      this.taken = HashSet.add(this.taken, runId);
    }
    this.namedBytes += DESCRIPTOR_BYTES + id.length * 2 + runIds.reduce((bytes, runId) => bytes + 32 + runId.length * 2, 0);
    this.rewindOrder = Chunk.append(this.rewindOrder, id);
    this.rewinds = HashMap.set(this.rewinds, id, { position, scope, runIds, blocks, restored: false, superseded: false });
  }
  private restore(position: number, rewindId: string, inserts: readonly ThreadRewindInsert[]): void {
    const rewind = Option.getOrUndefined(HashMap.get(this.rewinds, rewindId));
    const edits = inserts.map((insert, index) => {
      const block = rewind?.blocks[index];
      const placed = insert.messages.map((message, at): Held => {
        const source = block?.[at];
        const address = { position, insert: index, index: at };
        const held = source === undefined ? { ...describe(message, address), run: null, seq: this.next++ } : { ...source, source: address };
        this.count(held.run, 1);
        return held;
      });
      return { from: insert.at, to: insert.at, insert: placed };
    });
    this.held = packed(spliceThreadHistory(Chunk.toReadonlyArray(this.held), edits));
    if (rewind === undefined) return;
    this.removed -= rewind.blocks.reduce((count, block) => count + block.length, 0);
    this.rewinds = HashMap.set(this.rewinds, rewindId, { ...rewind, restored: true, blocks: [] });
    for (const runId of rewind.runIds) {
      const run = this.run(runId);
      if (run?.heldBy !== rewindId) continue;
      this.runs = HashMap.set(this.runs, runId, { ...run, heldBy: null });
      if (!run.withdrawn) this.taken = HashSet.remove(this.taken, runId);
    }
  }
  private supersede(id: string, rewind: RewindRecord): void {
    if (rewind.superseded) return;
    this.removed -= rewind.blocks.reduce((count, block) => count + block.length, 0);
    this.rewinds = HashMap.set(this.rewinds, id, { ...rewind, superseded: true, blocks: [] });
  }
  private appendedBy(runId: string): void {
    const run = this.run(runId);
    if (run === undefined || run.appended) return;
    this.runs = HashMap.set(this.runs, runId, { ...run, appended: true });
    for (const [id, rewind] of this.rewinds) if (!rewind.restored && run.first > rewind.position) this.supersede(id, rewind);
  }
  private standing(runId: string): ThreadRewindBlocked | null {
    const run = this.run(runId);
    if (run === undefined) return 'rewind-unknown';
    if (run.summarized) return 'rewind-summarized';
    return run.heldBy === null ? null : 'rewind-rewound';
  }
  private firstAbove(seq: number): number {
    let low = 0;
    let high = this.held.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (Chunk.getUnsafe(this.held, middle).seq < seq) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  private fromOn(target: string): readonly string[] {
    const order = Chunk.toReadonlyArray(this.order);
    return order.slice(order.indexOf(target)).filter((runId, index) => {
      if (index === 0) return true;
      const run = this.run(runId)!;
      return run.heldBy === null && !run.withdrawn;
    });
  }
}
function packed<A>(values: readonly A[]): Chunk.Chunk<A> {
  let result = Chunk.empty<A>();
  for (let at = 0; at < values.length; at += 64) result = Chunk.appendAll(result, Chunk.fromIterable(values.slice(at, at + 64)));
  return result;
}
function describe(message: Message, source: AttributedMessage): Description {
  const origin = agentOriginOf(message);
  const keyed =
    message.metadata?.readerPosition === undefined
      ? message
      : (({ readerPosition: _position, ...metadata }) => ({ ...message, metadata }))(message.metadata);
  return {
    source,
    userKey: message.role === 'user' && origin === undefined ? sha256().update(JSON.stringify(keyed)).digest('hex') : null,
    summary: origin === 'summary',
    opening: opensTurnMessage(message),
    tokens: estimateThreadTokens(message),
  };
}
export const restoreAttributed = Effect.fn('HistoryAttribution.restoreAttributed')(function* <TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  threadId: string,
  plan: AttributionRestore,
  tx?: TTx,
): Effect.fn.Return<readonly ThreadRewindInsert[], ThreadPortFailure> {
  const sources = new Map<number, AttributedMessage[]>();
  for (const insert of plan.inserts)
    for (const source of insert.messages) {
      const group = sources.get(source.position) ?? [];
      group.push(source);
      sources.set(source.position, group);
    }
  const resolved = new Map<AttributedMessage, Message>();
  yield* Effect.forEach(
    sources,
    Effect.fnUntraced(function* ([position, group]) {
      const page = yield* readThreadRecordsAsOf(log, kinds, threadId, { head: position, afterPosition: position - 1, limit: 1 }, tx);
      const payload = page[0]?.payload;
      for (const source of group) {
        const message =
          source.insert === undefined
            ? (payload?.compacted?.messages ?? payload?.messages)?.[source.index]
            : payload?.restored?.inserts[source.insert]?.messages[source.index];
        if (message === undefined)
          return yield* new ThreadStorageFailed({
            call: 'restoreAttributed',
            cause: new Error(`Thread ${threadId}: attributed message ${source.position}:${source.index} is unavailable.`),
          });
        const input = agentReaderInput(message);
        resolved.set(
          source,
          input === undefined ? message : withAgentReaderInput(message, input, agentReaderPosition(message) ?? source.position),
        );
      }
    }),
    { concurrency: tx === undefined ? 3 : 1, discard: true },
  );
  return plan.inserts.map((insert) => ({ at: insert.at, messages: insert.messages.map((source) => resolved.get(source)!) }));
});
export type AttributionCursor = { readonly attribution: HistoryAttribution; readonly through: number };
const ATTRIBUTION_PAGE = 256;
export function attributionDisagrees(threadId: string): Error {
  return new Error(`Thread ${threadId}: its log folds to another history than its row holds, so no message can be attributed to its run.`);
}
export const attributeThread = Effect.fn('HistoryAttribution.attributeThread')(function* <TTx>(
  log: ThreadEventLogStorage<TTx>,
  kinds: ThreadEntryReader,
  threadId: string,
  head: number,
  tx?: TTx,
  prior?: AttributionCursor,
): Effect.fn.Return<HistoryAttribution, ThreadPortFailure> {
  const attribution = prior?.attribution ?? new HistoryAttribution();
  let after = prior?.through ?? 0;
  while (after < head) {
    const page = yield* readThreadRecordsAsOf(log, kinds, threadId, { head, afterPosition: after, limit: ATTRIBUTION_PAGE }, tx);
    for (const record of page) yield* Effect.sync(() => attribution.fold(record.position, record));
    const last = page[page.length - 1];
    if (last === undefined || page.length < ATTRIBUTION_PAGE) break;
    after = last.position;
  }
  return attribution;
});
