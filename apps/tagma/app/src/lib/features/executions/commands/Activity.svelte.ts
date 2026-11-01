import type { CommandRevisionAnswer } from '@runlith/executions/protocol/command';
import type { CommandHostAnswer, CommandReading } from '@tagma/server/executions/contract/wire/commands';
import type { CommandFeedFrame, CommandFeedSnapshot } from '@tagma/server/executions/contract/wire/commandFeed';
import { appliedCommandFeed } from '@tagma/server/executions/commands/feedDelta';
import type { TerminalRow } from '@tagma/server/executions/contract/wire/terminals';
import { Process } from '@runlith/layer/process';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { markCommandFold } from './foldRecord.js';
import { commandLine } from './lines.js';
import { badgeWord, isLive, isQueued, isUnheld, portUrl, type ProcessLine, type ProcessOwner } from '../processes/lines.js';
import { terminalOpens } from '../worktrees/opens.js';
import { formatLimit, formatSpan } from '$lib/shared/figures.js';
import { ExecutionActs, REVISION_REFUSALS } from '../acts.svelte.js';
import { ThreadNames, type OwnerWords } from '$lib/shared/threads/Names.svelte.js';
import { terminalKey, ExecutionsRepo, type CommandFeedKey } from '../Repo.js';

export type CommandScope = { readonly kind: 'thread'; readonly thread: string };

export type ActivityReading =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'stale'; readonly quietMs: number; readonly detail: string | null }
  | { readonly kind: 'partial'; readonly rows: readonly string[]; readonly regions: readonly string[] }
  | { readonly kind: 'host-unavailable'; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly detail: string };

export function silenceOf(reading: ActivityReading): string | null {
  switch (reading.kind) {
    case 'unavailable':
    case 'host-unavailable':
      return reading.detail;
    case 'partial':
      return 'Some process states could not be read.';
    case 'stale':
      return `These rows stand on a reading ${formatSpan(reading.quietMs)} old — nothing has arrived since${
        reading.detail === null ? ', and it is being read again.' : `, and reading it again failed: ${reading.detail}`
      }`;
    default:
      return null;
  }
}

export type LineAct = 'stop' | 'limit';

const PAGE = 200;

const FRAME: CommandFeedKey = { ended: PAGE };

const QUIET_MS = 10_000;

const NO_SOURCES: readonly Source[] = [];
const NO_READINGS: readonly CommandReading[] = [];
const NO_TERMINALS: readonly TerminalRow[] = [];
const NO_LINES: readonly ProcessLine[] = [];

const OPERATOR: ProcessOwner = { thread: null, label: 'Operator', internal: false, archived: false };

type Source =
  | { readonly kind: 'terminal'; readonly key: string; readonly thread: string | null; readonly listing: TerminalRow }
  | { readonly kind: 'command'; readonly key: string; readonly thread: string | null; readonly reading: CommandReading };

type Fold = { readonly buckets: ReadonlyMap<string | null, readonly Source[]> };

type BuiltLines = {
  readonly sources: readonly Source[];
  readonly root: string | null;
  readonly words: OwnerWords | null;
  readonly lines: readonly ProcessLine[];
};

type Walk = { readonly lines: readonly ProcessLine[]; readonly owners: ReadonlyMap<string, readonly ProcessLine[]> };

type Made = { readonly words: OwnerWords | null; readonly root: string | null; readonly line: ProcessLine };

type Owned = { readonly lines: readonly ProcessLine[]; readonly keys: ReadonlySet<string> };

type Reach = { readonly own: readonly ProcessLine[]; readonly away: readonly ProcessLine[]; readonly lines: readonly ProcessLine[] };

export class CommandActivity extends Service<CommandActivity>()('CommandActivity', { tier: 'project' }) {
  static *make() {
    return new CommandActivity(
      yield* ExecutionsRepo,
      yield* Live,
      yield* ProjectRung.Current,
      yield* Scope,
      yield* WallClock,
      yield* Notices,
      yield* Workspace,
      yield* ThreadNames,
      yield* ExecutionActs,
    );
  }

  private feed = $state.raw<CommandFeedSnapshot | null>(null);
  private feedAt = $state<number | null>(null);
  private feedFailure = $state<string | null>(null);
  private readFailure = $state<string | null>(null);
  private stream: { readonly sequence: number; readonly snapshot: CommandFeedSnapshot } | null = null;
  private held: { readonly unsubscribe: () => void } | null = null;
  private closed = false;
  private reading_now: Promise<void> | null = null;
  private watchers = 0;
  private quiet: ReturnType<typeof setInterval> | null = null;
  private readonly slices = new Map<string, BuiltLines>();
  private readonly histories = new Map<string, readonly ProcessLine[]>();
  private readonly made = new WeakMap<CommandReading | TerminalRow, Made>();
  private readonly views = new Map<string, CommandView>();
  private readonly readings = new Set<() => void>();

  readonly roster: readonly TerminalRow[];
  private readonly page: readonly CommandReading[];
  private readonly ended: readonly CommandReading[];
  private readonly host: CommandHostAnswer | undefined;
  private readonly fold: Fold;
  private readonly standing: readonly ProcessLine[];
  private readonly walked: Walk;
  readonly lines: readonly ProcessLine[];
  private readonly byKey: ReadonlyMap<string, ProcessLine>;

  constructor(
    private readonly repo: ExecutionsRepo,
    private readonly live: LiveConnection,
    private readonly aim: ProjectAim,
    private readonly scope: Scope,
    private readonly clock: WallClock,
    private readonly notices: Notices,
    private readonly workspace: Workspace,
    private readonly names: ThreadNames,
    private readonly acts: ExecutionActs,
  ) {
    super();
    this.follow();
    scope.defer(() => {
      this.closed = true;
      this.held?.unsubscribe();
      this.held = null;
      this.readings.clear();
    });
    scope.defer(() => {
      if (this.quiet !== null) clearInterval(this.quiet);
      this.quiet = null;
      this.watchers = 0;
    });
    this.roster = $derived(this.feed?.terminals ?? NO_TERMINALS);
    this.page = $derived(this.feed?.active ?? NO_READINGS);
    this.ended = $derived(this.feed?.ended ?? NO_READINGS);
    this.host = $derived(this.feed?.host);
    this.fold = $derived.by((): Fold => {
      const buckets = new Map<string | null, Source[]>();
      let records = 0;
      for (const source of this.standingSources()) {
        const held = buckets.get(source.thread);
        if (held === undefined) buckets.set(source.thread, [source]);
        else held.push(source);
        records += 1;
      }
      markCommandFold({ owners: buckets.size, records });
      return { buckets };
    });
    this.standing = $derived.by((): readonly ProcessLine[] => {
      const root = this.root;
      const out: ProcessLine[] = [];
      for (const [thread, sources] of this.fold.buckets) {
        const words = thread === null ? null : (this.names.of(thread) ?? null);
        for (const source of sources) out.push(this.lineOf(source, thread, words, root));
      }
      return out;
    });
    this.walked = $derived.by((): Walk => {
      const root = this.root;
      const seen = new Set(this.standing.map((line) => line.key));
      const named = new Map<string, OwnerWords | null>();
      const lines: ProcessLine[] = [];
      const owners = new Map<string, ProcessLine[]>();
      for (const reading of this.ended) {
        const key = terminalKey(reading.command.execution);
        if (seen.has(key)) continue;
        seen.add(key);
        const owner = reading.command.owner;
        const thread = owner._tag === 'Thread' ? owner.thread : null;
        if (thread !== null && !named.has(thread)) named.set(thread, this.names.of(thread) ?? null);
        const line = this.commandOf(reading, thread === null ? null : (named.get(thread) ?? null), root);
        lines.push(line);
        if (thread === null) continue;
        const mine = owners.get(thread);
        if (mine === undefined) owners.set(thread, [line]);
        else mine.push(line);
      }
      return { lines, owners };
    });
    this.lines = $derived([...this.standing, ...this.walked.lines]);
    this.byKey = $derived(new Map(this.lines.map((line) => [line.key, line])));
  }

  private follow(): void {
    if (this.closed) return;
    this.held?.unsubscribe();
    this.stream = null;
    this.held = this.live.hold(
      (client) => client['commands.subscribe']({ projectId: this.aim.projectId, ended: PAGE }),
      (frame) => this.took(frame),
      (failure) => {
        if (failure.kind === 'subscription') this.feedFailure = failure.message;
      },
    );
  }

  private took(frame: CommandFeedFrame): void {
    if (frame._tag === 'Snapshot') {
      this.stream = { sequence: frame.sequence, snapshot: frame.snapshot };
      this.take(frame.snapshot);
      return;
    }
    const standing = this.stream;
    const next = standing !== null && frame.base === standing.sequence ? appliedCommandFeed(standing.snapshot, frame.delta) : undefined;
    if (next === undefined) {
      queueMicrotask(() => this.follow());
      return;
    }
    this.stream = { sequence: frame.sequence, snapshot: next };
    this.take(next);
  }

  private take(frame: CommandFeedSnapshot): void {
    const standing = this.feed;
    if (standing !== null && standing.projectId === frame.projectId && frame.composedAt < standing.composedAt) return;
    this.feedFailure = null;
    this.readFailure = null;
    this.feed = frame;
    this.feedAt = Date.now();
    if (frame.host._tag === 'Answered' && !frame.stale) for (const listener of this.readings) listener();
  }

  onReading(listener: () => void): () => void {
    this.readings.add(listener);
    return () => {
      this.readings.delete(listener);
    };
  }

  get now(): number {
    return this.clock.now;
  }

  watch(): () => void {
    const ticking = this.clock.watch();
    this.watchers += 1;
    if (this.watchers === 1 && this.quiet === null) {
      this.quiet = setInterval(() => void this.reconcile(), QUIET_MS);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers -= 1;
      if (this.watchers === 0 && this.quiet !== null) {
        clearInterval(this.quiet);
        this.quiet = null;
      }
      ticking();
    };
  }

  private async reconcile(): Promise<void> {
    const landed = this.feedAt;
    if (landed === null || Date.now() - landed < QUIET_MS) return;
    if (!this.lines.some(isLive)) return;
    await this.read();
  }

  private read(): Promise<void> {
    const standing = this.reading_now;
    if (standing !== null) return standing;
    const running = (async () => {
      try {
        const frame = await this.repo.commandFeed.key(FRAME).refresh({ throwOnError: true });
        if (frame !== undefined) this.take(frame);
      } catch (error) {
        this.readFailure = error instanceof Error ? error.message : String(error);
      } finally {
        this.reading_now = null;
      }
    })();
    this.reading_now = running;
    return running;
  }

  refresh(): Promise<void> {
    return this.read();
  }

  forThread(thread: string, words: OwnerWords): CommandView {
    const held = this.views.get(thread);
    if (held !== undefined) return held;
    const view = CommandView.start(this.scope, { commands: this, scope: { kind: 'thread', thread }, words });
    this.views.set(thread, view);
    return view;
  }

  get projectId(): number {
    return this.aim.projectId;
  }

  line(key: string): ProcessLine | null {
    return this.byKey.get(key) ?? null;
  }

  linesOf(thread: string, words: OwnerWords | null): readonly ProcessLine[] {
    const sources = this.fold.buckets.get(thread) ?? NO_SOURCES;
    const root = this.root;
    const held = this.slices.get(thread);
    if (held !== undefined && held.root === root && held.words === words && sameSources(held.sources, sources)) {
      return held.lines;
    }
    const lines = sources.map((source) => this.lineOf(source, thread, words, root));
    this.slices.set(thread, { sources, root, words, lines });
    return lines;
  }

  historyOf(thread: string): readonly ProcessLine[] {
    const lines = this.walked.owners.get(thread) ?? NO_LINES;
    const held = this.histories.get(thread);
    if (held !== undefined && sameLines(held, lines)) return held;
    this.histories.set(thread, lines);
    return lines;
  }

  readingFor(lines: readonly ProcessLine[]): ActivityReading {
    if (this.feedFailure !== null) return { kind: 'unavailable', detail: this.feedFailure };
    const host = this.host;
    if (host === undefined) return { kind: 'loading' };
    const quiet = this.quietMs;
    if (quiet !== null && quiet >= QUIET_MS && lines.some(isLive)) {
      return { kind: 'stale', quietMs: quiet, detail: this.readFailure };
    }
    if (host._tag === 'Unavailable') return { kind: 'host-unavailable', detail: host.detail };
    const unreached = lines.filter(isUnheld);
    if (host.unmeasured.length > 0 && unreached.length > 0) {
      return {
        kind: 'partial',
        rows: unreached.map(badgeWord),
        regions: host.unmeasured.map((region) => region.region),
      };
    }
    return { kind: 'ok' };
  }

  async stop(line: ProcessLine): Promise<void> {
    if (line.kind !== 'command' && line.kind !== 'terminal') return;
    const outcome = await this.acts.stop(this.aim.projectId, line.key, { kind: line.kind, execution: line.address });
    if (outcome?._tag === 'Refused') this.notices.error('Stop', `${outcome.code}: ${outcome.reason}`);
  }

  async reviseLimit(line: ProcessLine, executionMs: number): Promise<string | null> {
    const limit = line.limit;
    if (limit === null || line.kind !== 'command') return null;
    const outcome = await this.acts.revise(this.aim.projectId, line.key, line.address, {
      revision: limit.revision,
      ceilingMs: limit.ceilingMs ?? undefined,
      executionMs,
    });
    if (outcome === null) return null;
    if (outcome._tag === 'Refused') return `${outcome.code}: ${outcome.reason}`;
    if (outcome._tag === 'Undecided') return 'The host has not settled this change yet; its life shows what stands once it does.';
    return revisionWords(outcome.answer, isQueued(line));
  }

  private get quietMs(): number | null {
    const landed = this.feedAt;
    if (landed === null) return null;
    void this.clock.now;
    return Math.max(0, Date.now() - landed);
  }

  private get root(): string | null {
    return this.workspace.find(this.aim.projectId)?.rootPath ?? null;
  }

  private standingSources(): readonly Source[] {
    const out: Source[] = [];
    const seen = new Set<string>();
    for (const listing of this.roster) {
      if (listing.record.lifetime !== 'held') continue;
      const address = { execution: listing.record.execution.execution, incarnation: listing.record.execution.incarnation };
      const key = terminalKey(address);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'terminal', key, thread: listing.record.heldBy ?? null, listing });
    }
    for (const reading of this.page) {
      const owner = reading.command.owner;
      const key = terminalKey(reading.command.execution);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'command', key, thread: owner._tag === 'Thread' ? owner.thread : null, reading });
    }
    return out;
  }

  private lineOf(source: Source, thread: string | null, words: OwnerWords | null, root: string | null): ProcessLine {
    if (source.kind === 'command') return this.commandOf(source.reading, words, root);
    return (
      this.madeOf(source.listing, words, root) ??
      this.make(
        source.listing,
        words,
        root,
        terminalLine(source.listing, thread === null ? OPERATOR : this.ownerOf(thread, words), words?.harness ?? false, root),
      )
    );
  }

  private commandOf(reading: CommandReading, words: OwnerWords | null, root: string | null): ProcessLine {
    return (
      this.madeOf(reading, words, root) ?? this.make(reading, words, root, commandLine(reading, this.ownerOfCommand(reading, words), root))
    );
  }

  private madeOf(record: CommandReading | TerminalRow, words: OwnerWords | null, root: string | null): ProcessLine | null {
    const made = this.made.get(record);
    return made !== undefined && made.root === root && sameWords(made.words, words) ? made.line : null;
  }

  private make(record: CommandReading | TerminalRow, words: OwnerWords | null, root: string | null, line: ProcessLine): ProcessLine {
    this.made.set(record, { words, root, line });
    return line;
  }

  private ownerOf(thread: string, words: OwnerWords | null): ProcessOwner {
    return { thread, label: words?.label ?? thread, internal: false, archived: words?.archived ?? false };
  }

  private ownerOfCommand(reading: CommandReading, words: OwnerWords | null): ProcessOwner {
    const owner = reading.command.owner;
    if (owner._tag === 'Thread') return this.ownerOf(owner.thread, words);
    if (owner._tag === 'Service') return { thread: null, label: `service · ${owner.scope}`, internal: false, archived: false };
    return OPERATOR;
  }
}

type ViewBirth = {
  readonly commands: CommandActivity;
  readonly scope: CommandScope;
  readonly words: OwnerWords | null;
};

export class CommandView extends Process<CommandView, ViewBirth>()('CommandView') {
  static override make(birth: ViewBirth): CommandView {
    return new CommandView(birth.commands, birth.scope, birth.words);
  }

  private readonly pending = new SvelteMap<string, LineAct>();
  private reached: Reach | null = null;

  readonly lines: readonly ProcessLine[];
  readonly reading: ActivityReading;
  private readonly history: readonly ProcessLine[];
  private readonly owned: Owned;

  constructor(
    private readonly commands: CommandActivity,
    private readonly scope: CommandScope,
    readonly words: OwnerWords | null,
  ) {
    super();
    this.lines = $derived(this.commands.linesOf(this.scope.thread, this.words));
    this.reading = $derived(this.commands.readingFor(this.lines));
    this.history = $derived(this.commands.historyOf(this.scope.thread));
    this.owned = $derived.by((): Owned => {
      const lines = this.history.length === 0 ? this.lines : [...this.lines, ...this.history];
      return { lines, keys: new Set(lines.map((line) => line.key)) };
    });
  }

  joined(links: Iterable<string>): readonly ProcessLine[] {
    const own = this.owned;
    let asked: Set<string> | null = null;
    let away: ProcessLine[] | null = null;
    for (const key of links) {
      if (own.keys.has(key) || asked?.has(key)) continue;
      (asked ??= new Set()).add(key);
      const line = this.commands.line(key);
      if (line !== null) (away ??= []).push(line);
    }
    if (away === null) return own.lines;
    const held = this.reached;
    if (held !== null && held.own === own.lines && sameLines(held.away, away)) return held.lines;
    const lines = [...own.lines, ...away];
    this.reached = { own: own.lines, away, lines };
    return lines;
  }

  get now(): number {
    return this.commands.now;
  }

  get projectId(): number {
    return this.commands.projectId;
  }

  line(key: string): ProcessLine | null {
    return this.lines.find((line) => line.key === key) ?? this.commands.line(key);
  }

  unconfirmed(line: ProcessLine): string | null {
    if (!isLive(line)) return null;
    const reading = this.commands.readingFor([line]);
    if (reading.kind !== 'ok' && reading.kind !== 'partial') return silenceOf(reading) ?? 'The command feed has not answered yet.';
    return line.live === 'unavailable' ? 'The host is not answering for this command.' : null;
  }

  watch(): () => void {
    return this.commands.watch();
  }

  refresh(): Promise<void> {
    return this.commands.refresh();
  }

  busy(key: string): LineAct | null {
    return this.pending.get(key) ?? null;
  }

  async stop(line: ProcessLine): Promise<void> {
    if (!isLive(line) || this.pending.has(line.key)) return;
    this.pending.set(line.key, 'stop');
    try {
      await this.commands.stop(line);
    } finally {
      this.pending.delete(line.key);
    }
    await this.refresh();
  }

  async reviseLife(line: ProcessLine, executionMs: number): Promise<string | null> {
    if (line.limit === null || line.kind !== 'command' || this.pending.has(line.key)) return null;
    this.pending.set(line.key, 'limit');
    try {
      return await this.commands.reviseLimit(line, executionMs);
    } finally {
      this.pending.delete(line.key);
      await this.refresh();
    }
  }
}

function revisionWords(outcome: CommandRevisionAnswer, queued: boolean): string | null {
  switch (outcome._tag) {
    case 'Revised':
      return null;
    case 'Stale':
      return `Its life moved to ${outcome.deadline.executionMs === undefined ? 'no limit' : formatLimit(outcome.deadline.executionMs)} meanwhile; pick again over what stands now.`;
    case 'Refused':
      return `${REVISION_REFUSALS[outcome.reason]}${queued && outcome.reason === 'not-armed' ? '' : ` ${outcome.detail}`}`.trim();
    case 'Ended':
      return 'The command ended before its life changed.';
  }
}

function sameWords(left: OwnerWords | null, right: OwnerWords | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return left.label === right.label && left.archived === right.archived && left.harness === right.harness;
}

function sameLines(left: readonly ProcessLine[], right: readonly ProcessLine[]): boolean {
  if (left.length !== right.length) return false;
  for (let at = 0; at < left.length; at += 1) if (left[at] !== right[at]) return false;
  return true;
}

function sameSources(left: readonly Source[], right: readonly Source[]): boolean {
  if (left.length !== right.length) return false;
  for (let at = 0; at < left.length; at += 1) {
    const one = left[at] as Source;
    const other = right[at] as Source;
    if (one.kind !== other.kind) return false;
    if (one.kind === 'terminal' ? one.listing !== (other as typeof one).listing : one.reading !== (other as typeof one).reading) {
      return false;
    }
  }
  return true;
}

function terminalLine(listing: TerminalRow, owner: ProcessOwner, outer: boolean, root: string | null): ProcessLine {
  const record = listing.record;
  const address = { execution: record.execution.execution, incarnation: record.execution.incarnation };
  const cwd = record.cwd === undefined || record.cwd === root ? null : record.cwd;
  return {
    key: terminalKey(address),
    address,
    kind: 'terminal',
    transport: record.transport,
    opens: terminalOpens(record),
    printed: listing.printed ?? null,
    owner,
    wait: null,
    phase: listing.state?.phase ?? null,
    live: listing.state === undefined ? 'unavailable' : 'held',
    label: record.label ?? null,
    command: record.commandLine ?? record.program ?? 'shell',
    cwd: record.cwd ?? null,
    note: outer ? 'foreign CLI · outer process only' : cwd,
    ports: [
      ...new Map(
        (listing.listeners?.listeners ?? [])
          .filter((socket) => socket.association !== undefined)
          .map((socket) => [
            `${socket.address}:${socket.port}`,
            { port: socket.port, address: socket.address, url: portUrl(socket.address, socket.port) },
          ]),
      ).values(),
    ],
    startedAt: record.acceptedAt,
    endedAt: null,
    ranMs: null,
    exit: null,
    limit: null,
    waitMs: null,
    stoppedByLimit: false,
    outer,
    unstarted: null,
    place: record.rootId ?? null,
    current: null,
    currentPid: null,
  };
}
