import { Clock, Context, Effect, type Scope } from 'effect';
import { sql } from 'drizzle-orm';
import type { ThreadRunStatus } from '@runlith/agent/thread/rows';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import type { ExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import { LEASE_RHYTHM } from '../../../threads/contract/wire/rhythm.js';
import type { DoorFixture } from '../doorFixture.js';
import { stamp, type Cli, type TerminalRig } from './terminalRig.js';

export const until = Effect.fn('testing.terminalDeliveryUntil')(
  function* <A, E, R>(
    read: Effect.Effect<A | null, E, R>,
    what: string,
    within = 20_000,
    changes?: Effect.Effect<Effect.Effect<unknown>, never, Scope.Scope>,
  ) {
    yield* Effect.annotateCurrentSpan({ what, within });
    const next = changes === undefined ? Effect.sleep(25) : yield* changes;
    for (;;) {
      const seen = yield* read;
      if (seen !== null) return seen;
      yield* next;
    }
  },
  Effect.scoped,
  (effect, _read, _what, within = 20_000, _changes?: Effect.Effect<Effect.Effect<unknown>, never, Scope.Scope>) =>
    Effect.timeout(effect, within),
);

export type Who = { readonly session: string; readonly root: string };
export const whoSpeaks = (facet: ExternalSession): Who => {
  const argv = facet.session?.argv ?? [];
  return { session: facet.session!.id, root: argv[argv.findIndex((arg) => arg === '--session-id' || arg === '--resume') + 1]! };
};

export const deliveryRig = (world: DoorFixture['Service'], rig: TerminalRig) => {
  const db = () => Context.get(world.runtime.graph, MachineStore).db;
  const harness = () => Context.get(world.runtime.owners, ThreadHarness);
  const orphaned = Effect.fnUntraced(function* (runId: string) {
    const quiet = (yield* Clock.currentTimeMillis) - LEASE_RHYTHM.takeoverAfterMs - 1_000;
    yield* db().run(
      sql`update thread_run set owner_id = 'a-server-that-died', heartbeat_at = ${quiet}, progress = json_set(progress, '$.stage', 'running') where id = ${runId} and status = 'running'`,
    );
  });
  const runRow = (runId: string) =>
    db().get<{ readonly status: string; readonly resumes: number }>(sql`select status, resumes from thread_run where id = ${runId}`);
  const ended = (runId: string) =>
    Effect.map(
      db().get<{
        readonly status: ThreadRunStatus;
        readonly settled_by: string | null;
        readonly finished_at: number | null;
        readonly updated_at: number;
      }>(sql`select status, settled_by, finished_at, updated_at from thread_run where id = ${runId}`),
      (row) =>
        row === undefined || row.status === 'running'
          ? null
          : { status: row.status, stoppedBy: row.settled_by, finishedAt: new Date(row.finished_at ?? row.updated_at) },
    );
  const runsOf = (threadId: string) =>
    db().all<{ readonly id: string; readonly origin: string }>(
      sql`select id, origin from thread_run where thread_id = ${threadId} order by created_at, id`,
    );
  const journalOf = Effect.fnUntraced(function* (threadId: string, runId: string) {
    const entries = yield* db().all<{ readonly payload: string }>(
      sql`select payload from thread_event where thread_id = ${threadId} and json_extract(payload, '$.entry.runId') = ${runId} order by position`,
    );
    const run = yield* db().get<{ readonly stream_tail: string | null }>(sql`select stream_tail from thread_run where id = ${runId}`);
    return {
      entries: entries.flatMap((row) => {
        const entry = (JSON.parse(row.payload) as { readonly entry?: ThreadTranscriptEntry }).entry;
        return entry === undefined ? [] : [entry];
      }),
      tail: run?.stream_tail ?? null,
    };
  });
  const delivered = Effect.fn('testing.deliverTerminalWords')(function* (cli: Cli, runId: string) {
    const id = `reader:${crypto.randomUUID()}`;
    yield* rig.inbox().put({
      id,
      threadId: cli.threadId,
      sender: { kind: 'reader' },
      kind: 'turn',
      body: { text: 'words the core owed', attachments: [] },
      occurredAt: yield* stamp(),
    });
    yield* rig.inbox().deliver([id], runId);
    return id;
  });
  const observed = Effect.fn('testing.observeTerminalPrompt')(function* (cli: Cli, who?: Who) {
    yield* cli.hook(
      'UserPromptSubmit',
      { prompt_id: `p-${crypto.randomUUID()}`, session_id: who?.root },
      { prompt: 'a line the operator typed', session: who?.session },
    );
    return (yield* cli.running())!;
  });
  const forgotten = (cli: Cli) =>
    cli.store.change(cli.threadId, (facet) => {
      const { turn: _turn, unread: _unread, ...rest } = facet;
      return Effect.succeed({ facet: rest, value: undefined });
    });
  const declared = Effect.fnUntraced(function* (cli: Cli, runId: string, id: string) {
    const now = yield* stamp();
    return yield* cli.store.change(cli.threadId, (facet) =>
      Effect.succeed({
        facet: {
          ...facet,
          turn: { run: runId, turn: null, openedAt: now, offset: null },
          unread: [{ run: runId, items: [id], at: now, send: 'intended' }],
        },
        value: undefined,
      }),
    );
  });
  const attempts = (threadId: string) =>
    db().all<{ readonly status: string; readonly failure_reason: string | null }>(
      sql`select status, failure_reason from thread_run where thread_id = ${threadId} order by created_at, id`,
    );
  const launchBlocked = (threadId: string) =>
    Effect.map(
      harness().reads.statuses(OPERATOR_PRINCIPAL, [threadId]),
      ([row]) => row?.outcome === 'found' && row.status.launchBlocked === true,
    );
  return {
    db,
    harness,
    attempts,
    launchBlocked,
    orphaned,
    runRow,
    ended,
    runsOf,
    journalOf,
    delivered,
    observed,
    forgotten,
    declared,
    recover: () => harness().runs.recoverNow(),
    sayTo: (cli: Cli, text: string) => harness().threads.handle(cli.threadId, OPERATOR_PRINCIPAL).send(text),
  };
};
