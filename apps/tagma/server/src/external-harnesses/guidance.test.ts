import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { activityRecording } from '@runlith/activity/testing';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { lifecycleWorldOver, OWNER, SCOPE } from '@runlith/agent/thread/conformance/lifecycleWorld';
import { fakeAdapter } from '@runlith/agent/thread/conformance/fakeTransport';
import type { TouchBrief } from '../graph/contract/service/orientation.js';
import { WorkPlaces } from '../threads/contract/service/working.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { ThreadInbox } from '../threads/store/inbox.js';
import { unhosted } from './testing/hookReports.js';
import { harnessFacet } from '../threads/contract/wire/harness/types.js';
import { harnessPresentation } from './contract/service/table.js';
import { builtinHarness } from './testing/builtin.js';
import { writes } from '../platform/contract/service/writes.js';
import { terminalKernel } from './birth/seat.js';
import { memorySessionRows } from './testing/memorySessions.js';
import { HarnessSessionStore } from './store/sessions.js';
import { RunActivities } from './protocol/activities.js';
import { TerminalJournal } from './terminal/journal.js';
import { makeHookGuidance } from './guidance.js';

const TITLE = 'zone-rule-7f3';
const brief: TouchBrief = {
  place: 'src/a.ts',
  as: 'read',
  rules: [{ name: 'zone', identity: 'rule-identity-1', revision: 'r1', title: TITLE, body: 'keep it small', reach: 'code · src' }],
  explanations: [],
  tagPrompts: [],
  touches: [],
};
const unused = () => Effect.die('Touch guidance with no entered place needs no prompt source.');
const unobserved = () => {
  throw new Error('Touch guidance does not subscribe to record publications.');
};
const fixture = Effect.fnUntraced(function* () {
  const storage = yield* openMemoryStorage();
  const kernel = terminalKernel(builtinHarness('claude-code'), undefined, false, {});
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
  const memory = yield* memorySessionRows(storage);
  yield* memory.seed(thread.id, harnessFacet('claude-code', harnessPresentation(builtinHarness('claude-code'))));
  const store = new HarnessSessionStore(memory.rows, () => Effect.void);
  const context = yield* Layer.build(
    Layer.mergeAll(
      Layer.mock(ThreadRecords, {
        projectOf: () => Effect.succeed(1),
        writes: writes('testing.guidance', []),
        birthRecorded: unobserved,
        removalRecorded: unobserved,
        titleRecorded: unobserved,
        statusPublished: unobserved,
        shelfRecorded: unobserved,
      }),
      Layer.mock(WorkPlaces, {}),
      Layer.mock(ThreadInbox, { writes: writes('testing.guidance', []) }),
    ),
  );
  const recorded = activityRecording();
  const journal = new TerminalJournal(
    world.reports.of('terminal'),
    writes('testing.guidance', []),
    new RunActivities(Context.get(context, ThreadInbox), recorded.log, yield* Effect.scope),
    world.ledger,
  );
  const guidance = makeHookGuidance(
    world.guidance,
    { orientation: unused, law: unused, recap: unused, tail: unused },
    store,
    journal,
    Context.get(context, WorkPlaces),
    Context.get(context, ThreadRecords),
    world.reports,
    unhosted,
  );
  return { guidance, rows: memory.rows, journal, id: thread.id };
});

it.effect('parallel hooks of a thread deliver a new law once', () =>
  Effect.gen(function* () {
    const { guidance, id } = yield* fixture();
    const told = yield* Effect.all([guidance.touch(id, 'parallel-1', [brief], []), guidance.touch(id, 'parallel-2', [brief], [])], {
      concurrency: 2,
    });
    expect(told.filter((one) => one.text !== null)).toHaveLength(1);
  }),
);

it.effect('a lost reply replays its evidence and a committed clear makes the law deliverable once more', () =>
  Effect.gen(function* () {
    const { guidance, rows, journal, id } = yield* fixture();
    const first = yield* guidance.touch(id, 'first', [brief], []);
    expect(first.text).toContain(TITLE);
    expect(yield* guidance.touch(id, 'first', [brief], [])).toEqual(first);
    expect((yield* guidance.touch(id, 'second', [brief], [])).text).toBeNull();
    const reset = yield* guidance.cleared(id, 'compact-1');
    expect((yield* guidance.touch(id, 'before-clear', [brief], [])).text).toBeNull();
    yield* rows.within('testing.guidanceClear', (unit) =>
      Effect.andThen(journal.apply(unit, [reset.plan]), unit.afterCommit(reset.delivered)),
    );
    expect((yield* guidance.touch(id, 'third', [brief], [])).text).toContain(TITLE);
    expect((yield* guidance.touch(id, 'fourth', [brief], [])).text).toBeNull();
  }),
);
