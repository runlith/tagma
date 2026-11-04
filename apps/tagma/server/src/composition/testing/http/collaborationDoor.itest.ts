import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Clock, Context, DateTime, Deferred, Effect, Layer, Stream } from 'effect';
import { parseThreadInboxItem } from '@runlith/agent/thread/persisted';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { CALL_HEADER, APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { HarnessReports } from '../../../external-harnesses/contract/service/reports.js';
import { birthsOf, inboxOf, threadInbox, turnsOf } from '../../../threads/testing/doubles.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { EvidenceFeed } from '../../../threads/contract/service/evidence.js';
import { ProtocolWorld, protocolWorld } from '../threads/protocolWorld.js';
import { nativeLeads } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';

type Answer = { readonly status?: string; readonly code?: string; readonly [field: string]: unknown };

const ARCHIVE = 'Put the sweeper away.';

const setup = Effect.gen(function* () {
  const archived = yield* Deferred.make<void>();
  const context = yield* Layer.build(
    protocolWorld({
      name: 'collaboration-door',
      own: 'harness executables on PATH',
      models: (standing) => ({
        ...standing,
        request: (input) => ({
          ...standing.request(input),
          stream: (call) => {
            const asked = JSON.stringify(call.messages);
            if (asked.includes(ARCHIVE) && !asked.includes('"type":"tool-result","id":"archive-sweeper"'))
              return Stream.fromIterable([
                { type: 'tool-input-start', id: 'archive-sweeper', name: 'archive_thread' },
                { type: 'tool-call', id: 'archive-sweeper', name: 'archive_thread', input: { threadId: 'sweeper' } },
                { type: 'finish', reason: 'tool-calls' },
              ]);
            if (asked.includes('"type":"tool-result","id":"archive-sweeper"')) Deferred.doneUnsafe(archived, Effect.void);
            if (asked.includes('Say where the floor stands.'))
              return Stream.fromIterable([
                { type: 'text-start', id: 'reply' },
                { type: 'text-delta', id: 'reply', text: 'The floor stands.' },
                { type: 'text-end', id: 'reply' },
                { type: 'finish', reason: 'stop' },
              ]);
            return Stream.fromIterable([
              { type: 'text-start', id: 'reply' },
              { type: 'text-delta', id: 'reply', text: 'Noted.' },
              { type: 'text-end', id: 'reply' },
              { type: 'finish', reason: 'stop' },
            ]);
          },
        }),
      }),
    }),
  );
  const { world, projectId } = Context.get(context, ProtocolWorld);
  const account = yield* Effect.acquireRelease(
    world.runtime.tokens.add('subscription', {
      accessToken: 'fixture-bearer',
      refreshToken: 'fixture-refresh',
      expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
      scope: 'user:inference',
      account: { uuid: crypto.randomUUID(), email: 'fixture@example.com' },
      organization: { uuid: 'fixture-org', name: 'Fixture' },
    }),
    (key) => world.runtime.tokens.remove('subscription', key).pipe(Effect.orDie),
  );
  yield* nativeLeads(world, account);
  yield* holdThreads(world);
  return { world, account, archived, projectId };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/Collaboration') {}

const asThread = Effect.fnUntraced(function* (threadId: string, id: string, input: unknown, key?: string) {
  const { world, projectId } = yield* Place;
  const response = yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma/api/op/${id}?project=${projectId}`, {
        signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [GRANT_HEADER]: grantFor(threadId),
          [APPROVAL_WAIT_HEADER]: '0',
          ...(key === undefined ? {} : { [CALL_HEADER]: key }),
        },
        body: JSON.stringify(input),
      }),
      world.routed,
    ),
  );
  return (yield* Effect.promise(() => response.json())) as Answer;
});

type Delivery = {
  readonly envelopeId: string;
  readonly intent: string;
  readonly recipient: { readonly threadId: string; readonly sameTeam: boolean };
};

const deliveriesOf = (answer: Answer): readonly Delivery[] => {
  expect(answer.status).toBe('sent');
  return answer.deliveries as readonly Delivery[];
};

const team = Effect.fnUntraced(function* () {
  const { world, projectId, account } = yield* Place;
  const births = birthsOf(world.runtime.owners);
  const lead = yield* births.create({ projectId, createdBySessionId: null, title: 'lead', account });
  const cli = yield* births.create({
    projectId,
    createdBySessionId: null,
    type: 'harness:devin',
    parent: lead.thread.id,
    task: 'Build the floor.',
  });
  return { lead: lead.thread.id, cli: cli.thread.id };
});

const inbox = Effect.map(Place, ({ world }) => inboxOf(world.runtime.owners));
const openRequests = (threadId: string) => Effect.flatMap(inbox, (box) => box.openRequests(threadId));
const receipt = (envelopeId: string) => Effect.flatMap(inbox, (box) => box.receipt(envelopeId));

const reportsTo = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* Place;
  const db = Context.get(world.runtime.graph, MachineStore).db;
  const rows = yield* Context.get(world.runtime.graph, MachineUnits).read((unit) =>
    unit.run(db.select().from(threadInbox()).where(eq(threadInbox().threadId, threadId)).all()),
  );
  return rows
    .map(parseThreadInboxItem)
    .flatMap((item) =>
      item.kind === 'envelope' && item.body.intent === 'report' ? [{ inReplyTo: item.body.inReplyTo, text: item.body.text }] : [],
    );
});

const rested = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* Place;
  const ended = yield* Deferred.make<void>();
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      Context.get(world.runtime.owners, EvidenceFeed).subscribe(threadId, (event) => {
        if (event.type === 'state' && event.frame.state.status.life === 'idle' && event.frame.state.latestRun != null)
          Deferred.doneUnsafe(ended, Effect.void);
      }),
    ),
    (stop) => Effect.sync(stop),
  );
  const state = yield* Context.get(world.runtime.owners, ThreadHarness).reads.snapshot(threadId);
  if (state.activeRun === null && state.latestRun != null) return;
  yield* Deferred.await(ended);
});

layer(Layer.effect(Place, setup), { excludeTestServices: true })('collaboration HTTP door', (it) => {
  it.effect('a CLI grant carries messages, reports, core refusals, named server operations and subscriptions', () =>
    Effect.gen(function* () {
      const { world, projectId, archived } = yield* Place;
      const { lead, cli } = yield* team();
      const [spawned] = yield* openRequests(cli);
      expect(spawned).toMatchObject({ sender: { kind: 'thread', threadId: lead }, deliveredToRunId: expect.any(String) });
      const [heard] = deliveriesOf(yield* asThread(cli, 'send_message', { to: [lead], message: 'Half the floor stands.' }));
      expect(heard).toMatchObject({ intent: 'message', recipient: { threadId: lead } });
      expect(yield* receipt(heard!.envelopeId)).toMatchObject({
        threadId: lead,
        sender: { kind: 'thread', threadId: cli },
        body: { intent: 'message', text: 'Half the floor stands.' },
      });
      const final = yield* asThread(cli, 'send_message', { to: [lead], message: 'The floor is built.', final: true });
      expect(deliveriesOf(final)).toMatchObject([{ intent: 'report', closed: [spawned!.id] }]);
      expect(yield* openRequests(cli)).toEqual([]);
      yield* Context.get(world.runtime.owners, HarnessReports).reported(cli, {
        event: { hook_event_name: 'Stop', session_id: 'cli-session' },
        capturedAt: DateTime.formatIso(yield* DateTime.now),
      });
      expect(yield* reportsTo(lead)).toEqual([{ inReplyTo: spawned!.id, text: 'The floor is built.' }]);
      yield* rested(lead);
      const child = yield* asThread(cli, 'spawn_agent', { agentId: 'harness:devin', task: 'Keep the ledger.', name: 'sweeper' }, 'sweeper');
      expect(child).toMatchObject({ status: 'started' });
      expect(
        (yield* asThread(cli, 'set_thread_title', { threadId: 'sweeper', title: 'Beams ledger' }, 'rename-sweeper')).code,
      ).toBeUndefined();
      expect((yield* Context.get(world.runtime.owners, ThreadRecords).facts(child.threadId as string))?.title).toBe('Beams ledger');
      yield* rested(lead);
      const refused = yield* world.op('send_message', { to: [lead], message: 'From nobody.' }, `project=${projectId}`);
      expect(refused.body).toMatchObject({ code: 'thread-required' });
      expect(
        yield* asThread(
          cli,
          'spawn_agent',
          { agentId: 'harness:devin', task: 'Check the beams.', worktree: 'no-such-tree' },
          'beams-nowhere',
        ),
      ).toMatchObject({ code: 'worktree-unknown', unblock: expect.any(Array) });
      const watched = child.threadId as string;
      const followed = (answer: Answer) =>
        (answer.threads as readonly { threadId: string; wakes: readonly string[] }[])
          .map(({ threadId, wakes }) => ({ threadId, wakes }))
          .sort((left, right) => left.threadId.localeCompare(right.threadId));
      const both = [lead, watched].sort().map((threadId) => ({ threadId, wakes: ['failed', 'awaiting'] }));
      yield* turnsOf(world.runtime.owners).send(lead, projectId, 'Say where the floor stands.', undefined, { key: 'say-floor' });
      yield* rested(lead);
      const subscribed = yield* asThread(cli, 'subscribe_threads', { threads: [lead, watched], wakes: ['awaiting', 'failed'] }, 'follow');
      expect(subscribed.status).toBe('subscribed');
      expect(followed(subscribed)).toEqual(both);
      expect((subscribed.threads as readonly { threadId: string; now: unknown }[]).find((row) => row.threadId === lead)?.now).toMatchObject(
        {
          title: 'lead',
          life: 'idle',
          asks: null,
          failed: null,
          movedAt: expect.any(String),
          said: 'The floor stands.',
        },
      );
      const read = yield* asThread(cli, 'read_subscriptions', { limit: 2 });
      expect(followed(read)).toEqual(both);
      expect((read.threads as readonly { threadId: string; now: unknown }[]).find((row) => row.threadId === lead)?.now).toMatchObject({
        title: 'lead',
        life: 'idle',
        asks: null,
        failed: null,
        movedAt: expect.any(String),
        said: 'The floor stands.',
      });
      expect(yield* asThread(cli, 'unsubscribe_threads', { threads: [lead, cli] }, 'unfollow')).toMatchObject({
        status: 'unsubscribed',
        unsubscribed: [{ threadId: lead }],
        unheld: [{ threadId: cli }],
      });
      expect(followed(yield* asThread(cli, 'read_subscriptions', { limit: 2 }))).toEqual([
        { threadId: watched, wakes: ['failed', 'awaiting'] },
      ]);
      expect(yield* asThread(cli, 'subscribe_threads', { threads: [cli] }, 'follow-self')).toMatchObject({ code: 'subscribe-self' });
      yield* turnsOf(world.runtime.owners).send(lead, projectId, ARCHIVE, undefined, { key: 'archive-sweeper' });
      yield* Deferred.await(archived);
      expect((yield* Context.get(world.runtime.owners, ThreadRecords).facts(watched))?.archivedAt).toBeInstanceOf(Date);
      const waiting = yield* openRequests(watched);
      expect(yield* asThread(cli, 'send_task', { to: ['sweeper'], task: 'Reopen the ledger.' }, 'task-archived')).toMatchObject({
        code: 'thread-archived',
      });
      expect(yield* openRequests(watched)).toEqual(waiting);
      expect(yield* asThread(cli, 'read_subscriptions', { limit: 2 })).toMatchObject({ threads: [], total: 0 });
    }),
  );
});
