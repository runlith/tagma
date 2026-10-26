import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Tracer } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { replyTurn, scriptedStep } from '@runlith/agent/thread/conformance/runLog/scripts';
import { OWNER, openedRun, pump, startedTurn } from '@runlith/agent/thread/conformance/runLog/world';
import { fileThreadStorage, openFileThreadStorage } from '../fileStorage.js';

const reply = (id: string, text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id },
      { type: 'text-delta', id, text },
      { type: 'text-end', id },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });

const warmWake = Effect.fnUntraced(function* (turns: number) {
  const { world, thread } = yield* openedRun(openFileThreadStorage);
  for (let index = 0; index < turns; index += 1) {
    world.plan.push(reply(`h${index}`, `Answer ${index}`));
    yield* pump(yield* startedTurn(world, thread.id, `Question ${index}.`));
  }
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  world.plan.push(reply('w', 'Woken.'));
  const said = yield* Effect.withTracer(world.harness.threads.handle(thread.id, OWNER).send('Wake up.'), tracer);
  if (said.status !== 'started') return yield* Effect.die(`The wake answered ${said.status} instead of opening a run.`);
  yield* pump({ world, threadId: thread.id, runId: said.runId, entry: said.entry });
  const history = spans.filter((span) => span.attributes.get('fold') === 'history');
  return {
    stored: history.filter((span) => span.name === 'ThreadStorage.checkpoint.load').map((span) => span.attributes.get('rows')),
    events: history.filter((span) => span.name === 'ThreadStorage.suffix.replay').map((span) => span.attributes.get('events')),
  };
}, Effect.scoped);

layer(fileThreadStorage, { excludeTestServices: true })('SQLite opening cost', (it) => {
  it.effect('a warm wake reads no stored history rows and only the events past its held fold, however long the history', () =>
    Effect.gen(function* () {
      const short = yield* warmWake(1);
      const long = yield* warmWake(2);
      expect(long.stored.length).toBeGreaterThan(0);
      expect(long.stored.every((rows) => rows === 0)).toBe(true);
      expect(long).toEqual(short);
    }),
  );
});
