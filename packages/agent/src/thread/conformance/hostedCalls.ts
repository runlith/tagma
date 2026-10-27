import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Exit, Fiber, Schema, type Scope } from 'effect';
import type { CallHooks } from '../../agent/AgentCalls';
import { REPORT_ENDED_WAIT, WORDS_ENDED_WAIT } from '../../agent/AgentCall';
import { Tool } from '../../agent/tool';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../permissions/vocabulary';
import type { ThreadToolEntry, ThreadToolExecution } from '../../transcript/entries';
import { hostedToolEntryId } from '../../transcript/entryNames';
import { THREAD_TOOL_CONFIRM_VALUE, USER_QUESTION_TOOL_NAME } from '../../transcript/parts';
import { threadUserQuestionTools } from '../../tools/UserQuestion';
import { READY_ANSWERS_TOOL, threadReadyAnswerTools } from '../../tools/ReadyAnswers';
import { threadEntryEvent } from '../events';
import { ThreadRunNotHeldError } from '../storage/runs';
import { threadCauseOf } from '../ThreadBorder';
import { hosted, RUN, SERVER } from './hostedWorld';
import { gate, until } from './runLog/support';
import { OWNER, SCOPE } from './runLog/world';
import type { ThreadStorageFactory } from './storagePort';
const toolEntry = (toolCallId: string, execution?: ThreadToolExecution): ThreadToolEntry => ({
  type: 'tool',
  id: hostedToolEntryId(RUN, toolCallId),
  runId: RUN,
  toolName: 'act',
  toolCallId,
  toolState: 'input-available',
  toolInput: {},
  execution,
  occurredAt: new Date(1_000).toISOString(),
});
const ASKED = { questions: [{ prompt: 'Which colour?', options: [{ value: 'red', label: 'Red' }] }] };
const counting = (ran: { count: number }): ToolCatalog => ({
  act: Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Count each run.',
    parameters: Schema.Struct({}),
    execute: () => Effect.sync(() => ++ran.count),
  }),
});
const watcher = (watching: ReturnType<typeof gate>): ToolCatalog => ({
  wait: Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Watch until the wait is ended.',
    parameters: Schema.Struct({}),
    execute: (_input, call) =>
      Effect.andThen(
        Effect.sync(() => {
          call.progress?.watch();
          watching.reach();
        }),
        Effect.never,
      ),
  }),
});
export function describeHostedCalls<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: a hosted call lives once, in the record of its run`, () => {
    test.each([
      ['ask_user', { questions: [] }, { argument: 'questions' }],
      [READY_ANSWERS_TOOL, { answers: [] }, { argument: 'answers' }],
      ['ask_user', { questions: [{ prompt: 42 }] }, { argument: 'questions[0].prompt', expected: expect.any(String), sent: '42' }],
      [
        READY_ANSWERS_TOOL,
        {
          answers: [
            { label: 'A', send: 'A' },
            { label: 'B', send: 42 },
          ],
        },
        { argument: 'answers[1].send', expected: expect.any(String), sent: '42' },
      ],
      [
        'ask_user',
        {
          answers: [
            { label: 'A', send: 'A' },
            { label: 'B', send: 'B' },
          ],
        },
        { sibling: READY_ANSWERS_TOOL },
      ],
    ] as const)(
      'invalid %s input answers a typed refusal and leaves the hosted run active',
      Effect.fnUntraced(function* (name, input, detail) {
        const run = yield* hosted(open, { ...threadUserQuestionTools, ...threadReadyAnswerTools });
        yield* run.said(['invalid', name, input]);
        const answer = structuredClone(yield* run.call('invalid', name, input));
        expect(answer).toMatchObject({
          failed: true,
          output: { type: 'text', value: expect.stringContaining('refused[body-shape]:') },
        });
        expect(yield* run.entry('invalid')).toMatchObject({
          toolState: 'output-refused',
          toolRefusal: { code: 'body-shape' },
          toolOutput: { status: 'refused', code: 'body-shape', ...detail },
        });
        expect(yield* run.questions()).toEqual([]);
        expect(
          ((yield* run.storage.aggregate.transcriptOf(run.thread.id)) ?? []).filter((entry) => entry.type === 'ready-answers'),
        ).toEqual([]);
        expect(yield* run.storage.runs({ ownerId: SERVER, scope: SCOPE }).latestRun(run.thread.id)).toMatchObject({
          id: RUN,
          status: 'running',
        });
      }),
    );
    test(
      'a stopped hosted invocation releases its effect when its terminal event commits',
      Effect.fnUntraced(function* () {
        const started = gate();
        const held = new Set<string>();
        const run = yield* hosted(open, {
          act: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Wait until stopped.',
            parameters: Schema.Struct({}),
            mutates: true,
            execute: (_input, call) =>
              Effect.andThen(
                Effect.sync(() => {
                  held.add(call.toolCallId);
                  started.reach();
                }),
                Effect.never,
              ),
            settled: ({ toolCallId }) => {
              held.delete(toolCallId);
            },
          }),
        });
        yield* run.said(['call-held', 'act', {}]);
        const answering = yield* Effect.forkScoped(run.call('call-held', 'act'));
        yield* started.reached;
        expect([...held]).toEqual(['call-held']);
        yield* run.runner.calls.control({ runId: RUN, toolCallId: 'call-held' }, { action: 'stop' });
        yield* Fiber.join(answering);
        expect(yield* run.entry('call-held')).toMatchObject({ toolState: 'output-unknown' });
        expect([...held]).toEqual([]);
      }),
    );
    test(
      'a hosted ready-answers refusal leaves the next valid call visible in the same run',
      Effect.fnUntraced(function* () {
        const run = yield* hosted(open, threadReadyAnswerTools);
        const answers = [
          { label: 'A', send: 'Choose A' },
          { label: 'B', send: 'Choose B' },
        ];
        const valid = { answers, background: false };
        yield* run.said(['invalid', READY_ANSWERS_TOOL, { answers: [] }], ['valid', READY_ANSWERS_TOOL, valid]);
        expect(yield* run.call('invalid', READY_ANSWERS_TOOL, { answers: [] })).toMatchObject({ failed: true });
        expect(yield* run.call('valid', READY_ANSWERS_TOOL, valid)).toMatchObject({
          failed: false,
          output: { type: 'json', value: { status: 'offered' } },
        });
        expect(
          ((yield* run.storage.aggregate.transcriptOf(run.thread.id)) ?? []).filter((entry) => entry.type === 'ready-answers'),
        ).toMatchObject([{ answers }]);
      }),
    );
    test(
      'a call records its start, with the display of its preparation, only once its message is sealed, and its outcome keeps that start',
      Effect.fnUntraced(function* () {
        const ran = gate();
        const run = yield* hosted(open, {
          look: Tool.make({
            approval: ASKS_NEVER,
            description: 'Look at one file until let go.',
            parameters: Schema.Struct({ path: Schema.String }),
            display: ({ path }) => ({ form: 'none', title: path }),
            execute: () => Effect.as(Effect.andThen(Effect.sync(ran.reach), ran.released), { seen: true }),
          }),
        });
        const sealed = gate();
        run.gates.set('look-1', sealed);
        const answering = yield* Effect.forkScoped(run.call('look-1', 'look', { path: 'notes.md' }));
        yield* sealed.reached;
        expect(yield* run.entry('look-1')).toBeUndefined();
        yield* run.said(['look-1', 'look', { path: 'notes.md' }]);
        sealed.release();
        yield* ran.reached;
        const opened = yield* run.entry('look-1');
        ran.release();
        const answer = yield* Fiber.join(answering);
        expect(opened).toMatchObject({ toolState: 'input-available', execution: { state: 'started' }, toolDisplay: { title: 'notes.md' } });
        expect(answer.failed).toBe(false);
        expect(yield* run.entry('look-1')).toMatchObject({ toolState: 'output-available', execution: opened!.execution! });
      }),
    );
    test(
      'a repeated call whose record shows it started, or shows nothing, answers unknown and runs nothing',
      Effect.fnUntraced(function* () {
        const ran = { count: 0 };
        const run = yield* hosted(open, counting(ran));
        yield* run.said(['started-1', 'act', {}], ['silent-1', 'act', {}]);
        yield* run.apply(
          run.reports.recorded(
            run.run,
            [
              threadEntryEvent(toolEntry('started-1', { state: 'started', at: new Date(yield* Clock.currentTimeMillis).toISOString() })),
              threadEntryEvent(toolEntry('silent-1')),
            ],
            'entries:restart',
          ),
        );
        const answers = [yield* run.call('started-1', 'act'), yield* run.call('silent-1', 'act')];
        expect(answers.map((answer) => answer.failed)).toEqual([true, true]);
        expect(ran.count).toBe(0);
        expect(yield* run.entry('started-1')).toMatchObject({ toolState: 'output-unknown', execution: { state: 'started' } });
        expect(yield* run.entry('silent-1')).toMatchObject({ toolState: 'output-unknown' });
      }),
    );
    test(
      'a call to a foreign run refuses run-not-held when the ownership wait lapses',
      Effect.fnUntraced(function* () {
        const ran = { count: 0 };
        const run = yield* hosted(open, counting(ran), { owner: 'gone-server', rhythm: { takeoverAfterMs: 120, heartbeatIntervalMs: 10 } });
        expect(threadCauseOf(yield* Effect.flip(run.call('late-1', 'act')))).toBeInstanceOf(ThreadRunNotHeldError);
        expect(ran.count).toBe(0);
      }),
    );
    test(
      'a call to a foreign run waits for ownership and runs once it is adopted',
      Effect.fnUntraced(function* () {
        const ran = { count: 0 };
        const run = yield* hosted(open, counting(ran), {
          owner: 'gone-server',
          rhythm: { takeoverAfterMs: 10_000, heartbeatIntervalMs: 10 },
        });
        yield* run.storage.runs({ ownerId: 'gone-server', scope: SCOPE }).handOverRuns([RUN], new Date(yield* Clock.currentTimeMillis));
        const answering = yield* Effect.forkScoped(run.call('taken-1', 'act'));
        const ownership = yield* run.world.harness.runs.ownership();
        const adopted = yield* ownership.adopt({
          id: RUN,
          threadId: run.thread.id,
          kind: 'turn',
          gapMs: 0,
          selector: { kind: 'handed-over' },
          resumeLimit: 1,
          stopRequest: null,
        });
        expect(adopted).toBe('adopted');
        expect((yield* Fiber.join(answering)).failed).toBe(false);
        expect(ran.count).toBe(1);
      }),
    );
    test(
      'an outcome that arrives after its run ended is not written, and the call answers that the run ended',
      Effect.fnUntraced(function* () {
        const ran = gate();
        const run = yield* hosted(open, {
          hold: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Hold until let go.',
            parameters: Schema.Struct({}),
            execute: () => Effect.as(Effect.andThen(Effect.sync(ran.reach), ran.released), { held: true }),
          }),
        });
        yield* run.said(['hold-1', 'hold', {}]);
        const answering = yield* Effect.forkScoped(run.call('hold-1', 'hold'));
        yield* ran.reached;
        const now = new Date(yield* Clock.currentTimeMillis);
        yield* run.storage.runs({ ownerId: SERVER, scope: SCOPE }).settleRun(RUN, {
          status: 'completed',
          progress: { stage: 'completed', message: 'Thread run completed.' },
          finishedAt: now,
          heartbeatAt: now,
        });
        ran.release();
        expect((yield* Fiber.join(answering)).failed).toBe(true);
        expect(yield* run.entry('hold-1')).toMatchObject({ toolState: 'input-available', execution: { state: 'started' } });
      }),
    );
    test(
      'the end of a run closes a call queued behind a recorded start as not run, and every call without that proof as unknown',
      Effect.fnUntraced(function* () {
        const run = yield* hosted(open, {});
        yield* run.apply(
          run.reports.recorded(
            run.run,
            [
              threadEntryEvent(
                toolEntry('tagma-started', { state: 'started', at: new Date(yield* Clock.currentTimeMillis).toISOString() }),
              ),
              threadEntryEvent(toolEntry('tagma-queued', { state: 'queued', gated: true })),
              threadEntryEvent(toolEntry('vendor-queued', { state: 'queued' })),
              threadEntryEvent(toolEntry('terminal')),
            ],
            'entries:closing',
          ),
        );
        yield* run.apply(run.reports.ended(run.run, { kind: 'failed', reason: 'the process exited' }));
        expect(Object.fromEntries((yield* run.tools()).map((entry) => [entry.toolCallId, entry.toolState]))).toEqual({
          'tagma-started': 'output-unknown',
          'tagma-queued': 'output-cancelled',
          'vendor-queued': 'output-unknown',
          terminal: 'output-unknown',
        });
      }),
    );
  });
  describe(`${name}: a hosted call waits and stops the way a native call does`, () => {
    test(
      "the operator's words handed to the agent end a hosted wait, each answer names them, and words still unread end the next wait at once",
      Effect.fnUntraced(function* () {
        const watching = gate();
        const run = yield* hosted(open, watcher(watching));
        yield* run.said(['wait-1', 'wait', {}], ['wait-2', 'wait', {}]);
        const answering = yield* Effect.forkScoped(run.call('wait-1', 'wait'));
        yield* watching.reached;
        const said = yield* run.world.harness.threads.handle(run.thread.id, OWNER).send('Look here instead.');
        const first = yield* Fiber.join(answering);
        const second = yield* run.call('wait-2', 'wait');
        const steered = said.status === 'steered' ? [said.itemId] : [];
        expect(steered).toHaveLength(1);
        expect(JSON.stringify(first.output)).toContain(WORDS_ENDED_WAIT);
        expect(JSON.stringify(second.output)).toContain(WORDS_ENDED_WAIT);
        expect([first.words, second.words]).toEqual([steered, steered]);
      }),
    );
    test(
      'a report owed to the agent ends a hosted wait and names the report as its cause',
      Effect.fnUntraced(function* () {
        const watching = gate();
        const run = yield* hosted(open, watcher(watching));
        const child = yield* run.storage.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* run.said(['wait-report', 'wait', {}]);
        const answering = yield* Effect.forkScoped(run.call('wait-report', 'wait'));
        yield* watching.reached;
        yield* run.world.harness.inputs.deliver(run.thread.id, OWNER, {
          id: 'envelope:report:reviewed',
          senderThreadId: child.id,
          intent: 'report',
          text: 'Review: the gate holds.',
        });
        const answer = yield* Fiber.join(answering);
        expect(JSON.stringify(answer.output)).toContain(`wait-ended: ${REPORT_ENDED_WAIT}`);
      }),
    );
    test(
      'stopping a hosted call that waits for its confirmation clears the question, and nothing runs',
      Effect.fnUntraced(function* () {
        const ran = { count: 0 };
        const run = yield* hosted(open, {
          change: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_IN_REVIEW,
            description: 'Change one durable thing.',
            parameters: Schema.Struct({}),
            execute: () => Effect.sync(() => ++ran.count),
            mutates: true,
            confirmation: { prompt: () => ({ summary: 'Change it?' }), confirmLabel: 'Change' },
          }),
        });
        yield* run.world.harness.threads.handle(run.thread.id, OWNER).setAuthorityMode('review');
        yield* run.said(['change-1', 'change', {}]);
        const answering = yield* Effect.forkScoped(run.call('change-1', 'change'));
        yield* until(() => Effect.map(run.questions(), (questions) => questions.length > 0));
        const stopped = yield* run.runner.calls.control({ runId: RUN, toolCallId: 'change-1' }, { action: 'stop' });
        const answer = yield* Fiber.join(answering);
        expect(stopped.status).toBe('changed');
        expect(answer.failed).toBe(true);
        expect(ran.count).toBe(0);
        expect((yield* run.questions()).map((question) => question.status)).toEqual(['cleared']);
        expect(yield* run.entry('change-1')).toMatchObject({ toolState: 'output-cancelled' });
      }),
    );
    test(
      'two edits of one file in one message, called at once, apply in the order of the message',
      Effect.fnUntraced(function* () {
        const applied: string[] = [];
        const first = gate();
        const run = yield* hosted(open, {
          edit: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Edit one file.',
            parameters: Schema.Struct({ label: Schema.String }),
            claims: () => Effect.succeed([{ on: { kind: 'file' as const, path: 'notes.md' }, access: 'write' as const }]),
            execute: Effect.fnUntraced(function* ({ label }) {
              if (label === 'first') {
                first.reach();
                yield* first.released;
              }
              applied.push(label);
              return { applied: label };
            }),
          }),
        });
        yield* run.said(['edit-1', 'edit', { label: 'first' }], ['edit-2', 'edit', { label: 'second' }]);
        const second = yield* Effect.forkScoped(run.call('edit-2', 'edit', { label: 'second' }));
        yield* until(() => Effect.map(run.entry('edit-2'), (entry) => entry?.execution?.state === 'queued'));
        const earlier = yield* Effect.forkScoped(run.call('edit-1', 'edit', { label: 'first' }));
        yield* first.reached;
        first.release();
        yield* Fiber.join(earlier);
        yield* Fiber.join(second);
        expect(applied).toEqual(['first', 'second']);
      }),
    );
    test(
      'an edit queued behind an earlier one runs once that earlier call is answered before reaching Tagma',
      Effect.fnUntraced(function* () {
        const applied: string[] = [];
        const run = yield* hosted(open, {
          edit: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Edit one file.',
            parameters: Schema.Struct({ label: Schema.String }),
            claims: () => Effect.succeed([{ on: { kind: 'file' as const, path: 'notes.md' }, access: 'write' as const }]),
            execute: ({ label }) => Effect.sync(() => applied.push(label)),
          }),
        });
        yield* run.said(['edit-1', 'edit', { label: 'first' }], ['edit-2', 'edit', { label: 'second' }]);
        const second = yield* Effect.forkScoped(run.call('edit-2', 'edit', { label: 'second' }));
        yield* until(() => Effect.map(run.entry('edit-2'), (entry) => entry?.execution?.state === 'queued'));
        yield* run.apply(
          run.reports.recorded(
            run.run,
            [
              threadEntryEvent({
                ...toolEntry('edit-1'),
                toolName: 'edit',
                toolState: 'output-error',
                toolError: 'Input refused upstream.',
              }),
            ],
            'entries:refused',
          ),
        );
        expect((yield* Fiber.join(second)).failed).toBe(false);
        expect(applied).toEqual(['second']);
      }),
    );
    test(
      'an edit queued behind an earlier one moved to the background waits for that edit to finish, not for its receipt',
      Effect.fnUntraced(function* () {
        const applied: string[] = [];
        const first = gate();
        const run = yield* hosted(open, {
          edit: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Edit one file.',
            parameters: Schema.Struct({ label: Schema.String }),
            claims: () => Effect.succeed([{ on: { kind: 'file' as const, path: 'notes.md' }, access: 'write' as const }]),
            execute: Effect.fnUntraced(function* ({ label }) {
              if (label === 'first') {
                first.reach();
                yield* first.released;
              }
              applied.push(label);
              return { applied: label };
            }),
          }),
        });
        yield* run.said(['edit-1', 'edit', { label: 'first' }], ['edit-2', 'edit', { label: 'second' }]);
        const earlier = yield* Effect.forkScoped(run.call('edit-1', 'edit', { label: 'first' }));
        yield* first.reached;
        yield* run.runner.calls.control({ runId: RUN, toolCallId: 'edit-1' }, { action: 'background' });
        yield* Fiber.join(earlier);
        const second = yield* Effect.forkScoped(run.call('edit-2', 'edit', { label: 'second' }));
        yield* until(() => Effect.map(run.entry('edit-2'), (entry) => entry?.execution?.state === 'queued'));
        expect(applied).toEqual([]);
        first.release();
        yield* Fiber.join(second);
        expect(applied).toEqual(['first', 'second']);
      }),
    );
    test(
      'a queued call whose start can no longer be recorded, because its run ended, never runs',
      Effect.fnUntraced(function* () {
        const applied: string[] = [];
        const first = gate();
        const run = yield* hosted(open, {
          edit: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Edit one file.',
            parameters: Schema.Struct({ label: Schema.String }),
            claims: () => Effect.succeed([{ on: { kind: 'file' as const, path: 'notes.md' }, access: 'write' as const }]),
            execute: Effect.fnUntraced(function* ({ label }) {
              if (label === 'first') {
                first.reach();
                yield* first.released;
              }
              applied.push(label);
              return { applied: label };
            }),
          }),
        });
        yield* run.said(['edit-1', 'edit', { label: 'first' }], ['edit-2', 'edit', { label: 'second' }]);
        const earlier = yield* Effect.forkScoped(run.call('edit-1', 'edit', { label: 'first' }));
        yield* first.reached;
        const second = yield* Effect.forkScoped(run.call('edit-2', 'edit', { label: 'second' }));
        yield* until(() => Effect.map(run.entry('edit-2'), (entry) => entry?.execution?.state === 'queued'));
        const now = new Date(yield* Clock.currentTimeMillis);
        yield* run.storage.runs({ ownerId: SERVER, scope: SCOPE }).settleRun(RUN, {
          status: 'completed',
          progress: { stage: 'completed', message: 'Thread run completed.' },
          finishedAt: now,
          heartbeatAt: now,
        });
        first.release();
        yield* Fiber.join(earlier);
        yield* Fiber.join(second);
        expect(applied).toEqual(['first']);
        expect(yield* run.entry('edit-2')).toMatchObject({ execution: { state: 'queued' } });
      }),
    );
    test(
      'an edit behind an earlier one still awaiting its confirmation is refused for the next step, and runs nothing',
      Effect.fnUntraced(function* () {
        const applied: string[] = [];
        const run = yield* hosted(open, {
          edit: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_IN_REVIEW,
            description: 'Edit one file.',
            parameters: Schema.Struct({ label: Schema.String }),
            claims: () => Effect.succeed([{ on: { kind: 'file' as const, path: 'notes.md' }, access: 'write' as const }]),
            execute: ({ label }) => Effect.sync(() => applied.push(label)),
            mutates: true,
            confirmation: { prompt: () => ({ summary: 'Edit it?' }), confirmLabel: 'Edit' },
          }),
        });
        yield* run.world.harness.threads.handle(run.thread.id, OWNER).setAuthorityMode('review');
        yield* run.said(['edit-1', 'edit', { label: 'first' }], ['edit-2', 'edit', { label: 'second' }]);
        yield* Effect.forkScoped(run.call('edit-1', 'edit', { label: 'first' }));
        yield* until(() => Effect.map(run.questions(), (questions) => questions.length > 0));
        const second = yield* run.call('edit-2', 'edit', { label: 'second' });
        expect(second.failed).toBe(true);
        expect(JSON.stringify(second.output)).toContain('edit-1');
        expect(applied).toEqual([]);
      }),
    );
    test(
      'a question is asked only once its message is sealed, records its start, and the end of its run closes it as unknown, never as not run',
      Effect.fnUntraced(function* () {
        const run = yield* hosted(open, threadUserQuestionTools);
        const sealed = gate();
        run.gates.set('ask-1', sealed);
        yield* Effect.forkScoped(run.call('ask-1', USER_QUESTION_TOOL_NAME, ASKED));
        yield* sealed.reached;
        expect(yield* run.questions()).toEqual([]);
        yield* run.said(['ask-1', USER_QUESTION_TOOL_NAME, ASKED]);
        yield* run.apply(
          run.reports.recorded(
            run.run,
            [threadEntryEvent({ ...toolEntry('ask-1', { state: 'queued', gated: true }), toolName: USER_QUESTION_TOOL_NAME })],
            'entries:asked',
          ),
        );
        sealed.release();
        yield* until(() => Effect.map(run.questions(), (questions) => questions.length > 0));
        expect(yield* run.entry('ask-1')).toMatchObject({ execution: { state: 'started' } });
        yield* run.apply(run.reports.ended(run.run, { kind: 'failed', reason: 'the process exited' }));
        expect(yield* run.entry('ask-1')).toMatchObject({ toolState: 'output-unknown' });
      }),
    );
  });
  describe(`${name}: a hosted call taken to the background before it runs`, () => {
    const owingInto = (landed: Deferred.Deferred<unknown>, owed: string[]): CallHooks => ({
      retain: () => Effect.succeed({ release: Effect.void }),
      detaching: (record) => Effect.sync(() => owed.push(record.toolCallId)),
      began: () => Effect.void,
      completed: (_record, exit) => Deferred.succeed(landed, Exit.isSuccess(exit) ? exit.value.output : 'failed').pipe(Effect.asVoid),
    });
    test(
      'a call asking for the background answers while its preparation is held, stays settled as its receipt, and runs once prepared',
      Effect.fnUntraced(function* () {
        const ran = { count: 0 };
        const preparing = gate();
        const owed: string[] = [];
        const landed = yield* Deferred.make<unknown>();
        const run = yield* hosted(
          open,
          {
            act: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Prepare slowly, then act.',
              parameters: Schema.Struct({}),
              mutates: true,
              prepare: () => Effect.andThen(Effect.sync(preparing.reach), preparing.released).pipe(Effect.as({ subjects: [] })),
              execute: () => Effect.sync(() => ++ran.count),
            }),
            look: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Look once.',
              parameters: Schema.Struct({}),
              execute: () => Effect.succeed({ seen: true }),
            }),
          },
          { owing: owingInto(landed, owed) },
        );
        yield* run.said(['act-1', 'act', { background: true }], ['look-1', 'look', {}]);
        expect((yield* run.call('look-1', 'look')).failed).toBe(false);
        const answer = yield* run.call('act-1', 'act', { background: true });
        expect(answer.failed).toBe(false);
        expect(JSON.stringify(answer.output)).toContain('has not run yet');
        yield* preparing.reached;
        expect(ran.count).toBe(0);
        expect(yield* run.entry('act-1')).toMatchObject({ toolState: 'output-available' });
        preparing.release();
        expect(yield* Deferred.await(landed)).toEqual(1);
        expect(ran.count).toBe(1);
        expect(owed).toEqual(['act-1']);
        expect(run.runner.calls.get({ runId: RUN, toolCallId: 'act-1' })?.record).toMatchObject({ phase: 'completed', mode: 'background' });
      }),
    );
    test(
      'the operator moves a call waiting for its confirmation to the background: the question moves to the thread, and the answer runs it',
      Effect.fnUntraced(function* () {
        const ran = { count: 0 };
        const landed = yield* Deferred.make<unknown>();
        const run = yield* hosted(
          open,
          {
            change: Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_IN_REVIEW,
              description: 'Change one durable thing.',
              parameters: Schema.Struct({}),
              execute: () => Effect.sync(() => ++ran.count),
              mutates: true,
              confirmation: { prompt: () => ({ summary: 'Change it?' }), confirmLabel: 'Change' },
            }),
          },
          { owing: owingInto(landed, []) },
        );
        yield* run.world.harness.threads.handle(run.thread.id, OWNER).setAuthorityMode('review');
        yield* run.said(['change-1', 'change', {}]);
        const answering = yield* Effect.forkScoped(run.call('change-1', 'change'));
        yield* until(() => Effect.map(run.questions(), (questions) => questions.some((question) => question.status === 'open')));
        const moved = yield* run.runner.calls.control({ runId: RUN, toolCallId: 'change-1' }, { action: 'background' });
        expect(moved.status).toBe('changed');
        expect((yield* Fiber.join(answering)).failed).toBe(false);
        yield* until(() =>
          Effect.map(run.questions(), (questions) =>
            questions.some((question) => question.status === 'open' && question.runId === `approvals:${run.thread.id}`),
          ),
        );
        const questions = yield* run.questions();
        expect(questions.map((question) => [question.runId, question.status])).toEqual([
          [RUN, 'cleared'],
          [`approvals:${run.thread.id}`, 'open'],
        ]);
        expect(ran.count).toBe(0);
        const standing = questions.find((question) => question.status === 'open')!;
        yield* run.world.harness.runs
          .questions()
          .answer(run.thread.id, standing.questionId, [{ questionId: 'change-1', values: [THREAD_TOOL_CONFIRM_VALUE] }]);
        expect(yield* Deferred.await(landed)).toEqual(1);
        expect(ran.count).toBe(1);
      }),
    );
  });
}
