import type { NativeExit } from '@runlith/executions/protocol/execution';
import { ByteOffset, byteOffset, offsetValue, sameGeometry } from '@runlith/executions/protocol/record';
import type { RecordRange, Stream, TerminalGeometry } from '@runlith/executions/protocol/record';
import type { TerminalScreenPoint, ViewLeaseId } from '@tagma/server/executions/contract/wire/viewLeases';
import type { RecordDelivery } from '@tagma/server/executions/contract/wire/viewLeases';
import type { LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { markTerminalReplay } from './terminalChainRecord.js';
import type { LaneConnection, LaneOutput } from './LaneConnection.js';
import type { ExecutionAddress, RecordReads } from '../Repo.js';

type Window = Awaited<ReturnType<RecordReads['terminalBytes']>>;

export type RecordAim =
  | { readonly kind: 'terminal'; readonly stream: Stream }
  | { readonly kind: 'command'; readonly stream: 'stdout' | 'stderr' | 'output' };

export type StreamWriter = {
  write(bytes: Uint8Array, parsed: () => void, at?: ByteOffset): void;
  grid?(grid: TerminalGeometry): void;
  screen?(bytes: Uint8Array, at: ByteOffset, parsed: () => void): void;
  replaying(on: boolean): void;
};

export interface RecordStreamOptions {
  readonly scrollbackRows?: number;
  readonly progress?: (written: number, total: number) => void;
}

export type ChildEnding =
  | { readonly _tag: 'Exit'; readonly native: NativeExit }
  | { readonly _tag: 'None' }
  | { readonly _tag: 'HostEnded' }
  | { readonly _tag: 'Unread'; readonly problem: string };

type ReadExit =
  | { readonly _tag: 'Read'; readonly exit?: NativeExit }
  | { readonly _tag: 'HostEnded' }
  | { readonly _tag: 'Unread'; readonly problem: string };

export type StreamFrame =
  | { readonly _tag: 'Ended'; readonly ending: ChildEnding }
  | { readonly _tag: 'Recovering' }
  | { readonly _tag: 'Flowing' };

type Standing = 'ended' | 'running' | 'unknown';

type Replayed = 'read' | 'missing' | 'lost';

export const STREAM_MISSING = 'terminal-host-refused-StreamMissing';

export const BYTE_GAP_RESET = '\u0018\u001b[0m';

export const RETAINED_GAP_LINE = `${BYTE_GAP_RESET}\r\n[earlier output is no longer retained]\r\n`;

export const STDERR_APART_LINE = `${BYTE_GAP_RESET}\r\n[stderr, recorded apart from stdout: their order was not kept]\r\n`;

const apartAim = (aim: RecordAim, stream: 'stdout' | 'stderr'): RecordAim =>
  aim.kind === 'terminal' ? { kind: 'terminal', stream } : { kind: 'command', stream };

export const notShownLine = (from: ByteOffset, retainedFrom: ByteOffset, tail: ByteOffset): string =>
  `${BYTE_GAP_RESET}\r\n[earlier output is not shown: ${skippedKiB(from, retainedFrom, tail)} KiB of history stands in the record]\r\n`;

const skippedKiB = (from: ByteOffset, retainedFrom: ByteOffset, tail: ByteOffset): number => {
  const held = offsetValue(retainedFrom) > offsetValue(from) ? retainedFrom : from;
  return Math.round(Number(offsetValue(tail) - offsetValue(held)) / 1024);
};

const START = ByteOffset.make('0');

type Pointed = 'pointed' | 'none' | 'lost';

const SCREENLESS: ReadonlySet<string> = new Set([
  'terminal-host-refused-UnsupportedCapability',
  'terminal-host-refused-UnknownExecution',
  'terminal-host-refused-HostUnavailable',
]);

const TAIL_BYTES_PER_ROW = 120;

const RECOVERY_FIRST_MS = 1_000;

const RECOVERY_CEILING_MS = 30_000;

const EXIT_READS = 3;

export const recoveryPause = (attempt: number): Promise<void> =>
  new Promise((done) => setTimeout(done, Math.min(RECOVERY_CEILING_MS, RECOVERY_FIRST_MS * 2 ** attempt)));

const tailStart = (range: RecordRange, scrollbackRows: number | undefined): ByteOffset => {
  const frontier = offsetValue(range.durableThrough);
  const back = scrollbackRows === undefined ? frontier : BigInt(Math.max(0, Math.floor(scrollbackRows))) * BigInt(TAIL_BYTES_PER_ROW);
  const start = frontier - back;
  if (start <= offsetValue(range.retainedFrom)) return range.retainedFrom;
  if (start >= frontier) return range.durableThrough;
  return byteOffset(start);
};

export class RecordStream {
  private generation = 0;
  private subscription: { unsubscribe: () => void } | null = null;
  private cursor: ByteOffset = START;
  private laid: TerminalGeometry | undefined = undefined;
  private readonly notes = new Set<Promise<void>>();
  private fed = false;
  private pendingAck: { readonly viewer: ViewLeaseId; readonly offset: ByteOffset } | null = null;
  private healing: number | null = null;
  private apartShown = false;
  private stalled = false;
  private attempts = 0;
  private link: LaneConnection | null = null;
  private following: LaneConnection | null = null;
  private aligned = false;
  private outputEnded = false;
  private decided: TerminalGeometry | undefined = undefined;
  private readonly output: LaneOutput = {
    ready: () => this.offered(),
    frame: (offset, bytes) => this.frame(offset, bytes),
    behind: () => this.overtaken(),
    ended: () => this.drained(),
    lost: () => this.fellBack(),
  };

  constructor(
    private readonly reads: RecordReads,
    private readonly live: LiveConnection,
    private readonly projectId: number,
    private readonly address: ExecutionAddress,
    private readonly aim: RecordAim,
    private readonly writer: StreamWriter,
    private readonly listener: (frame: StreamFrame) => void,
    private readonly options: RecordStreamOptions = {},
  ) {}

  start(): Promise<void> {
    return this.follow(START, true);
  }

  reread(from: ByteOffset): Promise<void> {
    return this.follow(from, false);
  }

  async behind(from: ByteOffset): Promise<boolean> {
    const answer = await this.window(from, true);
    return answer !== undefined && offsetValue(answer.range.durableThrough) > offsetValue(from);
  }

  stop(): void {
    this.generation += 1;
    this.release();
    this.writer.replaying(false);
  }

  lane(link: LaneConnection | null): void {
    if (this.link === link) return;
    this.fellBack();
    this.link = link;
    link?.watch(this.output);
    this.offered();
  }

  applied(grid: TerminalGeometry): void {
    this.decided = grid;
    if (this.following !== null) void this.layGrid(grid);
  }

  private async follow(from: ByteOffset, boundTail: boolean): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.release();
    this.cursor = from;
    this.laid = undefined;
    this.writer.replaying(true);
    if (this.fed) this.note(BYTE_GAP_RESET);
    let replayed: Replayed = 'read';
    let apart = false;
    try {
      replayed = await this.replay(generation, boundTail, this.aim);
      if (replayed === 'missing' && generation === this.generation) {
        apart = true;
        replayed = await this.apart(generation);
      }
    } finally {
      if (generation === this.generation) this.writer.replaying(false);
    }
    if (generation !== this.generation || replayed === 'lost') return;
    this.flowing();
    if (!apart) return this.open(generation);
    if (replayed === 'read') return this.ended(generation);
  }

  async verify(): Promise<void> {
    const generation = this.generation;
    if ((await this.standing()) !== 'ended' || generation !== this.generation || this.healing === generation) return;
    this.generation += 1;
    this.healing = this.generation;
    this.release();
    return this.finish(this.generation);
  }

  private async recover(generation: number): Promise<void> {
    if (generation !== this.generation || this.healing === generation) return;
    this.healing = generation;
    this.release();
    this.recovering();
    const standing = await this.standing();
    if (generation !== this.generation) return;
    if (standing === 'ended') return this.finish(generation);
    await recoveryPause(this.attempts);
    this.attempts += 1;
    if (generation !== this.generation) return;
    const ahead = await this.ahead();
    if (generation !== this.generation) return;
    return ahead ? this.follow(START, true) : this.follow(this.cursor, !this.fed);
  }

  private async ahead(): Promise<boolean> {
    try {
      const answer = await this.window(START, true);
      return answer !== undefined && offsetValue(this.cursor) > offsetValue(answer.range.durableThrough);
    } catch {
      return false;
    }
  }

  private async finish(generation: number): Promise<void> {
    this.writer.replaying(true);
    let replayed: Replayed = 'lost';
    try {
      replayed = await this.replay(generation, !this.fed, this.aim);
    } finally {
      if (generation === this.generation) this.writer.replaying(false);
    }
    if (generation !== this.generation) return;
    if (replayed !== 'lost') return this.ended(generation);
    this.recovering();
    await recoveryPause(this.attempts);
    this.attempts += 1;
    if (generation === this.generation) return this.finish(generation);
  }

  private async standing(): Promise<Standing> {
    try {
      if (this.aim.kind === 'terminal') {
        const phase = (await this.reads.terminal(this.address))?.state?.phase;
        return phase === undefined ? 'unknown' : phase === 'ended' ? 'ended' : 'running';
      }
      const live = (await this.reads.command(this.address))?.live;
      if (live === undefined || live._tag === 'Unavailable') return 'unknown';
      if (live._tag === 'Unheld') return 'ended';
      return live.entry.state.phase === 'ended' ? 'ended' : 'running';
    } catch {
      return 'unknown';
    }
  }

  private recovering(): void {
    if (this.stalled) return;
    this.stalled = true;
    this.listener({ _tag: 'Recovering' });
  }

  private flowing(): void {
    this.attempts = 0;
    if (!this.stalled) return;
    this.stalled = false;
    this.listener({ _tag: 'Flowing' });
  }

  private async apart(generation: number): Promise<Replayed> {
    if (!this.apartShown) {
      this.cursor = START;
      this.laid = undefined;
      const stdout = await this.replay(generation, true, apartAim(this.aim, 'stdout'));
      if (stdout !== 'read' || generation !== this.generation) return 'lost';
      this.apartShown = true;
    }
    const stderr = apartAim(this.aim, 'stderr');
    let standing: Window;
    try {
      standing = await this.window(START, true, stderr);
    } catch {
      void this.recover(generation);
      return 'lost';
    }
    if (generation !== this.generation) return 'lost';
    if (standing === undefined || offsetValue(standing.range.durableThrough) === 0n) return 'read';
    this.note(STDERR_APART_LINE);
    this.cursor = START;
    this.laid = undefined;
    const read = await this.replay(generation, true, stderr);
    return read === 'read' ? 'read' : 'lost';
  }

  private async replay(generation: number, boundTail: boolean, aim: RecordAim, reported = true): Promise<Replayed> {
    const opened = boundTail ? await this.point(generation, aim) : 'none';
    if (opened === 'lost' || generation !== this.generation) return 'lost';
    let bounded = opened === 'pointed';
    let written = 0;
    let total: number | null = null;
    let ahead: Promise<Window> | null = null;
    for (;;) {
      const from = this.cursor;
      const positionsOnly = boundTail && !bounded;
      markTerminalReplay({ stage: 'fetch', offset: from, bytes: null });
      let answer: Window;
      try {
        answer = await (ahead ?? this.window(from, positionsOnly, aim));
      } catch (error) {
        if (generation !== this.generation) return 'lost';
        if (aim.stream === 'output' && refusalOf(error).code === STREAM_MISSING) return 'missing';
        void this.recover(generation);
        return 'lost';
      }
      ahead = null;
      if (generation !== this.generation) return 'lost';
      if (answer === undefined) {
        void this.recover(generation);
        return 'lost';
      }
      if (answer.range.gap && !positionsOnly) {
        const again = await this.point(generation, aim);
        if (again === 'lost' || generation !== this.generation) return 'lost';
        if (again === 'pointed') {
          total = null;
          continue;
        }
      }
      if (answer.range.gap) this.note(RETAINED_GAP_LINE);
      if (positionsOnly) {
        bounded = true;
        const tail = tailStart(answer.range, this.options.scrollbackRows);
        if (offsetValue(tail) > offsetValue(from)) {
          const held = offsetValue(answer.range.retainedFrom) > offsetValue(from) ? answer.range.retainedFrom : from;
          if (offsetValue(tail) > offsetValue(held)) this.note(notShownLine(from, held, tail));
          this.cursor = tail;
          continue;
        }
      }
      if (total === null) {
        total = Math.max(0, Number(offsetValue(answer.range.durableThrough) - offsetValue(this.cursor)));
        if (reported) this.options.progress?.(0, total);
      }
      await this.lay(answer.range);
      if (generation !== this.generation) return 'lost';
      const bytes = decode(answer.bytes);
      const reached = offsetValue(answer.range.next) >= offsetValue(answer.range.durableThrough);
      if (bytes.length > 0) {
        const parsed = new Promise<void>((resolve) => this.feed(bytes, resolve, from));
        this.cursor = answer.range.next;
        if (!reached) ahead = this.window(this.cursor, false, aim);
        await parsed;
        written += bytes.length;
        if (reported) this.options.progress?.(written, total);
        markTerminalReplay({ stage: 'parse', offset: from, bytes: bytes.length });
      } else {
        this.cursor = answer.range.next;
      }
      if (generation !== this.generation) return 'lost';
      if (reached) return 'read';
    }
  }

  private screened(aim: RecordAim): boolean {
    return aim.kind === 'terminal' && aim.stream === 'pty' && this.writer.screen !== undefined && this.options.scrollbackRows !== undefined;
  }

  private async point(generation: number, aim: RecordAim): Promise<Pointed> {
    if (!this.screened(aim)) return 'none';
    let answer: TerminalScreenPoint;
    try {
      answer = await this.live.call((client) =>
        client['terminal.screen.point']({
          projectId: this.projectId,
          execution: this.address.execution,
          incarnation: this.address.incarnation,
          scrollback: Math.max(0, Math.floor(this.options.scrollbackRows ?? 0)),
        }),
      );
    } catch (error) {
      if (generation !== this.generation) return 'lost';
      if (SCREENLESS.has(refusalOf(error).code)) return 'none';
      void this.recover(generation);
      return 'lost';
    }
    if (generation !== this.generation) return 'lost';
    if (answer._tag !== 'ScreenPoint') return 'none';
    await this.layGrid(answer.geometry);
    if (generation !== this.generation) return 'lost';
    this.fed = true;
    this.cursor = answer.position;
    await new Promise<void>((resolve) => this.writer.screen?.(answer.bytes, answer.position, resolve));
    return generation === this.generation ? 'pointed' : 'lost';
  }

  private window(from: ByteOffset, positionsOnly: boolean, aim: RecordAim = this.aim): Promise<Window> {
    const at = { offset: from, limit: positionsOnly ? 0 : undefined, positions: positionsOnly ? true : undefined };
    return aim.kind === 'terminal'
      ? this.reads.terminalBytes({ ...this.address, stream: aim.stream, ...at })
      : this.reads.commandBytes({ ...this.address, stream: aim.stream, ...at });
  }

  private open(generation: number): void {
    const link = this.link;
    if (link === null || !link.ready || this.outputEnded || !this.laned()) return this.subscribe(generation);
    this.following = link;
    this.aligned = false;
    if (this.decided !== undefined) void this.layGrid(this.decided);
    link.follow(this.cursor);
  }

  private laned(): boolean {
    return this.aim.kind === 'terminal' && this.aim.stream === 'pty';
  }

  private offered(): void {
    if (this.subscription === null || this.link === null || !this.link.ready || this.outputEnded || !this.laned()) return;
    this.generation += 1;
    this.release();
    this.open(this.generation);
  }

  private frame(offset: bigint, bytes: Uint8Array): void {
    if (this.following === null) return;
    const cursor = offsetValue(this.cursor);
    if (offset > cursor) {
      if (!this.aligned) return;
      this.following = null;
      void this.catchUp(this.generation);
      return;
    }
    this.aligned = true;
    const end = offset + BigInt(bytes.length);
    if (end <= cursor) return;
    this.cursor = byteOffset(end);
    this.feed(offset === cursor ? bytes : bytes.subarray(Number(cursor - offset)), noCredit, byteOffset(cursor));
  }

  private overtaken(): void {
    if (this.following === null) return;
    this.following = null;
    void this.catchUp(this.generation);
  }

  private drained(): void {
    if (this.following === null) return;
    this.following = null;
    this.outputEnded = true;
    this.subscribe(this.generation);
  }

  private fellBack(): void {
    if (this.following === null) return;
    this.following = null;
    this.subscribe(this.generation);
  }

  private async catchUp(generation: number): Promise<void> {
    const read = await this.replay(generation, false, this.aim, false);
    if (read === 'read' && generation === this.generation) this.open(generation);
  }

  private subscribe(generation: number): void {
    const held = this.live.hold(
      (client) => {
        this.pendingAck = null;
        const at = {
          projectId: this.projectId,
          execution: this.address.execution,
          incarnation: this.address.incarnation,
          offset: this.cursor,
        };
        return this.aim.kind === 'terminal'
          ? client['terminal.bytes.subscribe']({ ...at, stream: this.aim.stream })
          : client['command.bytes.subscribe']({ ...at, stream: this.aim.stream });
      },
      (delivery) => this.deliver(delivery, generation),
      (failure) => {
        if (failure.kind === 'connection') return;
        held.unsubscribe();
        if (this.subscription === held) this.subscription = null;
        void this.recover(generation);
      },
      'bytes',
    );
    this.subscription = held;
  }

  private deliver(delivery: RecordDelivery, generation: number): void | Promise<void> {
    if (generation !== this.generation) return;
    const chunk = delivery.chunk;
    if (chunk._tag === 'Ended') {
      this.release();
      if (chunk.ending === 'unavailable') return this.recover(generation);
      if (chunk.ending === 'gap') return this.follow(this.cursor, true);
      return this.ended(generation);
    }
    if (chunk.range.gap && this.screened(this.aim)) {
      this.release();
      return this.follow(this.cursor, true);
    }
    if (chunk.range.gap) this.note(RETAINED_GAP_LINE);
    const laying = this.lay(chunk.range);
    if (laying === undefined) return this.take(delivery.viewer, chunk, generation);
    return laying.then(() => (generation === this.generation ? this.take(delivery.viewer, chunk, generation) : undefined));
  }

  private take(
    viewer: ViewLeaseId,
    chunk: Extract<RecordDelivery['chunk'], { readonly _tag: 'Bytes' }>,
    generation: number,
  ): void | Promise<void> {
    const bytes = chunk.bytes;
    const offset = chunk.range.next;
    this.cursor = offset;
    if (bytes.length === 0) return;
    return new Promise<void>((resolve) => {
      let credited = false;
      this.feed(
        bytes,
        () => {
          if (credited) return;
          credited = true;
          void this.acknowledge(viewer, offset, generation);
          resolve();
        },
        chunk.range.cursor.offset,
      );
    });
  }

  private async acknowledge(viewer: ViewLeaseId, offset: ByteOffset, generation: number): Promise<void> {
    const parsed = (mark: { readonly viewer: ViewLeaseId; readonly offset: ByteOffset }) =>
      this.aim.kind === 'terminal'
        ? this.live.call((client) => client['terminal.bytes.parsed'](mark))
        : this.live.call((client) => client['command.bytes.parsed'](mark));
    const retry = this.pendingAck;
    this.pendingAck = null;
    if (retry !== null && retry.viewer === viewer) {
      try {
        await parsed(retry);
      } catch {
        void this.recover(generation);
        return;
      }
    }
    try {
      await parsed({ viewer, offset });
    } catch {
      this.pendingAck = { viewer, offset };
    }
  }

  private async ended(generation: number): Promise<void> {
    let ending: ChildEnding = { _tag: 'Unread', problem: 'the exit was not read' };
    for (let attempt = 0; attempt < EXIT_READS; attempt += 1) {
      if (attempt > 0) await recoveryPause(attempt - 1);
      if (generation !== this.generation) return;
      try {
        const native = await (this.aim.kind === 'terminal' ? this.terminalExit() : this.commandExit());
        ending = native._tag !== 'Read' ? native : native.exit === undefined ? { _tag: 'None' } : { _tag: 'Exit', native: native.exit };
        break;
      } catch (error) {
        ending = { _tag: 'Unread', problem: messageOf(error) };
      }
    }
    if (generation !== this.generation) return;
    this.stalled = false;
    this.listener({ _tag: 'Ended', ending });
  }

  private async terminalExit(): Promise<ReadExit> {
    const answer = await this.reads.terminal(this.address);
    if (answer?.endedWithHost === true) return { _tag: 'HostEnded' };
    return { _tag: 'Read', exit: answer?.state?.nativeExit };
  }

  private async commandExit(): Promise<ReadExit> {
    const answer = await this.reads.command(this.address);
    const live = answer?.live;
    if (live === undefined) return { _tag: 'Unread', problem: 'this installation answered no reading for the command' };
    if (live._tag === 'Unheld') {
      return { _tag: 'Unread', problem: 'the host holds nothing under this reference: how it ended can no longer be read' };
    }
    if (live._tag === 'Unavailable') return { _tag: 'Unread', problem: live.detail };
    const exit = live.entry.ending?.nativeExit ?? live.entry.state.nativeExit;
    return { _tag: 'Read', exit };
  }

  private lay(range: RecordRange): Promise<void> | undefined {
    return this.layGrid(range.grid);
  }

  private layGrid(grid: TerminalGeometry | undefined): Promise<void> | undefined {
    if (grid === undefined || sameGeometry(grid, this.laid)) return undefined;
    this.laid = grid;
    const apply = () => this.writer.grid?.(grid);
    if (this.notes.size === 0) {
      apply();
      return undefined;
    }
    return Promise.all([...this.notes]).then(apply);
  }

  private note(text: string): void {
    let parsed = noCredit;
    const settled = new Promise<void>((resolve) => {
      parsed = resolve;
    });
    this.notes.add(settled);
    void settled.then(() => this.notes.delete(settled));
    this.feed(encode(text), parsed);
  }

  private feed(bytes: Uint8Array, parsed: () => void, at?: ByteOffset): void {
    this.fed = true;
    this.writer.write(bytes, parsed, at);
  }

  private release(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.following = null;
  }
}

const noCredit = (): void => undefined;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const decode = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
