import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadView } from '@runlith/agent/thread/agents/ThreadAgent';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import { scriptedWorld, OWNER, SCOPE, startedTurn, pump } from '@runlith/agent/thread/conformance/runLog/world';
import { replyTurn, scriptedStep } from '@runlith/agent/thread/conformance/runLog/scripts';
import { openThreadStore } from '../storageHarness.js';

it.live('a context commit and its replay preserve typed thread state with a history-independent receipt', () =>
  Effect.gen(function* () {
    const { storage } = yield* openThreadStore();
    let contextWritten = false;
    const receipts: string[] = [];
    const rows: ThreadView[] = [];
    const committed: ThreadRow[] = [];
    const observed: typeof storage = {
      ...storage,
      eventLog: {
        ...storage.eventLog,
        append: (event, tx) =>
          Effect.tap(storage.eventLog.append(event, tx), () =>
            Effect.sync(() => {
              if (event.kind === 'context') contextWritten = true;
            }),
          ),
      },
      transitions: {
        ...storage.transitions,
        writeRecord: (id, evidence, write, tx) =>
          Effect.tap(storage.transitions.writeRecord(id, evidence, write, tx), () =>
            Effect.sync(() => {
              if (contextWritten) receipts.push(JSON.stringify({ answer: write.result }));
            }),
          ),
        writeAt: (id, work) =>
          Effect.flatMap(storage.transitions.writeAt(id, work), (ran) => {
            if (!contextWritten) return Effect.succeed(ran);
            contextWritten = false;
            return Effect.flatMap(storage.aggregate.find(id), (row) => {
              if (row !== undefined) committed.push(row);
              return committed.length === 1 ? Effect.succeed(ran) : storage.transitions.writeAt(id, work);
            });
          }),
      },
    };
    const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
    const world = yield* scriptedWorld(observed, thread.agentId, {
      orient: () => Effect.succeed({ message: Message.user('orientation') }),
    });
    for (const text of ['short history', 'long history '.repeat(4096)]) {
      world.plan.push((input) => {
        rows.push(input.thread);
        return replyTurn({ chunks: [], steps: [scriptedStep({ text: 'ready', messages: [Message.assistant('ready')] })] })(input);
      });
      const turn = yield* startedTurn(world, thread.id, text);
      yield* pump(turn);
      const current = yield* storage.aggregate.find(thread.id);
      expect(current?.createdAt).toEqual(thread.createdAt);
    }
    expect(committed).toHaveLength(2);
    expect(rows).toHaveLength(2);
    for (const [index, row] of rows.entries()) {
      expect(row).toMatchObject({
        createdAt: committed[index]!.createdAt,
        updatedAt: committed[index]!.updatedAt,
        history: committed[index]!.history,
        contextReading: committed[index]!.contextReading,
      });
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
      expect(row.createdAt).toEqual(thread.createdAt);
      expect(row.history.at(-1)?.content).toEqual([{ type: 'text', text: 'orientation' }]);
    }
    expect(rows[1]!.history.length).toBeGreaterThan(rows[0]!.history.length);
    expect(receipts).toEqual(['{"answer":null}', '{"answer":null}']);
  }),
);
