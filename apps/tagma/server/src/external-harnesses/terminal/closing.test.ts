import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { TestClock } from 'effect/testing';
import { assistantMessageEntryId } from '@runlith/agent/transcript/entryNames';
import { PLAIN_BEAT_MS } from './decide.js';
import { METADATA_LIMITS, TRANSCRIPT_LIMITS } from '../metadata/policy.js';
import { Clock, Context, Effect, FiberMap, Layer } from 'effect';
import { activityRecording } from '@runlith/activity/testing';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { APPROVAL, lifecycleWorldOver, OWNER, SCOPE, started } from '@runlith/agent/thread/conformance/lifecycleWorld';
import { fakeAdapter } from '@runlith/agent/thread/conformance/fakeTransport';
import { terminalKernel } from '../birth/seat.js';
import { writes } from '../../platform/contract/service/writes.js';
import { ThreadInbox } from '../../threads/store/inbox.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { harnessPresentation } from '../contract/service/table.js';
import { builtinHarness, shippedHarnessAdapters } from '../testing/builtin.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { transcriptFiles } from '../testing/files.js';
import { observationRebound } from '../observations/staleness.js';
import { RunActivities } from '../protocol/activities.js';
import { memorySessionRows } from '../testing/memorySessions.js';
import { standingAlignment } from '../testing/alignment.js';
import { TerminalJournal } from './journal.js';
import { TerminalClosing } from './closing.js';
import { TerminalWatch } from './watch.js';
import { OpenRuns } from './open.js';
import { HarnessSessionStore } from '../store/sessions.js';
import { Terminals } from '../../executions/contract/service/terminals.js';
import { TerminalScreens } from '../../executions/contract/service/records.js';

const MAIN = 'claude-opus-5-5-20261001';
const PATH = '/data/transcript.jsonl';
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const assistant = (id: string, usage: Record<string, number>, at: string, side = false) =>
  line({
    type: 'assistant',
    timestamp: at,
    ...(side ? { isSidechain: true } : {}),
    message: {
      id,
      model: side ? 'claude-sonnet-5-5' : MAIN,
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: id }],
      usage,
    },
  });
const unused = () => Effect.die('This transcript reader needs no command or environment mutation.');

const fixture = Effect.fnUntraced(function* () {
  const storage = yield* openMemoryStorage();
  const kernel = terminalKernel(builtinHarness('claude-code'), undefined, false, {});
  const adapters = yield* shippedHarnessAdapters;
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE, transport: kernel.transport });
  yield* storage.aggregate.update(thread.id, {
    capabilities: kernel.capabilities,
    provider: kernel.selection.provider,
    model: kernel.selection.model,
    reasoning: kernel.selection.reasoning,
    account: kernel.account,
    switches: kernel.switches,
  });
  const world = yield* lifecycleWorldOver(storage, (yield* storage.aggregate.find(thread.id))!, undefined, fakeAdapter('terminal'));
  const { files, binding, access } = yield* transcriptFiles();
  const inbox = Context.get(
    yield* Layer.build(
      Layer.mock(ThreadInbox, { writes: writes('testing.transcript', []), pending: (id) => storage.inbox.pending(id).pipe(Effect.orDie) }),
    ),
    ThreadInbox,
  );
  const recorded = activityRecording();
  const journal = new TerminalJournal(
    world.reports.of(world.adapter.transport.adapter),
    writes('testing.transcript', []),
    new RunActivities(inbox, recorded.log, yield* Effect.scope),
    world.ledger,
  );
  yield* world.settlements.subscribe({ name: 'terminal run activity', at: 'first', handle: (event) => journal.settled(event) });
  const closing = new TerminalClosing(access, Effect.succeed(modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS)), journal.reports, adapters);
  const memory = yield* memorySessionRows(storage);
  const store = new HarnessSessionStore(memory.rows, () => Effect.void);
  const ports = yield* Layer.build(Layer.mergeAll(Layer.mock(Terminals, {}), Layer.mock(TerminalScreens, {})));
  const runs = new OpenRuns();
  const watch = new TerminalWatch(
    store,
    journal,
    runs,
    inbox,
    access,
    { find: unused, runningRun: unused },
    Context.get(ports, Terminals),
    Context.get(ports, TerminalScreens),
    () => Effect.succeed(false),
    yield* FiberMap.make<string>(),
    closing,
    standingAlignment(store),
    adapters,
  );
  const open = Effect.fnUntraced(function* () {
    const run = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' })).run;
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    const initial = harnessFacet('claude-code', harnessPresentation(builtinHarness('claude-code')));
    const execution = { execution: 'memory-execution', incarnation: 1 };
    const facet: ExternalSession = {
      ...initial,
      execution,
      observation: observationRebound(initial.observation, { sessionId: 'session', execution, rootKey: 'session' }),
      session: {
        id: 'session',
        origin: 'launched',
        state: 'running',
        prompt: '',
        argv: null,
        cwd: '/project',
        startedAt: at,
        transcriptPath: PATH,
        storage: { binding, entries: [] },
      },
      turn: { run: run.id, turn: 'p1', openedAt: at, offset: 0 },
    };
    yield* memory.seed(run.threadId, facet);
    yield* journal.open(run, facet, []);
    runs.add(run.id, run.threadId);
    return { run, facet, at };
  });
  return { world, files, recorded, closing, journal, rows: memory.rows, storage, store, access, inbox, open, watch };
});

it.effect(
  'completed and late-stopped terminal turns commit canonical last context and main requests plus subagent rest once in core and activity',
  () =>
    Effect.gen(function* () {
      const { world, files, recorded, closing, journal, rows, storage, open } = yield* fixture();
      for (const late of [false, true]) {
        const { run, facet, at } = yield* open();
        const before = yield* storage.eventLog.headPosition(run.threadId);
        yield* files.writeFileString(
          PATH,
          [
            line({ type: 'user', timestamp: at, message: { role: 'user', content: 'work' } }),
            assistant('main-1', { input_tokens: 10, cache_read_input_tokens: 1_000, output_tokens: 1 }, at),
            assistant('main-1', { input_tokens: 10, cache_read_input_tokens: 1_000, output_tokens: 20 }, at),
            assistant('side-1', { input_tokens: 7, output_tokens: 3 }, at, true),
            line({
              type: 'assistant',
              timestamp: at,
              message: {
                id: 'synthetic',
                model: '<synthetic>',
                role: 'assistant',
                content: [],
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }),
            assistant(
              'main-2',
              { input_tokens: 5, cache_read_input_tokens: 1_200, cache_creation_input_tokens: 30, output_tokens: 40 },
              at,
            ),
            assistant('side-2', { input_tokens: 9, output_tokens: 4 }, at, true),
          ].join(''),
        );
        const spend = yield* closing.spent(run.threadId, facet);
        if (late)
          yield* world.runs.requestStop(run.id, { by: 'reader', marker: false, withdraw: false }, new Date(yield* Clock.currentTimeMillis));
        yield* rows.within('testing.terminalClose', (unit) => journal.apply(unit, closing.close(run, { kind: 'completed' }, spend)));
        yield* world.settled(late ? 2 : 1);
        yield* rows.within('testing.terminalClose', (unit) => journal.apply(unit, closing.close(run, { kind: 'completed' }, spend)));
        const saved = yield* world.ledger.runById(run.id);
        const requests = yield* storage.eventLog.recordsAsOf(run.threadId, {
          head: yield* storage.eventLog.headPosition(run.threadId),
          afterPosition: before,
          limit: 3,
          kinds: ['step-finished'],
        });
        expect(requests).toHaveLength(2);
        expect(requests.map((event) => event.payload)).toMatchObject([
          { context: { runId: run.id, stepNumber: 0 }, usage: { inputTokens: 1_010 } },
          { context: { runId: run.id, stepNumber: 1 }, usage: { inputTokens: 1_235 } },
        ]);
        expect(saved).toMatchObject({ status: late ? 'aborted' : 'completed', usage: { inputTokens: 2_261, outputTokens: 67 } });
        const reading = (yield* storage.aggregate.find(run.threadId))?.contextReading;
        expect(reading).toMatchObject({
          runId: run.id,
          stepNumber: 1,
          usage: { inputTokens: 1_235 },
          model: 'claude-opus-5-5',
          contextWindow: 1_000_000,
        });
        expect({ cache: reading?.cache, sentAt: reading?.sentAt }).toEqual({ cache: undefined, sentAt: undefined });
        const roots = recorded.activities().filter((row) => row.opened.kind === 'run' && row.opened.run === run.id);
        expect(roots).toHaveLength(1);
        expect(roots[0]?.ended).toMatchObject({
          outcome: late ? 'cancelled' : 'ok',
          reason: late ? 'reader' : null,
          result: {
            finish: late ? 'aborted' : 'completed',
            usage: { inputTokens: saved?.usage?.inputTokens, outputTokens: saved?.usage?.outputTokens },
          },
        });
      }
    }),
);

it.effect('a prompt carrying a screenshot past the metadata line limit still measures its turn', () =>
  Effect.gen(function* () {
    const { files, closing, open } = yield* fixture();
    const { run, facet, at } = yield* open();
    const screenshot = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(METADATA_LIMITS.recordBytes) },
    };
    yield* files.writeFileString(
      PATH,
      line({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: 'look' }, screenshot] } }) +
        assistant('main-1', { input_tokens: 10, cache_read_input_tokens: 900_000, output_tokens: 5 }, at),
    );
    const spend = yield* closing.spent(run.threadId, facet);
    expect(spend?.requests.map(({ request }) => request.reading?.usage.inputTokens)).toEqual([900_010]);
  }),
);

it.effect('an oversized transcript record closes the turn without partial requests or a misleading last context reading', () =>
  Effect.gen(function* () {
    const { world, files, closing, journal, rows, storage, open } = yield* fixture();
    const { run, facet, at } = yield* open();
    yield* files.writeFileString(
      PATH,
      assistant('first', { input_tokens: 10, output_tokens: 1 }, at) +
        line({
          type: 'assistant',
          timestamp: at,
          message: {
            id: 'oversized',
            model: MAIN,
            role: 'assistant',
            content: [{ type: 'tool_use', name: 'Write', input: { content: 'x'.repeat(TRANSCRIPT_LIMITS.recordBytes) } }],
            usage: { input_tokens: 20, output_tokens: 900 },
          },
        }),
    );
    const spend = yield* closing.spent(run.threadId, facet);
    expect(spend).toBeNull();
    yield* rows.within('testing.terminalClose', (unit) => journal.apply(unit, closing.close(run, { kind: 'completed' }, spend)));
    yield* world.settled(1);
    expect((yield* world.ledger.runById(run.id))?.status).toBe('completed');
    expect(
      yield* storage.eventLog.recordsAsOf(run.threadId, {
        head: yield* storage.eventLog.headPosition(run.threadId),
        afterPosition: 0,
        limit: 1,
        kinds: ['step-finished'],
      }),
    ).toHaveLength(0);
    expect((yield* storage.aggregate.find(run.threadId))?.contextReading?.runId === run.id).toBe(false);
  }),
);

it.effect('a hookless plain CLI completion is watched into its final answer and measured run without a Stop report', () =>
  Effect.gen(function* () {
    const { world, files, store, storage, open, watch } = yield* fixture();
    const { run, at } = yield* open();
    yield* store.change(run.threadId, (facet) => Effect.succeed({ facet: { ...facet, plain: true }, value: undefined }));
    yield* files.writeFileString(
      PATH,
      assistant(
        'The floor is built.',
        { input_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 7 },
        at,
      ),
    );
    yield* watch.waiting(run.threadId);
    yield* TestClock.adjust(PLAIN_BEAT_MS);
    yield* world.settled(1);
    expect(yield* world.ledger.runById(run.id)).toMatchObject({ status: 'completed', usage: { inputTokens: 123, outputTokens: 7 } });
    expect(yield* storage.aggregate.entryById(run.threadId, assistantMessageEntryId(run.id, 0))).toMatchObject({
      role: 'assistant',
      runId: run.id,
      text: 'The floor is built.',
    });
    expect(yield* world.ledger.activeRun(run.threadId)).toBeNull();
  }),
);

it.effect(
  'a reader interruption proved by the transcript closes the core run and activity without a Stop hook or an invented interruption entry',
  () =>
    Effect.gen(function* () {
      const { world, files, recorded, storage, store, open, watch } = yield* fixture();
      const { run, at } = yield* open();
      yield* files.writeFileString(
        PATH,
        line({
          type: 'assistant',
          timestamp: at,
          message: {
            id: 'escaped',
            model: MAIN,
            role: 'assistant',
            stop_reason: null,
            content: [{ type: 'text', text: 'working' }],
            usage: { input_tokens: 4, output_tokens: 2 },
          },
        }) +
          line({
            type: 'user',
            timestamp: at,
            message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
          }),
      );
      yield* watch.check(run.threadId, { returned: true });
      yield* world.settled(1);
      expect((yield* store.read(run.threadId))?.turn).toBeUndefined();
      expect(yield* world.ledger.runById(run.id)).toMatchObject({
        status: 'aborted',
        settledBy: 'reader',
        usage: { inputTokens: 4, outputTokens: 2 },
      });
      expect((yield* storage.aggregate.entriesOfRun(run.threadId, run.id)).filter((entry) => entry.type === 'interruption')).toHaveLength(
        0,
      );
      expect(recorded.activities().find((row) => row.opened.run === run.id)?.ended).toMatchObject({
        outcome: 'cancelled',
        reason: 'reader',
        result: { finish: 'aborted', usage: { inputTokens: 4, outputTokens: 2 } },
      });
    }),
);
