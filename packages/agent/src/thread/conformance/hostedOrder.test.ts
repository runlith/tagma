import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber, Schema, Stream } from 'effect';
import { Tool, ToolFailed } from '../../agent/tool';
import { ASKS_NEVER } from '../../permissions/vocabulary';
import { coreEntry } from '../../transcript/kinds';
import type { ThreadTransitionStorage } from '../transition/port';
import type { MemoryTx } from '../storage/memory/units';
import { hosted } from './hostedWorld';
import { openMemoryStorage } from './memoryStorage';
import { gate } from './runLog/support';

it.live(
  'a preparation refusal cannot be placed again by a concurrent sibling and block later background mutations',
  Effect.fnUntraced(function* () {
    const claiming = gate();
    const recording = gate();
    const storage = yield* openMemoryStorage();
    let threadId = '';
    let holdRecording = true;
    const transitions: ThreadTransitionStorage<MemoryTx> = {
      ...storage.transitions,
      revised: (ids, tx, after) =>
        storage.transitions.revised(ids, tx, (revisions) =>
          after(revisions).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                if (threadId === '' || !holdRecording) return;
                const entries = yield* Effect.orDie(storage.aggregate.transcriptOf(threadId));
                if (
                  entries?.some(
                    (entry) =>
                      coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === 'refused' && entry.toolState === 'output-refused',
                  )
                ) {
                  holdRecording = false;
                  recording.reach();
                  yield* recording.released;
                }
              }),
            ),
          ),
        ),
    };
    let holdClaims = true;
    const graph = { on: { kind: 'key', key: 'graph' }, access: 'write' } as const;
    const run = yield* hosted(
      () => Effect.succeed({ ...storage, transitions }),
      {
        bash: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Run a command.',
          refusals: { 'sleeps-only': 'Command only waits' },
          parameters: Schema.Struct({ command: Schema.String, waitMs: Schema.optional(Schema.Number) }),
          mutates: true,
          claims: () => Effect.succeed([graph]),
          prepare: ({ waitMs }) =>
            waitMs === 0 ? Effect.succeed({ subjects: [] }) : new ToolFailed({ code: 'sleeps-only', reason: 'The command only waits.' }),
          execute: () => Effect.succeed({ command: 'done' }),
        }),
        read_output: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Read command output.',
          refusals: { 'terminal-no-command': 'Command not found' },
          parameters: Schema.Struct({}),
          claims: Effect.fnUntraced(function* () {
            if (holdClaims) {
              holdClaims = false;
              claiming.reach();
              yield* claiming.released;
            }
            return [];
          }),
          execute: () => new ToolFailed({ code: 'terminal-no-command', reason: 'The command is not held.' }),
        }),
        write_graph: Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Write the graph.',
          parameters: Schema.Struct({}),
          mutates: true,
          claims: () => Effect.succeed([graph]),
          execute: () => Effect.succeed({ written: true }),
        }),
      },
      {
        owing: {
          retain: () => Effect.succeed({ release: Effect.void }),
          detaching: () => Effect.void,
          completed: () => Effect.void,
        },
      },
    );
    threadId = run.thread.id;
    yield* run.said(['refused', 'bash', { command: 'sleep 40; echo', waitMs: 60000 }], ['read', 'read_output', {}]);
    const reading = yield* Effect.forkScoped(run.call('read', 'read_output'));
    yield* claiming.reached;
    const refusing = yield* Effect.forkScoped(run.call('refused', 'bash', { command: 'sleep 40; echo', waitMs: 60000 }));
    yield* recording.reached;
    claiming.release();
    yield* run.runner.calls.events().pipe(
      Stream.filter((event) =>
        (event.type === 'snapshot' ? event.calls : [event.call]).some((call) => call.toolCallId === 'read' && call.phase === 'waiting'),
      ),
      Stream.take(1),
      Stream.runDrain,
    );
    recording.release();
    yield* Fiber.join(reading);
    yield* Fiber.join(refusing);
    expect(yield* run.entry('refused')).toMatchObject({ toolState: 'output-refused', toolRefusal: { code: 'sleeps-only' } });
    expect(yield* run.entry('read')).toMatchObject({ toolState: 'output-refused', toolRefusal: { code: 'terminal-no-command' } });
    const background = { command: 'echo ready', waitMs: 0, background: true };
    yield* run.said(['background', 'bash', background]);
    expect((yield* run.call('background', 'bash', background)).failed).toBe(false);
    const phases = yield* run.runner.calls.events().pipe(
      Stream.filter((event) =>
        (event.type === 'snapshot' ? event.calls : [event.call]).some(
          (call) => call.toolCallId === 'background' && (call.phase === 'completed' || call.detail?.startsWith('after ') === true),
        ),
      ),
      Stream.take(1),
      Stream.runCollect,
    );
    const state = phases
      .flatMap((event) => (event.type === 'snapshot' ? event.calls : [event.call]))
      .find((call) => call.toolCallId === 'background');
    expect(state).toMatchObject({ phase: 'completed' });
    yield* run.said(['graph', 'write_graph', {}]);
    expect(yield* run.call('graph', 'write_graph')).toMatchObject({ failed: false, output: { type: 'json', value: { written: true } } });
  }),
);
