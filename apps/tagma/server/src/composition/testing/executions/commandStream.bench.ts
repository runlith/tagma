import { readFileSync } from 'node:fs';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Clock, Context, Effect, Fiber, Layer, PubSub, Schema, Stream } from 'effect';
import { RpcSerialization } from 'effect/rpc';
import type { CommandEntry, InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { UsageReading } from '@runlith/executions/protocol/evidence';
import type { Commands } from '@runlith/executions/Commands';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import { CommandFeedFrame, CommandFeedSnapshot } from '../../../executions/contract/wire/commandFeed.js';
import type { CommandReading } from '../../../executions/contract/wire/commands.js';
import { liveSerialization } from '../../../platform/contract/wire/live.js';
import { storedCommands } from '../../../executions/testing/doubles.js';
import { noAdopters, sharedCommandFeed } from '../../../executions/testing/doubles.js';
import type { Custody } from '../../../executions/contract/service/custody.js';
import type { ExecutionProcessEvidence } from '../../../executions/contract/service/records.js';
import type { ManagedCommands } from '../../../executions/contract/service/commands.js';
import type { Terminals } from '../../../executions/contract/service/terminals.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { MachineStore } from '../../../platform/contract/service/store.js';

const [capture, pauseArg] = process.argv.slice(2);
if (capture === undefined) throw new Error('usage: bun commandStream.bench.ts <a feed door answer as JSON> [pause ms]');
const PAUSE_MS = Number(pauseArg ?? 25);
const WINDOW = 200;
const FOREIGN = 30;
const ROUNDS = 20;

const sample = Schema.decodeUnknownSync(Schema.fromJsonString(CommandFeedSnapshot))(readFileSync(capture, 'utf8'));
const runningTemplate = sample.active.find((reading) => reading.live._tag === 'Held' && reading.live.entry.usage !== undefined);
const endedTemplate = sample.ended.find((reading) => reading.live._tag === 'Held' && reading.live.entry.ending !== undefined);
if (runningTemplate === undefined || endedTemplate === undefined)
  throw new Error('the capture holds no running command with usage or no ended command with an ending');
const INSTALLATION = runningTemplate.command.execution.installation;
const INCARNATION = runningTemplate.command.execution.incarnation;

type Command = {
  readonly projectId: number;
  readonly id: string;
  readonly admittedAt: number;
  standing: boolean;
  phase: 'queued' | 'running' | 'ended';
  held: boolean;
  taken: number;
};

const main = Effect.gen(function* () {
  const commands = new Map<string, Command>();
  let admitted = 0;
  const admit = (projectId: number, phase: Command['phase'], standing: boolean, held: boolean): Command => {
    admitted += 1;
    const id = `${String(projectId).padStart(2, '0')}-${String(admitted).padStart(6, '0')}-0000-0000-000000000000`;
    const one: Command = { projectId, id, admittedAt: 1_790_000_000_000 + admitted, standing, phase, held, taken: 1 };
    commands.set(id, one);
    return one;
  };

  const refOf = (one: Command): ExecutionRef => ({ ...runningTemplate.command.execution, execution: one.id }) as ExecutionRef;

  const templateOf = (one: Command): CommandReading => (one.phase === 'ended' ? endedTemplate : runningTemplate);

  const recordOf = (one: Command) => {
    const view = templateOf(one).command;
    return {
      ...view,
      projectId: one.projectId,
      execution: refOf(one),
      admittedAt: one.admittedAt,
      targetKey: 'bench',
      holdings: {},
    };
  };

  const waitOf = (one: Command) => (one.standing ? { execution: refOf(one), mode: 'foreground' as const, revision: 0 } : null);

  const entryOf = (one: Command): CommandEntry => {
    const template = templateOf(one);
    if (template.live._tag !== 'Held') throw new Error('the template is not held');
    const entry = template.live.entry;
    const ref = refOf(one);
    const { usage: _usage, ending: _ending, ...bare } = entry;
    return {
      ...bare,
      state: { ...entry.state, ref, phase: one.phase === 'ended' ? 'ended' : one.phase },
      deadline: { ...entry.deadline, execution: ref },
      admittedAtMs: one.admittedAt,
      ending:
        one.phase === 'ended' && endedTemplate.live._tag === 'Held' && endedTemplate.live.entry.ending !== undefined
          ? { ...endedTemplate.live.entry.ending, execution: ref }
          : undefined,
      usage: one.phase === 'running' ? usageOf(one) : undefined,
    } as CommandEntry;
  };

  const usageOf = (one: Command): UsageReading => {
    const live = runningTemplate.live;
    if (live._tag !== 'Held' || live.entry.usage === undefined) throw new Error('the template carries no usage');
    return { ...live.entry.usage, execution: refOf(one), takenAtMicros: one.taken } as UsageReading;
  };

  const counted = {
    pageRows: 0,
    marks: 0,
    status: 0,
    commandsAt: 0,
    refs: 0,
    reports: 0,
    rosters: 0,
  };

  const newestFirst = (left: Command, right: Command): number =>
    right.admittedAt - left.admittedAt || (right.id < left.id ? -1 : right.id > left.id ? 1 : 0);

  const store = {
    commandPage: (
      _unit: unknown,
      projectId: number,
      selection: {
        readonly standing?: boolean;
        readonly order?: string;
        readonly after?: { readonly admittedAt: number; readonly execution: string };
        readonly limit: number;
      },
    ) =>
      Effect.sync(() => {
        const after = selection.after;
        const rows = [...commands.values()]
          .filter((one) => one.projectId === projectId)
          .filter((one) => selection.standing === undefined || one.standing === selection.standing)
          .sort(newestFirst)
          .filter(
            (one) =>
              after === undefined || one.admittedAt < after.admittedAt || (one.admittedAt === after.admittedAt && one.id < after.execution),
          )
          .slice(0, selection.limit)
          .map((one) => ({ record: recordOf(one), wait: waitOf(one) }));
        counted.pageRows += rows.length;
        return rows;
      }),
    commandMarks: (_unit: unknown, projectId: number) =>
      Effect.sync(() => {
        counted.marks += 1;
        const mine = [...commands.values()].filter((one) => one.projectId === projectId);
        return {
          waits: mine
            .filter((one) => one.standing)
            .map((one) => ({ execution: one.id, incarnation: INCARNATION, mode: 'foreground' as const, revision: 0 })),
          newest: mine.sort(newestFirst)[0]?.id ?? null,
        };
      }),
    keyRetention: () => Effect.succeed(sample.operationKeys),
    commandState: (_unit: unknown, id: string) =>
      Effect.sync(() => {
        const one = commands.get(id);
        return one === undefined ? null : { record: recordOf(one), wait: waitOf(one) };
      }),
  };

  const units = { read: (work: (unit: unknown) => unknown) => work({}) } as unknown as MachineUnits['Service'];

  let revision = 1;
  const host = {
    status: () =>
      Effect.sync(() => {
        counted.status += 1;
        return {
          installation: INSTALLATION,
          incarnation: INCARNATION,
          memory: sample.host._tag === 'Answered' ? sample.host.memory : undefined,
        };
      }),
    commandsAt: (refs: readonly ExecutionRef[]) =>
      Effect.sync(() => {
        counted.commandsAt += 1;
        counted.refs += refs.length;
        return {
          commands: refs.flatMap((ref) => {
            const one = commands.get(ref.execution);
            return one === undefined ? [] : [entryOf(one)];
          }),
          revision,
          unmeasured: [],
        };
      }),
  } as unknown as Commands['Service'] & HostLifecycle['Service'];

  const moves: { readonly id: string; readonly revision: number }[] = [];
  const updates = yield* Effect.acquireRelease(PubSub.sliding<InventoryFeedItem>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  yield* PubSub.publish(updates, { _tag: 'Moved', revision, usage: [] });
  const publish = (update: InventoryFeedItem) => PubSub.publish(updates, update);

  const terminals = {
    inventory: () =>
      Effect.sync(() => {
        counted.rosters += 1;
        return { terminals: [], total: 0, stale: false };
      }),
  } as unknown as Terminals['Service'];

  const managed = {
    changes: () => Stream.fromPubSub(updates),
    moves: () =>
      Effect.sync(() => ({
        epoch: 0,
        revision,
        horizon: 0,
        movedAfter: (execution: string, after: number) => moves.some((move) => move.id === execution && move.revision > after),
        holds: (ref: ExecutionRef) => commands.get(ref.execution)?.held === true,
      })),
  } as unknown as ManagedCommands['Service'];

  const custody = { moves: () => Stream.never } as unknown as Custody['Service'];

  const evidence = {
    processes: () =>
      Effect.sync(() => {
        counted.reports += 1;
        return { processes: [] };
      }),
  } as unknown as ExecutionProcessEvidence['Service'];

  const transition = Effect.fnUntraced(function* (one: Command | undefined) {
    revision += 1;
    if (one !== undefined && (one.held || one.phase !== 'queued')) moves.push({ id: one.id, revision });
    yield* publish({ _tag: 'Moved', revision, usage: [] });
  });

  const round = Effect.fnUntraced(function* () {
    const measured = [...commands.values()].filter((one) => one.phase === 'running' && one.held);
    for (const one of measured) one.taken += 1;
    yield* publish({ _tag: 'Moved', revision, usage: measured.map(usageOf) } as InventoryFeedItem);
  });

  const followed = [1, 2];
  for (const projectId of followed) for (let at = 0; at < WINDOW; at += 1) admit(projectId, 'ended', false, false);
  admit(1, 'running', true, true);
  admit(1, 'running', true, true);
  for (let at = 0; at < 10; at += 1) admit(3, 'ended', false, false);

  const serialization = Context.get(yield* Layer.build(liveSerialization), RpcSerialization.RpcSerialization);
  const encode = Schema.encodeUnknownEffect(serialization.codecFor(Schema.NonEmptyArray(CommandFeedFrame)));
  const wire = serialization.makeUnsafe();

  type Tally = { frames: number; bytes: number; largest: number };
  const tallies = new Map<number, Tally>(followed.map((projectId) => [projectId, { frames: 0, bytes: 0, largest: 0 }]));
  const machine = { moves: { answers: () => ({ read: (_key: number, read: unknown) => read }) } } as unknown as MachineStore['Service'];
  const feeds = yield* Effect.gen(function* () {
    const reader = yield* storedCommands({
      commandRows: store as unknown as Parameters<typeof storedCommands>[0]['commandRows'],
      requestKeys: store as unknown as Parameters<typeof storedCommands>[0]['requestKeys'],
      host,
    });
    return yield* sharedCommandFeed({ terminals, evidence, commands: managed, custody, reader });
  }).pipe(Effect.provideService(MachineUnits, units), Effect.provideService(MachineStore, machine));
  const fibers = yield* Effect.forEach(followed, (projectId) =>
    Effect.forkScoped(
      Stream.runForEach(feeds.follow(projectId, { ended: WINDOW }, noAdopters), (frame) =>
        Effect.gen(function* () {
          const packed = wire.encode({ _tag: 'Chunk', requestId: '1', values: yield* encode([frame]) });
          const size = packed === undefined ? 0 : typeof packed === 'string' ? packed.length : packed.byteLength;
          const tally = tallies.get(projectId) as Tally;
          tally.frames += 1;
          tally.bytes += size;
          tally.largest = Math.max(tally.largest, size);
        }),
      ),
    ),
  );

  const pause = () => Effect.sleep(PAUSE_MS);
  const snapshot = () => ({ ...counted, tallies: new Map([...tallies].map(([id, tally]) => [id, { ...tally }])) });
  const phases: { readonly name: string; readonly before: ReturnType<typeof snapshot>; after?: ReturnType<typeof snapshot> }[] = [];
  const phase = Effect.fn('commandStream.phase')(function* (name: string, work: Effect.Effect<void>) {
    const entry: (typeof phases)[number] = { name, before: snapshot() };
    phases.push(entry);
    yield* work;
    yield* pause();
    entry.after = snapshot();
  });

  const started = yield* Clock.currentTimeMillis;
  const cpu = process.cpuUsage();
  yield* phase('open', pause());
  yield* phase(
    `${FOREIGN} transitions in an unfollowed project`,
    Effect.gen(function* () {
      for (let at = 0; at < FOREIGN; at += 1) {
        const one =
          at % 3 === 0
            ? admit(3, 'queued', true, false)
            : [...commands.values()].find((each) => each.projectId === 3 && each.phase !== 'ended');
        if (one !== undefined && at % 3 === 1) {
          one.phase = 'running';
          one.held = true;
        } else if (one !== undefined && at % 3 === 2) {
          one.phase = 'ended';
          one.standing = false;
        }
        yield* transition(one);
        yield* pause();
      }
    }),
  );
  yield* phase(
    'one command of a followed project, admitted to released',
    Effect.gen(function* () {
      const one = admit(1, 'queued', true, false);
      yield* transition(one);
      yield* pause();
      one.phase = 'running';
      one.held = true;
      yield* transition(one);
      yield* pause();
      for (let at = 0; at < 3; at += 1) {
        yield* round();
        yield* pause();
      }
      one.phase = 'ended';
      yield* transition(one);
      yield* pause();
      one.standing = false;
      yield* round();
      yield* pause();
      one.held = false;
      yield* transition(one);
      yield* pause();
    }),
  );
  yield* phase(
    `${ROUNDS} sampling rounds`,
    Effect.gen(function* () {
      for (let at = 0; at < ROUNDS; at += 1) {
        yield* round();
        yield* pause();
      }
    }),
  );
  const elapsed = (yield* Clock.currentTimeMillis) - started;
  const used = process.cpuUsage(cpu);

  for (const fiber of fibers) yield* Fiber.interrupt(fiber);

  const delta = (before: number, after: number) => after - before;
  for (const entry of phases) {
    const after = entry.after as ReturnType<typeof snapshot>;
    const projects = followed.map((projectId) => {
      const was = entry.before.tallies.get(projectId) as Tally;
      const now = after.tallies.get(projectId) as Tally;
      return `project ${projectId}: ${delta(was.frames, now.frames)} frames ${delta(was.bytes, now.bytes)} B (largest ${now.largest} B)`;
    });
    console.log(`${entry.name}`);
    console.log(`  ${projects.join(' · ')}`);
    console.log(
      `  host: ${delta(entry.before.status, after.status)} status · ${delta(entry.before.commandsAt, after.commandsAt)} CommandsAt · ${delta(entry.before.refs, after.refs)} refs · ${delta(entry.before.reports, after.reports)} process reports`,
    );
    console.log(
      `  server: ${delta(entry.before.pageRows, after.pageRows)} stored rows decoded · ${delta(entry.before.marks, after.marks)} marks · ${delta(entry.before.rosters, after.rosters)} rosters`,
    );
  }
  const total = followed.map((projectId) => {
    const tally = tallies.get(projectId) as Tally;
    return `project ${projectId}: ${tally.frames} frames ${tally.bytes} B`;
  });
  console.log(
    `total · ${total.join(' · ')} · host ${counted.status} status ${counted.commandsAt} CommandsAt ${counted.refs} refs · server ${counted.pageRows} stored rows · ${Math.round(elapsed)} ms wall · ${Math.round((used.user + used.system) / 1000)} ms cpu`,
  );
});

BunRuntime.runMain(main.pipe(Effect.scoped));
