import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { Message } from '@runlith/llm/schema/messages';
import { heldTurn, replyTurn, scriptedStep } from '@runlith/agent/thread/conformance/runLog/scripts';
import { gate, until } from '@runlith/agent/thread/conformance/runLog/support';
import { OWNER, SCOPE, queuedTurn, scriptedWorld, startedTurn } from '@runlith/agent/thread/conformance/runLog/world';
import { openThreadStore } from '../storageHarness.js';

const reply = (text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id: text },
      { type: 'text-delta', id: text, text },
      { type: 'text-end', id: text },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });

it.live('a restart after the follow-up wake opened the queued turn but before its acknowledgement opens that turn once', () =>
  Effect.gen(function* () {
    const opened = yield* openThreadStore();
    const thread = yield* opened.storage.createThread({ ownerId: OWNER, scope: SCOPE });
    const observer = opened.storage.runs({ ownerId: 'observer', scope: SCOPE });
    const before = yield* scriptedWorld(opened.storage, thread.agentId);
    const held = gate();
    before.plan.push(heldTurn(held.released), reply('Done.'));
    const first = yield* startedTurn(before, thread.id, 'First.');
    yield* queuedTurn(before.harness.threads.handle(thread.id, OWNER), 'Then this.');
    held.release();
    yield* until(() =>
      Effect.map(observer.runsOf(thread.id), (runs) => runs.length === 2 && runs.every((run) => run.settledNotifiedAt !== null)),
    );
    yield* before.dispose();
    yield* opened.db.run(
      sql`update thread_run set settled_notified_at = null, heartbeat_at = 0, settled_notification = json_set(settled_notification, '$.delivered', json('[]')) where id = ${first.runId}`,
    );
    const reopened = yield* opened.storage.reopen();
    const settled: string[] = [];
    const after = yield* scriptedWorld(reopened, thread.agentId, {
      onSettled: (event) =>
        Effect.sync(() => {
          settled.push(event.runId);
        }),
    });
    const watching = reopened.runs({ ownerId: 'observer', scope: SCOPE });
    yield* after.harness.runs.recoverNow();
    yield* until(() => Effect.map(watching.runById(first.runId), (run) => run?.settledNotifiedAt != null));
    expect(settled).toEqual([first.runId]);
    expect((yield* watching.runsOf(thread.id)).map((run) => run.status)).toEqual(['completed', 'completed']);
    const said = ((yield* reopened.aggregate.transcriptOf(thread.id)) ?? []).flatMap((entry) =>
      coreEntry(entry) && entry.type === 'message' && entry.role === 'user' ? [entry.text] : [],
    );
    expect(said).toEqual(['First.', 'Then this.']);
  }),
);
