import { gcAndSweep, heapStats } from 'bun:jsc';
import { Effect } from 'effect';
import { builtinMode } from '../../agent/testing/modes';
import { ToolResultValue } from '@runlith/llm/schema/messages';
import type { AgentEvent } from '../../agent/AgentEvent';
import { recording } from '../../agent/testing/recording';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../permissions/vocabulary';
const turns = Number(Bun.argv.find((value) => value.startsWith('--turns='))?.slice(8) ?? 128);
const bytes = Number(Bun.argv.find((value) => value.startsWith('--bytes='))?.slice(8) ?? 262144);
const deltas = Number(Bun.argv.find((value) => value.startsWith('--deltas='))?.slice(9) ?? 100);
const withoutText = Bun.argv.includes('--without-text');
if (!Number.isSafeInteger(deltas) || deltas < 0) throw new Error('Nonnegative deltas required');
const mode = 'replay';
if (![turns, bytes].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Positive turns and bytes required');
function owner() {
  const log = recording<AgentEvent>();
  return {
    push: (event: AgentEvent) => Effect.runSync(log.push(event)),
    count: () => log.entries().length,
  };
}
function fill(target: ReturnType<typeof owner>, count: number) {
  let events = 0;
  const push = (event: AgentEvent) => {
    target.push(event);
    events++;
  };
  for (let turn = 0; turn < count; turn++) {
    const id = `part-${turn}`;
    push({ type: 'text-start', id });
    for (let chunk = 0; chunk < deltas; chunk++) push({ type: 'text-delta', id, text: `${turn}:${chunk}:${'x'.repeat(1000)}` });
    push({ type: 'text-end', id });
    push({ type: 'tool-call', id, name: 'read', input: { turn } });
    push({ type: 'tool-result', id, name: 'read', result: ToolResultValue.from(Buffer.alloc(bytes, 65 + (turn % 26)).toString()) });
  }
  return events;
}
function snapshot() {
  gcAndSweep();
  gcAndSweep();
  return { heap: process.memoryUsage().heapUsed, objects: heapStats().objectCount };
}
if (Bun.argv.includes('--steps')) {
  const roots = await resultRoots();
  await Bun.sleep(0);
  const both = snapshot();
  const steps = roots.steps?.length ?? 0;
  roots.state = null;
  await Bun.sleep(0);
  const withoutState = snapshot();
  roots.steps = null;
  await Bun.sleep(0);
  const historyOnly = snapshot();
  console.log(
    JSON.stringify({
      mode: 'steps',
      turns,
      bytes,
      deltas,
      withoutText,
      steps,
      historyMessages: roots.history.length,
      historyToolCharacters: roots.history.reduce(
        (total, message) =>
          total +
          message.content.reduce(
            (sum, part) => sum + (part.type === 'tool-result' && typeof part.result.value === 'string' ? part.result.value.length : 0),
            0,
          ),
        0,
      ),
      resultOverHistoryBytes: both.heap - historyOnly.heap,
      stepsOverHistoryBytes: withoutState.heap - historyOnly.heap,
      resultOverHistoryObjects: both.objects - historyOnly.objects,
    }),
  );
} else {
  const held = owner();
  const before = snapshot();
  const started = performance.now();
  const events = fill(held, turns);
  const elapsedMs = performance.now() - started;
  await Bun.sleep(0);
  const after = snapshot();
  const retainedEvents = held.count();
  console.log(
    JSON.stringify({
      mode,
      turns,
      bytes,
      deltas,
      events,
      retainedEvents,
      elapsedMs,
      retainedBytes: after.heap - before.heap,
      retainedObjects: after.objects - before.objects,
    }),
  );
}
async function resultRoots() {
  const { Schema, Stream } = await import('effect');
  const { Usage } = await import('@runlith/llm/schema/events');
  const { Message } = await import('@runlith/llm/schema/messages');
  const { Agent } = await import('../../agent/Agent');
  const { makeAgentRunner } = await import('../../agent/AgentRunner');
  const { RunStop } = await import('../../agent/RunStop');
  const { Tool } = await import('../../agent/tool');
  type Message = import('@runlith/llm/schema/messages').Message;
  type Event = import('@runlith/llm/schema/events').LLMEvent;
  let history: readonly Message[] = [];
  let requests = 0;
  const usage = new Usage({});
  return await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* makeAgentRunner({
          idleMs: 30_000,
          models: {
            request: () => ({
              plannedOutputTokens: 32_000,
              text: () => {
                throw new Error('The benchmark streams.');
              },
              object: () => {
                throw new Error('The benchmark streams.');
              },
              stream: ({ messages }) => {
                history = messages;
                const turn = requests++;
                const id = `part-${turn}`;
                const events: Event[] = [
                  { type: 'step-start', index: turn },
                  { type: 'text-start', id },
                ];
                const final = turn === turns;
                if (final) events.push({ type: 'text-delta', id, text: 'Done.' });
                else
                  for (let chunk = 0; chunk < deltas; chunk++)
                    events.push({ type: 'text-delta', id, text: `${turn}:${chunk}:${'x'.repeat(1000)}` });
                events.push({ type: 'text-end', id });
                if (!final) events.push({ type: 'tool-call', id, name: 'read', input: { turn } });
                const reason = final ? 'stop' : 'tool-calls';
                events.push({ type: 'step-finish', index: turn, reason, usage }, { type: 'finish', reason, usage });
                return Stream.fromIterable(events);
              },
            }),
          },
        });
        const agent = new Agent({
          id: 'heap',
          name: 'Heap',
          description: 'Result ownership measurement.',
          instructions: () => '',
          stopWhen: [],
          tools: () => ({
            read: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Return a body.',
              parameters: Schema.Struct({ turn: Schema.Number }),
              execute: ({ turn }) => Effect.sync(() => Buffer.alloc(bytes, 65 + (turn % 26)).toString()),
            }),
          }),
        });
        const handle = yield* runner.run(
          agent,
          {
            runId: 'heap',
            stop: new RunStop(),
            ctx: {},
            model: { ownerId: 'bench', provider: 'openai-oauth', model: 'gpt-5.5', reasoning: null, switches: {} },
            messages: [Message.user('Run the workload.')],
            approval: { mode: 'trust', interactive: false },
            modeOf: builtinMode('trust'),
          },
          { push: () => Effect.void },
        );
        const steps = yield* handle.output.steps;
        if (steps.length !== turns + 1) return yield* Effect.die(new Error(`Expected ${turns + 1} steps, received ${steps.length}`));
        yield* handle.close();
        const retained = withoutText ? steps.map((step) => ({ ...step, text: '', reasoningText: undefined })) : steps;
        return {
          history,
          steps: retained as readonly import('../../agent/AgentStep').AgentStep[] | null,
          state: handle.runState as import('../../agent/AgentRunState').AgentRunState | null,
        };
      }),
    ),
  );
}
