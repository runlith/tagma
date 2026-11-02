import { dirname } from 'node:path';
import { Effect, FileSystem, Fiber, Layer, Option, Result, type Scope, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { Git } from '@runlith/git/Git';
import type { workingAt } from '@runlith/files/working';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '@runlith/agent/ToolOutputSpool';
import type { CallProgress } from '@runlith/agent/callProgress';
import type { CallDecision, CallDecisionAnswer, CallRetention, SourceCompletion } from '@runlith/executions/protocol/call';
import type { CommandClass, CommandExit } from '@runlith/executions/protocol/command';
import type { Cleanup, NativeExit, ProcessCost } from '@runlith/executions/protocol/execution';
import { CheckoutBaselines, headMove, type HeadMove } from './CheckoutBaselines';
import { movedPaths, placeOf, readingNow, unkept, type Measured, type Reading, type Seen } from './checkoutState';
import { cleanupWords, type CommandRun, type KeptOutput, type RuledAnswer } from './CommandWork';
import type { ProcessRuling, RuleNamed } from '@runlith/executions/protocol/stop';
import type {
  CommandBase,
  CommandContent,
  CommandFacts,
  CommandLife,
  CommandMove,
  CommandVerdict,
  CommandWindow,
  Unplaced,
} from './WorkspaceChanges';
import type { ResolvedToolOptions, ToolEnvCall } from './workspace';
import type { ToolShown } from '@runlith/agent/tool';
import { commandClass } from './commandClass';
import { shellShown } from './shellShown';

export class OutputTail {
  private readonly bytes = new Uint8Array(TOOL_OUTPUT_MAX_BYTES);
  private readonly encoder = new TextEncoder();
  private start = 0;
  private length = 0;
  private newlines = 0;
  private cut = false;

  get dropped(): boolean {
    return this.cut;
  }

  append(chunk: Uint8Array): void {
    for (const byte of chunk) {
      if (this.length === this.bytes.length) this.drop();
      this.bytes[(this.start + this.length) % this.bytes.length] = byte;
      this.length += 1;
      if (byte === 0x0a) this.newlines += 1;
      while (this.newlines >= TOOL_OUTPUT_MAX_LINES) this.drop();
    }
  }

  appendText(text: string): void {
    this.append(this.encoder.encode(text));
  }

  text(): string {
    const contiguous = new Uint8Array(this.length);
    const first = Math.min(this.length, this.bytes.length - this.start);
    contiguous.set(this.bytes.subarray(this.start, this.start + first));
    if (first < this.length) contiguous.set(this.bytes.subarray(0, this.length - first), first);
    let readable = 0;
    while (readable < contiguous.length && ((contiguous[readable] as number) & 0xc0) === 0x80) readable += 1;
    return new TextDecoder().decode(contiguous.subarray(readable));
  }

  private drop(): void {
    if (this.length === 0) return;
    this.cut = true;
    if (this.bytes[this.start] === 0x0a) this.newlines -= 1;
    this.start = (this.start + 1) % this.bytes.length;
    this.length -= 1;
  }
}

export const PLATFORM_COST: ProcessCost = {
  _tag: 'Unmeasured',
  reason: 'unsupported',
  detail: 'a child of this process is spawned through a handle that reports no resource accounting',
};

export type EndingSource = 'local' | 'owner';

export type Settled = {
  readonly source: EndingSource;
  readonly code: number | null;
  readonly signalDeath: string | null;
  readonly signalName: string | null;
  readonly cost: ProcessCost;
  readonly expired: boolean;
  readonly aborted: string | null;
  readonly stopped: string | null;
  readonly notStarted: string | null;
  readonly unconfirmed: string | null;
  readonly disclosed: readonly string[];
};

export const localRunning: Settled = {
  source: 'local',
  code: null,
  signalDeath: null,
  signalName: null,
  cost: PLATFORM_COST,
  expired: false,
  aborted: null,
  stopped: null,
  notStarted: null,
  unconfirmed: null,
  disclosed: [],
};

const ownedRunning: Settled = { ...localRunning, source: 'owner' };

const decisionText = (decision: CallDecision): string =>
  decision._tag === 'Completed' ? 'completed' : `cancelled (${decision.cause}: ${decision.trigger})`;

export function settleManaged(result: RuledAnswer, timeoutSource: EndingSource): Settled {
  const settled = settleCall(result, timeoutSource);
  const ruled = result.ruled === undefined ? [] : rulingLines(result.ruled.rulings, result.ruled.omitted);
  return ruled.length === 0 ? settled : { ...settled, disclosed: [...settled.disclosed, ...ruled] };
}

const limitSpoken = (ms: number): string =>
  ms % 3_600_000 === 0
    ? `${ms / 3_600_000} h`
    : ms % 60_000 === 0
      ? `${ms / 60_000} min`
      : ms % 1_000 === 0
        ? `${ms / 1_000} s`
        : `${ms} ms`;

const ruleSpoken = (rule: RuleNamed): string =>
  `program rule ${rule.id} ("${rule.words.join(' ')}"${rule.folder === undefined ? '' : ` in ${rule.folder}`}, ${limitSpoken(rule.limitMs)})`;

export const rulingLines = (rulings: ReadonlyArray<ProcessRuling>, omitted: number): string[] => [
  ...rulings.map((ruling) => {
    switch (ruling._tag) {
      case 'Ending':
        return `The ${ruleSpoken(ruling.rule)} ran out for ${ruling.process}, which was still being stopped when this was read.`;
      case 'Ended':
        return ruling.step === 'unsignalled'
          ? `The ${ruleSpoken(ruling.rule)} ran out for ${ruling.process}, which was gone before any signal.`
          : `The ${ruleSpoken(ruling.rule)} ran out and ended ${ruling.process} at ${ruling.step}.`;
      case 'Survived':
        return `The ${ruleSpoken(ruling.rule)} ran out and could not end ${ruling.process}: it survived ${ruling.steps.join(' then ')}.`;
      case 'Unverifiable':
        return `The ${ruleSpoken(ruling.rule)} ran out for ${ruling.process}, and whether it ended is not known: ${ruling.reason}.`;
      case 'Unread':
        return `${ruling.process} could not be read (${ruling.fields.join(', ')}), so no program rule could reach it.`;
    }
  }),
  ...(omitted === 0 ? [] : [`${omitted} more process${omitted === 1 ? '' : 'es'} a program rule ended or could not read are not listed.`]),
];

function settleCall(result: CallDecisionAnswer, timeoutSource: EndingSource): Settled {
  if (result._tag === 'Unavailable') {
    const known = result.lastKnown === undefined ? '' : ` The last decision it holds is ${decisionText(result.lastKnown)}.`;
    const where = result.execution === undefined ? '' : `, execution ${result.execution.execution}`;
    return {
      ...ownedRunning,
      cost: { _tag: 'Unmeasured', reason: 'unknown', detail: `the execution host could not answer: ${result.reason}` },
      unconfirmed: `The execution host could not answer for this command: ${result.reason}. Operation ${result.operation.operation}${where}.${known} Whether it finished, and with what, is not known — and it was not run again to find out.`,
    };
  }
  const disclosed = disclosures(result.retention, result.cleanup);
  if (result._tag === 'Undecided') {
    return withExit({ ...ownedRunning, cost: result.cost, disclosed: [...disclosed, ...survivors(result.sources)] }, result.nativeExit);
  }
  const { decision } = result;
  const measured = { ...ownedRunning, disclosed, cost: result.cost };
  if (decision._tag === 'Cancelled') {
    if (decision.cause === 'not-started') return { ...measured, notStarted: decision.trigger };
    if (decision.cause === 'timeout') return { ...measured, source: timeoutSource, expired: true };
    if (decision.cause === 'run-abort') return { ...measured, aborted: decision.trigger };
    return { ...measured, stopped: `${decision.cause}: ${decision.trigger}` };
  }
  if (result.nativeExit === undefined) {
    return {
      ...measured,
      unconfirmed: `The execution host decided this command completed, but no exit status was ever read for it. Operation ${decision.operation.operation}, execution ${decision.execution.execution}.`,
    };
  }
  return withExit(measured, result.nativeExit);
}

const disclosures = (retention: CallRetention, cleanup: Cleanup): string[] => [
  ...(retention === 'retained'
    ? []
    : [
        `Output was ${retention === 'lost' ? 'lost' : 'kept only in part'} by the execution record: what is printed above may not be everything the command wrote.`,
      ]),
  ...[cleanupWords(cleanup)].filter((words) => words !== null),
];

const survivors = (sources: SourceCompletion): string[] => {
  const open = [...(sources.stdout.completed ? [] : ['stdout']), ...(sources.stderr.completed ? [] : ['stderr'])];
  return open.length === 0
    ? []
    : [
        `Something this command started outlived it and still holds its ${open.join(' and ')} open. The command's own leader exited with the status above, and that exit is the answer; the owner's record of the call closes only when those pipes do, and whatever the survivor writes is not in the output here.`,
      ];
};

const withExit = (settled: Settled, exit: NativeExit): Settled =>
  exit._tag === 'Code'
    ? { ...settled, code: exit.code }
    : {
        ...settled,
        signalName: exit.signal,
        signalDeath: `Process interrupted due to receipt of signal: '${exit.signal}'`,
      };

export function endingOf(settled: Settled): CommandExit {
  if (settled.signalName !== null) return { _tag: 'Signal', signal: settled.signalName };
  if (settled.code !== null) return { _tag: 'Code', code: settled.code };
  if (settled.signalDeath !== null) {
    return { _tag: 'Unknown', detail: 'the child died by a signal this spawner does not name' };
  }
  if (settled.notStarted !== null) return { _tag: 'Unknown', detail: `it never started: ${settled.notStarted}` };
  if (settled.expired) return { _tag: 'Unknown', detail: 'it was stopped when its wait or life ran out, and no exit was read' };
  if (settled.aborted !== null) return { _tag: 'Unknown', detail: `the run was aborted and no exit was read: ${settled.aborted}` };
  if (settled.stopped !== null) return { _tag: 'Unknown', detail: `ended by its owner: ${settled.stopped}` };
  return { _tag: 'Unknown', detail: settled.unconfirmed ?? 'no ending was read for this command' };
}

export type CheckoutMeasure = {
  readonly tree: string | null;
  readonly own: boolean;
  readonly moved: readonly string[];
  readonly head: HeadMove | null;
  readonly verdicts: readonly CommandVerdict[];
  readonly unread: readonly string[];
  readonly unmeasured: string | null;
};

const unmeasuredAt = (tree: string | null, own: boolean, reason: string): CheckoutMeasure => ({
  tree,
  own,
  moved: [],
  head: null,
  verdicts: [],
  unread: [],
  unmeasured: reason,
});

export type ShellSettlement = {
  readonly settled: Settled;
  readonly stdout: string;
  readonly stderr: string;
  readonly cut: boolean;
  readonly kept: KeptOutput | null;
  readonly outputUnavailable: string | null;
  readonly checkouts: readonly CheckoutMeasure[];
  readonly inspect: string | null;
  readonly shown: readonly ToolShown[];
  readonly unseen: string | null;
};

const UNSEEN: ReadonlySet<string> = new Set(['NotFound', 'PermissionDenied', 'BadResource', 'BadArgument']);

const isFile = (fs: FileSystem.FileSystem) => (path: string) =>
  fs.stat(path).pipe(
    Effect.map((info) => info.type === 'File'),
    Effect.catchIf(
      (error) => UNSEEN.has(error.reason._tag),
      () => Effect.succeed(false),
    ),
  );

const inWindow = (window: CommandWindow, at: number | null): at is number =>
  at !== null && Math.floor(at) >= window.from && Math.floor(at) <= window.to;

const instantOf = (stamp: number | null | undefined): number | null =>
  stamp === null || stamp === undefined || stamp % 1000 === 0 ? null : stamp;

const parentWrites = Effect.fn('ShellRun.parentWrites')(function* (
  root: string,
  names: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, number | null>, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const directories = [
    ...new Set(
      names.flatMap((name) => {
        const file = placeOf(root, name);
        return file === null ? [] : [dirname(file.place)];
      }),
    ),
  ];
  const stamped = new Map<string, number | null>();
  yield* Effect.forEach(
    directories,
    (directory) =>
      fs.stat(directory).pipe(
        Effect.map((info) => Option.match(info.mtime, { onNone: () => null, onSome: (at) => at.getTime() })),
        Effect.catchTag('PlatformError', () => Effect.succeed(null)),
        Effect.map((at) => {
          stamped.set(directory, at);
        }),
      ),
    { concurrency: 3, discard: true },
  );
  return stamped;
});

const movesOf = Effect.fn('ShellRun.movesOf')(function* (
  root: string,
  before: Measured,
  after: Measured,
  moved: readonly string[],
  working: typeof workingAt | undefined,
): Effect.fn.Return<{ readonly moves: readonly CommandMove[]; readonly unread: readonly string[] }, never, FileSystem.FileSystem> {
  const window: CommandWindow = { from: before.startedAt, to: after.endedAt };
  const ran: CommandWindow = { from: before.startedAt, to: after.startedAt };
  const unread: string[] = [];
  const fs = yield* FileSystem.FileSystem;
  const settled = new Map<string, { readonly digest: string; readonly present: boolean | null; readonly seen: Seen | null }>();
  for (const name of moved) {
    if (after.state.has(name)) continue;
    const file = placeOf(root, name);
    if (file !== null) settled.set(name, yield* readingNow(fs, file.place, working));
  }
  const digestOf = (name: string): string | undefined => after.state.get(name) ?? settled.get(name)?.digest;
  const presenceOf = (name: string): boolean | null | undefined =>
    after.state.has(name) ? after.presence.get(name) : settled.get(name)?.present;
  const seenOf = (name: string): Seen | undefined => after.seen.get(name) ?? settled.get(name)?.seen ?? undefined;
  const standing = moved.filter((name) => {
    if (digestOf(name) === undefined) return false;
    if (presenceOf(name) === null || before.presence.get(name) === null) {
      unread.push(name);
      return false;
    }
    return before.state.get(name) !== digestOf(name) || before.presence.get(name) !== presenceOf(name);
  });
  const unstamped = standing.filter((name) => presenceOf(name) !== true);
  const parents = unstamped.length === 0 ? new Map<string, number | null>() : yield* parentWrites(root, unstamped);
  const moves = standing.map((name): CommandMove => {
    const seen = seenOf(name);
    const own = instantOf(seen?.mtimeMs);
    const changed = instantOf(seen?.changedMs);
    const at = inWindow(window, own) ? own : inWindow(ran, changed) ? changed : null;
    const file = placeOf(root, name);
    const parent = file === null ? null : (parents.get(dirname(file.place)) ?? null);
    const heard = after.heard.get(name);
    const kept = own === null || own < window.from;
    return {
      name,
      before: before.state.get(name) ?? null,
      after: digestOf(name) as string,
      present: presenceOf(name) === true,
      existed: before.state.has(name) ? before.presence.get(name) === true : null,
      written:
        at !== null
          ? { from: at, to: at }
          : kept && heard !== undefined && heard.to >= window.from && heard.from <= window.to
            ? { from: Math.max(heard.from, window.from), to: Math.min(heard.to, window.to) }
            : inWindow(window, parent)
              ? { from: window.from, to: parent }
              : null,
      bytes: seen?.bytes ?? null,
      link: seen?.link ?? false,
      mode: seen?.mode ?? null,
    };
  });
  return { moves, unread };
});

const baseOf = (root: string, measured: Measured): CommandBase => {
  const contents = new Map<string, CommandContent>();
  for (const [name, digest] of measured.state) {
    const seen = measured.seen.get(name);
    if (measured.presence.get(name) !== true || seen?.link) continue;
    if (seen?.bytes != null) contents.set(digest, { bytes: seen.bytes });
    else if (!contents.has(digest)) {
      const file = placeOf(root, name);
      if (file !== null) contents.set(digest, { file: file.place });
    }
  }
  return {
    head: 'commit' in measured.head ? measured.head.commit : null,
    at: measured.startedAt,
    dirty: new Map([...measured.state].map(([name, digest]) => [name, { digest, present: measured.presence.get(name) ?? null }])),
    contents,
  };
};

export type ShellTree = { readonly tree: string; readonly ours: boolean };

export type ShellPlace = {
  readonly trees: readonly ShellTree[];
  readonly refused: string | null;
  readonly measuring: boolean;
  readonly facts: CommandFacts;
  readonly ran: string | null;
  readonly unplaced: readonly Unplaced[];
};

type Opening = {
  readonly tree: string;
  readonly own: boolean;
  readonly life: CommandLife | null;
  release: (() => void) | null;
};

type Side = Opening & { readonly before: Reading };

type SideSettled = { readonly measure: CheckoutMeasure; readonly attributed: readonly ToolShown[] };

const measuringWords = (count: number, when: string): string =>
  count === 1 ? `Measuring the checkout ${when} the command` : `Measuring ${count} checkouts ${when} the command`;

export class ShellRun {
  private readonly out = new OutputTail();
  private readonly errors = new OutputTail();
  private sides: Side[] = [];
  private refused: string | null = null;
  private unplaced: readonly Unplaced[] = [];
  private openedAt: number | null = null;
  private inspection: string | null = null;
  private kept: KeptOutput | null = null;
  public elsewhere: string | null = null;
  readonly env: Record<string, string | undefined>;

  constructor(
    private readonly resolved: ResolvedToolOptions,
    private readonly baselines: CheckoutBaselines,
    private readonly services: Layer.Layer<FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git>,
    private readonly workdir: string,
    private readonly command: string,
    private readonly progress?: CallProgress,
    call?: ToolEnvCall,
  ) {
    const extra = call === undefined ? {} : resolved.callEnv(call);
    this.env = { ...resolved.env, ...extra };
    this.kind = commandClass(command);
  }

  private readonly kind: CommandClass;

  readonly open = Effect.fn('ShellRun.open')(function* (
    this: ShellRun,
    where: ShellPlace,
  ): Effect.fn.Return<void, never, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git> {
    this.unplaced = where.unplaced;
    if (where.refused !== null) {
      this.refused = where.refused;
      return;
    }
    if (!where.measuring) return;
    const command = this.resolved.changes?.command;
    const sides: (Opening | Side)[] = [];
    for (const { tree, ours } of where.trees) {
      const opened = command === undefined ? null : yield* Effect.result(command(tree, where.facts));
      if (opened !== null && opened._tag === 'Failure') {
        const before = { unreadable: `the change record could not open this command: ${opened.failure.reason}` };
        sides.push({ tree, own: ours, life: null, release: null, before });
        continue;
      }
      const life = opened === null ? null : opened.success;
      if (life === null && !ours) continue;
      sides.push({ tree, own: ours, life, release: yield* this.baselines.hold(tree) });
    }
    this.elsewhere = where.ran !== null && !sides.some((side) => side.tree === where.ran) ? where.ran : null;
    const reading = sides.filter((side) => !('before' in side)).length;
    if (reading > 0) this.progress?.stage(measuringWords(reading, 'before'));
    this.sides = yield* Effect.forEach(sides, (side) => ('before' in side ? Effect.succeed(side) : this.based(side)), {
      concurrency: 'unbounded',
    });
  });

  private readonly based = Effect.fnUntraced(function* (
    this: ShellRun,
    opening: Opening,
  ): Effect.fn.Return<Side, never, FileSystem.FileSystem | Git> {
    const before = yield* this.baselines.measure(opening.tree, this.resolved);
    if (opening.life !== null && 'state' in before) yield* opening.life.based(baseOf(opening.tree, before));
    return { ...opening, before: unkept(before) };
  });

  readonly opened = (): void => {
    this.openedAt = performance.now();
    for (const side of this.sides) side.life?.opened();
  };

  readonly ended = (): void => {
    for (const side of this.sides) side.life?.ended();
  };

  readonly close = (): void => {
    this.leave((life) => life.close());
  };

  readonly forget = (): void => {
    this.leave((life) => life.forget());
  };

  private readonly leave = (end: (life: CommandLife) => void): void => {
    for (const side of this.sides) {
      if (side.life !== null) end(side.life);
      const release = side.release;
      side.release = null;
      release?.();
    }
  };

  readonly collector = (
    stdout: Stream.Stream<Uint8Array, unknown>,
    stderr: Stream.Stream<Uint8Array, unknown>,
  ): Effect.Effect<void, unknown> =>
    Effect.all(
      [
        stdout.pipe(
          Stream.runForEach((bytes) => Effect.sync(() => this.out.append(bytes))),
          Effect.result,
        ),
        stderr.pipe(
          Stream.runForEach((bytes) => Effect.sync(() => this.errors.append(bytes))),
          Effect.result,
        ),
      ],
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.flatMap((collected) => Effect.fromResult(Result.all(collected))),
      Effect.asVoid,
    );

  readonly joinCollector = <A, E>(collector: Fiber.Fiber<A, E>, settled: Settled): Effect.Effect<Settled> =>
    Effect.result(Fiber.join(collector)).pipe(
      Effect.map((joined) =>
        joined._tag === 'Failure' ? { ...settled, disclosed: [...settled.disclosed, partialOutput(joined.failure)] } : settled,
      ),
    );

  readonly observe = Effect.fnUntraced(function* (this: ShellRun, run: CommandRun): Effect.fn.Return<ShellSettlement> {
    return yield* this.watch(run).pipe(Effect.scoped, Effect.ensuring(Effect.sync(() => this.close())), Effect.provide(this.services));
  });

  private readonly watch = Effect.fnUntraced(function* (
    this: ShellRun,
    run: CommandRun,
  ): Effect.fn.Return<ShellSettlement, never, Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git> {
    this.inspection = run.inspect;
    const collector = yield* Effect.forkScoped(this.collector(run.stdout, run.stderr));
    const answer = yield* Effect.result(run.result);
    this.ended();
    if (answer._tag === 'Failure') {
      return yield* this.finish({
        ...ownedRunning,
        unconfirmed: `The decision for this command could not be read back: ${answer.failure.reason}. Whether it finished, and with what, is not known — and it was not run again to find out.`,
      });
    }
    const decided = settleManaged(answer.success, 'owner');
    const settled = decided.notStarted === null ? decided : { ...decided, notStarted: `${decided.notStarted}. ${run.inspect}` };
    const joined = settled.code !== null || settled.signalDeath !== null ? yield* this.joinCollector(collector, settled) : settled;
    this.kept = answer.success.kept ?? null;
    return yield* this.finish(joined);
  });

  readonly finish = (
    settled: Settled,
  ): Effect.Effect<ShellSettlement, never, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git> =>
    this.settle(settled).pipe(Effect.ensuring(Effect.sync(() => this.close())));

  private readonly settle = Effect.fn('ShellRun.finish')(function* (
    this: ShellRun,
    settled: Settled,
  ): Effect.fn.Return<ShellSettlement, never, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git> {
    this.ended();
    const commands = this.resolved.world.commands;
    if (commands !== undefined && this.openedAt !== null) {
      yield* commands.finished({
        class: this.kind,
        monotonicStart: this.openedAt,
        monotonicEnd: performance.now(),
        exit: endingOf(settled),
        cost: settled.cost,
      });
    }
    const reading = this.sides.filter((side) => 'state' in side.before).length;
    if (reading > 0) this.progress?.stage(measuringWords(reading, 'after'));
    const sides = yield* Effect.forEach(this.sides, (side) => this.measured(side), { concurrency: 'unbounded' });
    const stdout = this.out.text();
    const stderr = this.errors.text();
    const fs = yield* FileSystem.FileSystem;
    const attributed = sides.flatMap((side) => side.attributed);
    const sighted = yield* Effect.result(
      shellShown(
        {
          command: this.command,
          output: `${stdout}\n${stderr}`,
          cwd: this.workdir,
          root: this.resolved.cwd,
          home: this.env.HOME ?? this.resolved.world.environment.home,
        },
        isFile(fs),
      ),
    );
    return {
      settled,
      stdout,
      stderr,
      cut: this.out.dropped || this.errors.dropped,
      kept: this.kept,
      outputUnavailable: null,
      checkouts: [
        ...(this.refused === null ? [] : [unmeasuredAt(null, true, this.refused)]),
        ...sides.map((side) => side.measure),
        ...this.unplaced.map((one) => unmeasuredAt(one.path, false, `its checkout could not be read: ${one.reason}`)),
      ],
      inspect: this.inspection,
      shown: sighted._tag === 'Success' ? [...sighted.success, ...attributed] : attributed,
      unseen: sighted._tag === 'Success' ? null : sighted.failure.message,
    };
  });

  private readonly measured = Effect.fnUntraced(function* (
    this: ShellRun,
    side: Side,
  ): Effect.fn.Return<SideSettled, never, FileSystem.FileSystem | Git> {
    const before = side.before;
    if ('unreadable' in before) return { measure: unmeasuredAt(side.tree, side.own, before.unreadable), attributed: [] };
    const after = yield* this.baselines.measure(side.tree, this.resolved);
    if ('unreadable' in after) return { measure: unmeasuredAt(side.tree, side.own, after.unreadable), attributed: [] };
    const moved = movedPaths(before, after);
    const found = yield* movesOf(side.tree, before, after, moved, this.resolved.world.working);
    const changed = new Set([...found.moves.map((move) => move.name), ...found.unread]);
    const verdicts =
      side.life === null
        ? []
        : yield* side.life.settle({
            base: 'commit' in before.head ? before.head.commit : null,
            window: { from: before.startedAt, to: after.endedAt },
            moves: found.moves,
          });
    const attributed = verdicts.flatMap((one) => {
      const file = one.verdict === 'attributed' ? placeOf(side.tree, one.name) : null;
      return file === null ? [] : [{ path: file.place, as: 'wrote' as const }];
    });
    return {
      measure: {
        tree: side.tree,
        own: side.own,
        moved: moved.filter((name) => changed.has(name)),
        head: headMove(before, after),
        verdicts,
        unread: found.unread,
        unmeasured: null,
      },
      attributed,
    };
  });
}

const partialOutput = (error: unknown): string => {
  const spoken = error as { readonly reason?: unknown; readonly message?: unknown };
  const detail =
    typeof spoken.reason === 'string' && spoken.reason !== ''
      ? spoken.reason
      : typeof spoken.message === 'string' && spoken.message !== ''
        ? spoken.message
        : 'the stream gave no reason';
  return `What is printed above may not be everything the command wrote — ${detail}`;
};

export const observerLost = (reason: string): ShellSettlement => ({
  settled: {
    ...ownedRunning,
    unconfirmed: `What was observing this command stopped being reachable: ${reason}. Whether it finished, and with what, is not known — and it was not run again to find out.`,
  },
  stdout: '',
  stderr: '',
  cut: false,
  kept: null,
  outputUnavailable: `The output of this command is unavailable: ${reason}.`,
  checkouts: [unmeasuredAt(null, true, `the observation of this command was lost: ${reason}`)],
  inspect: null,
  shown: [],
  unseen: null,
});
