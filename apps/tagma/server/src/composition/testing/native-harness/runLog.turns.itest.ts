import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { agentReaderInput } from '@runlith/agent/AgentSignal';
import { replyTurn, scriptedStep } from '@runlith/agent/thread/conformance/runLog/scripts';
import { until } from '@runlith/agent/thread/conformance/runLog/support';
import { openedRun, pump, startedTurn } from '@runlith/agent/thread/conformance/runLog/world';
import { Message } from '@runlith/llm/schema/messages';
import { fileThreadStorage, openFileThreadStorage } from '../fileStorage.js';

const reply = (text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id: text },
      { type: 'text-delta', id: text, text },
      { type: 'text-end', id: text },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });

layer(fileThreadStorage, { excludeTestServices: true })('SQLite turns', (it) => {
  it.effect("the reader's own turn carries reader input, and a turn opened from an agent's queued task does not", () =>
    Effect.gen(function* () {
      const { storage, world, thread } = yield* openedRun(openFileThreadStorage);
      yield* storage.inbox.put({
        id: 'task-from-parent',
        threadId: thread.id,
        sender: { kind: 'thread', threadId: thread.id, name: 'orchestrator' },
        kind: 'task',
        body: { intent: 'task', text: 'read the diff', inReplyTo: null },
        occurredAt: new Date(1_000).toISOString(),
      });
      world.plan.push(reply('Hello.'), reply('Read.'));
      yield* pump(yield* startedTurn(world, thread.id, 'Say hello.'));
      yield* until(() => Effect.sync(() => world.replayed.length >= 2));
      const [readerTurn, taskTurn] = world.replayed;
      expect(agentReaderInput(readerTurn!.at(-1)!)).toBeDefined();
      expect(taskTurn!.at(-1)?.role).toBe('user');
      expect(agentReaderInput(taskTurn!.at(-1)!)).toBeUndefined();
    }),
  );
});
