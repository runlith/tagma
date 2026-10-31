import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Stream } from 'effect';
import { sql } from 'drizzle-orm';
import { WireUnavailable } from '@runlith/executions/Executions';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions } from '@runlith/executions/Executions';
import type { ExecutionCustody } from '@runlith/executions/ExecutionCustody';
import type { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionRecord } from '@runlith/executions/ExecutionRecord';
import type { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import type { TerminalScreen } from '@runlith/executions/TerminalScreen';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import type { CommandBatch, CommandEntry, CommandRefs } from '@runlith/executions/protocol/inventory';
import type { RuntimeStatus } from '@runlith/executions/protocol/runtime';
import { graphFixture } from '../graphFixture.js';
import type { CommandRecord } from '../../../executions/contract/wire/commands.js';
import type { CommandCursor, CommandListAnswer } from '../../../executions/contract/wire/commands.js';
import { storedCommands } from '../../../executions/testing/doubles.js';
import { storesOver } from '../../../executions/testing/stores.js';
const installation = InstallationId.make('command-reader');

let held: readonly string[] = [];
let hostFails = false;
const batchWidths: number[] = [];
const askedRefs: string[] = [];
let batchRevisions: number[] | null = null;

const unavailable = () =>
  Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'the host was not asked in this case', sent: false }));

let hostIncarnation = 0;

const status = (): RuntimeStatus =>
  ({
    installation,
    incarnation: hostIncarnation,
    phase: 'open',
    holder: { _tag: 'Standing' },
    custody: { _tag: 'Held', holder: 'custodian' },
    executions: 0,
    memory: { grant: 0, reserved: 0, retained: 0, executions: 0 },
  }) as unknown as RuntimeStatus;

const entry = (execution: string): CommandEntry =>
  ({
    admission: {
      origin: { scope: 's', owner: 'o', cohort: 'c' },
      limits: { executionMs: 1000, executionCeilingMs: 2000, origin: 'rule' },
      policyIdentity: 'policy',
    },
    state: {
      ref: { installation, execution: ExecutionId.make(execution), incarnation: 0 },
      transport: 'pipes',
      lifetime: 'call',
      purpose: 'command',
      phase: 'running',
      streams: { stdout: { _tag: 'Open' }, stderr: { _tag: 'Open' }, pty: { _tag: 'Open' } },
      cleanup: { _tag: 'Complete' },
      record: { _tag: 'Retained' },
    },
    deadline: {
      execution: { installation, execution: ExecutionId.make(execution), incarnation: 0 },
      revision: 0,
      executionMs: 1000,
      ceilingMs: 2000,
      origin: 'rule',
    },
    admittedAtMs: 1,
  }) as unknown as CommandEntry;

const host: Executions['Service'] &
  Commands['Service'] &
  ExecutionRequest['Service'] &
  ExecutionRecord['Service'] &
  ExecutionFeed['Service'] &
  TerminalScreen['Service'] &
  TerminalInput['Service'] &
  ExecutionCustody['Service'] &
  ExecutionEvidence['Service'] &
  HostAuthority['Service'] &
  HostLifecycle['Service'] = {
  status: () => (hostFails ? unavailable() : Effect.succeed(status())),
  commandsAt: (refs: CommandRefs) => {
    if (hostFails) return unavailable();
    batchWidths.push(refs.length);
    askedRefs.push(...refs.map((ref) => ref.execution as string));
    return Effect.succeed({
      commands: refs.filter((ref) => held.includes(ref.execution)).map((ref) => entry(ref.execution)),
      revision: batchRevisions?.shift() ?? 7,
      unmeasured: [],
    } satisfies CommandBatch);
  },
  capabilities: unavailable,
  generation: unavailable,
  served: unavailable,
  list: unavailable,
  changes: unavailable,
  state: unavailable,
  ending: unavailable,
  retained: unavailable,
  command: unavailable,
  commands: unavailable,
  revise: unavailable,
  operation: unavailable,
  preventStop: unavailable,
  callResult: unavailable,
  start: unavailable,
  cancelStart: unavailable,
  read: unavailable,
  subscribe: () => Stream.fromEffect(unavailable()),
  screen: unavailable,
  point: unavailable,
  input: unavailable,
  signal: unavailable,
  stop: unavailable,
  retire: unavailable,
  processes: unavailable,
  foreground: unavailable,
  listeners: unavailable,
  hostListeners: unavailable,
  custody: unavailable,
  take: unavailable,
  fence: unavailable,
  release: unavailable,
  grant: unavailable,
  openBinding: unavailable,
  closeBinding: unavailable,
  quiesce: unavailable,
  resume: unavailable,
  prepare: unavailable,
  yield: unavailable,
  shutdown: unavailable,
  pace: unavailable,
  disown: unavailable,
  endResidual: unavailable,
  endProcess: unavailable,
  load: unavailable,
};

const setup = Effect.gen(function* () {
  const lifetime = graphFixture();
  yield* Effect.addFinalizer(() => Effect.orDie(lifetime.releaseEffect));
  const demo = (yield* lifetime.openEffect()).effects;
  const store = storesOver(demo.graph.store.db, installation);
  const reader = yield* storedCommands({ commandRows: store.commandRows, requestKeys: store.requestKeys, host }).pipe(
    Effect.provide(demo.context),
  );
  const admit = Effect.fnUntraced(function* (
    execution: string,
    admittedAt: number,
    picked?: { readonly program?: string; readonly cwd?: string },
  ) {
    yield* demo.graph.units.write('CommandReader.admit', (unit) =>
      store.commandRows.projectCommand(unit, {
        projectId: demo.projectId,
        execution: { installation, execution: ExecutionId.make(execution), incarnation: 0 },
        owner: { _tag: 'Operator' },
        origin: { _tag: 'Operator' },
        policyIdentity: 'policy',
        targetKey: 'target',
        holdings: {},
        program: picked?.program,
        cwd: picked?.cwd,
        admittedAt,
      } as unknown as CommandRecord),
    );
    yield* Effect.addFinalizer(() =>
      demo.graph.units
        .write('CommandReader.release', (unit) =>
          unit.run(demo.graph.store.db.run(sql`delete from command where execution_id = ${execution}`)),
        )
        .pipe(Effect.orDie),
    );
  });
  yield* admit('c-alpha', 5);
  yield* admit('c-bravo', 5);
  yield* admit('c-charlie', 9);
  return { demo, reader, admit };
});
class CommandReaderFixture extends Context.Service<CommandReaderFixture, Effect.Success<typeof setup>>()('testing/CommandReader') {}

layer(Layer.effect(CommandReaderFixture, setup), { excludeTestServices: true })('command reader', (it) => {
  it.effect('a page walked one row at a time carries every command exactly once', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      held = ['c-alpha', 'c-bravo', 'c-charlie'];
      hostFails = false;
      const walked: string[] = [];
      let after: CommandCursor | undefined = undefined;
      for (let page = 0; page < 4; page += 1) {
        const answer: CommandListAnswer = yield* reader.page(demo.projectId, { limit: 1, after });
        walked.push(...answer.readings.map((reading) => reading.command.execution.execution));
        after = answer.after;
        if (after === undefined) break;
      }
      expect(walked).toEqual(['c-alpha', 'c-bravo', 'c-charlie']);
      expect(after).toBeUndefined();
    }),
  );

  it.effect('a cursor from another selection refuses instead of walking a different ordering', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      held = [];
      hostFails = false;
      const page = yield* reader.page(demo.projectId, { limit: 2 });
      const crossed = yield* Effect.result(reader.page(demo.projectId, { limit: 2, after: page.after!, owner: { _tag: 'Operator' } }));
      expect(crossed._tag).toBe('Failure');
      if (crossed._tag === 'Failure') expect(crossed.failure).toMatchObject({ reason: 'selection-changed' });
    }),
  );

  it.effect('the newest-first window answers the newest command first and its cursor walks older', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      held = [];
      hostFails = false;
      const window = yield* reader.page(demo.projectId, { limit: 2, order: 'newest' });
      expect(window.readings.map((reading) => reading.command.execution.execution as string)).toEqual(['c-charlie', 'c-bravo']);
      expect(window.after).toBeDefined();

      const older = yield* reader.page(demo.projectId, { limit: 2, order: 'newest', after: window.after! });
      expect(older.readings.map((reading) => reading.command.execution.execution as string)).toEqual(['c-alpha']);
      expect(older.after).toBeUndefined();

      const crossed = yield* Effect.result(reader.page(demo.projectId, { limit: 2, after: window.after! }));
      expect(crossed._tag).toBe('Failure');
      if (crossed._tag === 'Failure') expect(crossed.failure).toMatchObject({ reason: 'selection-changed' });
    }),
  );

  it.effect('standing selects the work owed and the history it was discharged from, and omitted reads both', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      held = [];
      hostFails = false;
      const owed = yield* reader.page(demo.projectId, { limit: 10, standing: true });
      const discharged = yield* reader.page(demo.projectId, { limit: 10, standing: false });
      const every = yield* reader.page(demo.projectId, { limit: 10 });

      expect(owed.readings).toEqual([]);
      expect(discharged.readings).toHaveLength(every.readings.length);
      expect(every.readings).toHaveLength(3);
    }),
  );

  it.effect('a row the host holds nothing for is unheld, and the page still says the host answered', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      held = ['c-alpha'];
      hostFails = false;
      const page = yield* reader.page(demo.projectId, { limit: 10 });
      expect(page.host._tag).toBe('Answered');
      const live = new Map<string, string>(
        page.readings.map((reading) => [reading.command.execution.execution as string, reading.live._tag]),
      );
      expect(live.get('c-alpha')).toBe('Held');
      expect(live.get('c-bravo')).toBe('Unheld');
    }),
  );

  it.effect('a host that cannot be read answers a page of attribution, never an empty inventory', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      hostFails = true;
      const page = yield* reader.page(demo.projectId, { limit: 10 });
      expect(page.host._tag).toBe('Unavailable');
      expect(page.readings).toHaveLength(3);
      expect(page.readings.every((reading) => reading.live._tag === 'Unavailable')).toBe(true);
    }),
  );

  it.effect('a wide page crosses to the host in bounded batches and merges every row it joined', () =>
    Effect.gen(function* () {
      const { demo, reader, admit } = yield* CommandReaderFixture;
      const batch = Array.from({ length: 60 }, (_unused, at) => `c-batch-${String(at).padStart(3, '0')}`);
      for (const [at, execution] of batch.entries()) yield* admit(execution, 100 + at);
      held = ['c-alpha', 'c-bravo', 'c-charlie', ...batch];
      hostFails = false;
      batchWidths.length = 0;
      batchRevisions = [9, 5];
      const page = yield* reader.page(demo.projectId, { limit: 70 });
      batchRevisions = null;
      expect(page.host._tag).toBe('Answered');
      expect(batchWidths).toEqual([50, 13]);
      expect(page.readings).toHaveLength(63);
      expect(page.readings.every((reading) => reading.live._tag === 'Held')).toBe(true);
      expect(page.host._tag === 'Answered' ? page.host.revision : null).toBe(5);
    }),
  );

  it.effect('a row of a replaced generation is unheld, and the host is never asked about it', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      held = ['c-alpha'];
      hostFails = false;
      askedRefs.length = 0;
      hostIncarnation = 1;
      const page = yield* reader.page(demo.projectId, { limit: 20, order: 'newest' });
      expect(askedRefs).toEqual([]);
      expect(page.readings.length).toBeGreaterThan(0);
      expect(page.readings.every((reading) => reading.live._tag === 'Unheld')).toBe(true);
      expect(page.host._tag === 'Answered' ? page.host.unmeasured : null).toEqual([]);
      const current = yield* reader.one(demo.projectId, 'c-alpha', 0);
      expect(current.live._tag).toBe('Unheld');
    }).pipe(Effect.ensuring(Effect.sync(() => (hostIncarnation = 0)))),
  );

  it.effect('a project holding no command under the selection is an answered empty page', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      hostFails = false;
      const page = yield* reader.page(demo.projectId + 1000, { limit: 10 });
      expect(page.readings).toEqual([]);
      expect(page.host._tag).toBe('Answered');
      expect(page.after).toBeUndefined();
    }),
  );

  it.effect('an empty page carries no inventory revision, while a page with rows carries the host own', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      held = ['c-alpha'];
      hostFails = false;
      const empty = yield* reader.page(demo.projectId + 1000, { limit: 10 });
      const rows = yield* reader.page(demo.projectId, { limit: 10 });
      expect(empty.host).toMatchObject({ _tag: 'Answered', revision: undefined });
      expect(rows.host).toMatchObject({ _tag: 'Answered', revision: 7 });
    }),
  );

  it.effect('one command reads back whole, and a reference at another incarnation is not it', () =>
    Effect.gen(function* () {
      const { demo, reader } = yield* CommandReaderFixture;
      held = ['c-alpha'];
      hostFails = false;
      const one = yield* reader.one(demo.projectId, 'c-alpha', 0);
      expect(one.command.execution.execution as string).toBe('c-alpha');
      expect(one.live._tag).toBe('Held');
      const moved = yield* Effect.result(reader.one(demo.projectId, 'c-alpha', 1));
      expect(moved._tag).toBe('Failure');
      if (moved._tag === 'Failure') expect(moved.failure).toMatchObject({ reason: 'no-command' });
    }),
  );

  it.effect(
    'the marks carry the waits of this project’s commands at their own incarnation, and no wait whose command is not the project’s',
    () =>
      Effect.gen(function* () {
        const { demo, reader } = yield* CommandReaderFixture;
        yield* Effect.addFinalizer(() =>
          demo.graph.units
            .write('CommandReader.releaseWaits', (unit) =>
              unit.run(demo.graph.store.db.run(sql`delete from command_wait where execution_id in ('c-alpha', 'c-bravo', 'c-nowhere')`)),
            )
            .pipe(Effect.orDie),
        );
        yield* demo.graph.units.write('CommandReader.waits', (unit) =>
          unit.run(
            demo.graph.store.db.run(sql`insert into command_wait (execution_id, incarnation, mode, revision, moved_at)
        values ('c-alpha', 0, 'foreground', 3, 0), ('c-bravo', 1, 'foreground', 0, 0), ('c-nowhere', 0, 'background', 0, 0)`),
          ),
        );
        const marks = yield* reader.marks(demo.projectId);
        expect(marks.waits).toEqual([{ execution: 'c-alpha', incarnation: 0, mode: 'foreground', revision: 3 }]);
        const elsewhere = yield* reader.marks(demo.projectId + 1000);
        expect(elsewhere).toEqual({ waits: [], newest: null });
      }),
  );

  it.effect('a view projects the retained program and cwd, and absence reads as unretained', () =>
    Effect.gen(function* () {
      const { demo, reader, admit } = yield* CommandReaderFixture;
      held = ['c-alpha', 'c-bravo', 'c-charlie', 'c-delta', 'c-epsilon'];
      hostFails = false;
      yield* admit('c-delta', 11, { program: '/bin/echo', cwd: '/tmp/work' });
      yield* admit('c-epsilon', 12);
      const page = yield* reader.page(demo.projectId, { limit: 10 });
      const views = new Map(page.readings.map((reading) => [reading.command.execution.execution as string, reading.command]));
      expect(views.get('c-delta')?.program).toBe('/bin/echo');
      expect(views.get('c-delta')?.cwd).toBe('/tmp/work');
      expect(views.get('c-epsilon')?.program).toBeUndefined();
      expect(views.get('c-epsilon')?.cwd).toBeUndefined();
    }),
  );
});
