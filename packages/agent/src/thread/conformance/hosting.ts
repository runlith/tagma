import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Duration, Effect, Fiber, Schema, type Scope } from 'effect';
import { type AgentCalls, makeAgentCalls } from '../../agent/AgentCalls';
import { openToolDoor } from '../../agent/door/openToolDoor';
import { ToolJudge } from '../../agent/door/openToolDoor';
import { Tool } from '../../agent/tool';
import { type CatalogVerdicts, type ToolGrant, resolveCatalog } from '../../catalog/resolveCatalog';
import { threadUserQuestionTools } from '../../tools/UserQuestion';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import {
  THREAD_TOOL_CANCEL_VALUE,
  THREAD_TOOL_CONFIRM_KIND,
  THREAD_TOOL_CONFIRM_VALUE,
  USER_QUESTION_TOOL_NAME,
} from '../../transcript/parts';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import { threadCaller, type ThreadHostedRun, type ThreadPreparedRun } from '../agents/ThreadAgent';
import type { ApprovalNotice, ApproverRoute, ApproversPort } from '../Approvers';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '../storage/runs';
import { hangingTurn } from './runLog/scripts';
import { gate, until } from './runLog/support';
import { OWNER, openedRun, scriptedWorld, startedTurn, type ScriptedWorld } from './runLog/world';
import type { ThreadStorageFactory } from './storagePort';
import { ASKS_IN_REVIEW } from '../../permissions/vocabulary';
const CALL = 'call-1';
const ASKED = {
  questions: [
    {
      prompt: 'Which colour?',
      options: [
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ],
    },
  ],
};
type Limit = {
  withinMs?: number;
};
const actingCatalog = (acted: string[], limit: Limit): ToolCatalog => {
  const act = Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_IN_REVIEW,
    description: 'Act on a target.',
    parameters: Schema.Struct({ of: Schema.String }),
    prepare: (input) =>
      Effect.succeed({ subjects: [{ kind: 'read' as const, value: `thread://owner/${input.of}`, binding: input.of }], prepared: input.of }),
    execute: (input) =>
      Effect.sync(() => {
        acted.push(input.of);
        return { acted: input.of };
      }),
    mutates: true,
    confirmation: { prompt: () => ({ summary: 'Act on the target?' }), confirmLabel: 'Act' },
  });
  Object.defineProperty(act, 'approval', {
    get: () => ({ asksFrom: 'review', timeout: limit.withinMs === undefined ? 'none' : Duration.millis(limit.withinMs) }),
  });
  return { act };
};
type Admission = {
  readonly grant: ToolGrant;
  readonly verdicts?: CatalogVerdicts;
};
const hosted =
  (
    catalog: ToolCatalog,
    calls: AgentCalls,
    admission?: Admission,
    web: ThreadHostedRun['web'] = 'none',
  ): NonNullable<ThreadPreparedRun['host']> =>
  (input) =>
    Effect.sync(() => {
      const resolved =
        admission === undefined
          ? { catalog: { ...catalog, ...threadUserQuestionTools }, withheld: [] }
          : resolveCatalog(
              { grant: admission.grant },
              {},
              [
                { source: 'acting', tools: catalog },
                { source: 'user-question', tools: threadUserQuestionTools },
              ],
              admission.verdicts,
            );
      const hooks = input.callHooks;
      const door = openToolDoor(
        input.run.id,
        threadCaller(input.thread, input.run.id),
        {},
        new ToolJudge(input.modeOf),
        undefined,
        undefined,
        undefined,
        undefined,
        calls,
        hooks === undefined ? undefined : () => hooks,
      );
      const unbound = calls.bind(input.run.id, input.stop);
      return {
        instructions: 'Hosted prompt',
        catalog: () => resolved.catalog,
        withheld: () => resolved.withheld,
        place: () => Effect.void,
        refresh: () => Effect.void,
        door,
        web,
        stop: () => Effect.void,
        close: () => Effect.ensuring(door.close(), Effect.sync(unbound)),
      };
    });
const HOSTED_BINDING = { adapter: 'native', profile: null, agent: 'hosted' } as const;
const SERVER = 'hosting-server';
const harnessOver = (approvers?: ApproversPort) => ({ ownerId: SERVER, approvers });
export function describeThreadHosting<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  const hostedTurn = Effect.fnUntraced(function* (
    withinMs?: number,
    admission?: Admission,
    approvers?: ApproversPort,
    web?: ThreadHostedRun['web'],
  ) {
    const acted: string[] = [];
    const limit: Limit = { withinMs };
    const catalog = actingCatalog(acted, limit);
    const { storage, world, thread } = yield* openedRun(open, {
      catalog,
      host: hosted(catalog, yield* makeAgentCalls({ history: 8 }), admission, web),
      harness: harnessOver(approvers),
      transport: HOSTED_BINDING,
    });
    yield* world.harness.threads.handle(thread.id, OWNER).setAuthorityMode('review');
    const reached = gate();
    world.plan.push(hangingTurn({ chunks: [], reached: reached.reach }));
    yield* startedTurn(world, thread.id, 'Host this turn.');
    yield* reached.reached;
    const callOn = (on: ScriptedWorld) => () =>
      on.harness.runs.hosting().call({
        threadId: thread.id,
        agentId: thread.agentId,
        toolCallId: CALL,
        name: 'act',
        input: { of: 'target' },
        arguments: '{"of":"target"}',
      });
    const rebuilt = () =>
      Effect.flatMap(makeAgentCalls({ history: 8 }), (calls) =>
        scriptedWorld(storage, thread.agentId, { catalog, host: hosted(catalog, calls, admission), harness: harnessOver(approvers) }),
      );
    const questions = () =>
      Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) =>
        (entries ?? []).filter((entry): entry is ThreadQuestionEntry & typeof entry => entry.type === 'question'),
      );
    const stage = () => Effect.map(world.harness.reads.snapshot(thread.id), (state) => state.activeRun?.progress.stage ?? null);
    const asked = Effect.fnUntraced(function* () {
      yield* until(() => Effect.map(questions(), (entries) => entries.length > 0));
      return (yield* questions())[0]!;
    });
    const ask = () =>
      world.harness.runs.hosting().call({
        threadId: thread.id,
        agentId: thread.agentId,
        toolCallId: 'ask-1',
        name: USER_QUESTION_TOOL_NAME,
        input: ASKED,
        arguments: JSON.stringify(ASKED),
      });
    const pending = () => Effect.forkScoped(callOn(world)());
    return { acted, limit, call: callOn(world), callOn, ask, pending, rebuilt, questions, stage, asked, storage, thread, world };
  });
  test(
    `${name}: a hosted keep-warm run refuses tools and questions without changing their state`,
    Effect.fnUntraced(function* () {
      const acted: string[] = [];
      const catalog = actingCatalog(acted, {});
      const { world, thread } = yield* openedRun(open, {
        catalog,
        host: hosted(catalog, yield* makeAgentCalls({ history: 8 })),
        harness: harnessOver(),
        transport: HOSTED_BINDING,
      });
      const reached = gate();
      world.plan.push(hangingTurn({ chunks: [], reached: reached.reach }));
      const handle = world.harness.threads.handle(thread.id, OWNER);
      yield* handle.setAuthorityMode('bypass');
      expect(yield* handle.keepWarm('keep-warm-hosted')).toMatchObject({ status: 'woken' });
      yield* reached.reached;
      const hosting = world.harness.runs.hosting();
      const call = { threadId: thread.id, agentId: thread.agentId };
      const action = yield* hosting.call({ ...call, toolCallId: CALL, name: 'act', input: { of: 'target' }, arguments: '{"of":"target"}' });
      const question = yield* hosting.call({
        ...call,
        toolCallId: 'ask-warm',
        name: USER_QUESTION_TOOL_NAME,
        input: ASKED,
        arguments: JSON.stringify(ASKED),
      });
      expect(action.failed).toBe(true);
      expect(question.failed).toBe(true);
      expect(acted).toEqual([]);
      expect(yield* world.harness.runs.questions().open(thread.id)).toEqual([]);
    }),
  );
  describe(`${name}: a hosted run asks the way a native run asks`, () => {
    test(
      'a call the mode asks about poses one confirmation and holds the run awaiting; the allow executes it once',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const hosting = run.world.harness.runs.hosting();
        const answering = yield* Effect.forkScoped(run.call());
        const question = yield* run.asked();
        expect(question.questions.map((prompt) => prompt.kind)).toEqual([THREAD_TOOL_CONFIRM_KIND]);
        expect(question.toolCalls).toEqual([{ toolCallId: CALL, toolName: 'act' }]);
        yield* until(() => Effect.map(run.stage(), (stage) => stage === THREAD_RUN_AWAITING_QUESTION_STAGE));
        expect(run.acted).toEqual([]);
        expect(yield* hosting.holds(run.thread.id, question.questionId)).toBe(true);
        expect((yield* run.world.harness.reads.snapshot(run.thread.id)).status.openQuestions).toEqual([question.questionId]);
        yield* hosting.answer(run.thread.id, question.questionId, [{ questionId: CALL, values: [THREAD_TOOL_CONFIRM_VALUE] }]);
        const answer = yield* Fiber.join(answering);
        expect(answer.failed).toBe(false);
        expect(run.acted).toEqual(['target']);
        expect(yield* run.stage()).not.toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
        expect((yield* run.world.harness.reads.snapshot(run.thread.id)).status.openQuestions).toEqual([]);
        expect((yield* run.call()).output).toEqual(answer.output);
        expect(run.acted).toEqual(['target']);
        expect(yield* run.questions()).toHaveLength(1);
      }),
    );
    test(
      'opening the turn reports whose web the run searches and reads with',
      Effect.fnUntraced(function* () {
        for (const web of ['vendor', 'none'] as const)
          yield* Effect.scoped(
            Effect.gen(function* () {
              const run = yield* hostedTurn(undefined, undefined, undefined, web);
              expect((yield* run.world.harness.runs.hosting().open(run.thread.id, run.thread.agentId)).web).toBe(web);
              expect((yield* run.world.harness.runs.hosting().agent(run.thread.id, run.thread.agentId)).web).toBe(web);
            }),
          );
      }),
    );
    test(
      'every opening of a hosted turn orients from the one preparation its run holds',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const before = run.world.prepared();
        const hosting = run.world.harness.runs.hosting();
        yield* hosting.open(run.thread.id, run.thread.agentId);
        yield* hosting.open(run.thread.id, run.thread.agentId);
        expect(run.world.prepared()).toBe(before + 1);
      }),
    );
    test(
      'the hosted tool list is the run catalog, and a call to a name outside it is refused and runs nothing',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const hosting = run.world.harness.runs.hosting();
        const listed = yield* hosting.tools(run.thread.id, run.thread.agentId);
        expect(listed.tools.map((offered) => offered.name).sort()).toEqual(['act', USER_QUESTION_TOOL_NAME]);
        expect([...listed.names].sort()).toEqual(['act', USER_QUESTION_TOOL_NAME]);
        const answer = yield* hosting.call({
          threadId: run.thread.id,
          agentId: run.thread.agentId,
          toolCallId: 'ungranted-1',
          name: 'secret',
          input: {},
          arguments: '{}',
        });
        expect(answer.failed).toBe(true);
        expect(run.acted).toEqual([]);
      }),
    );
    describe('ask_user is admitted like every other call', () => {
      const asking = (admission: Admission) =>
        Effect.fnUntraced(function* () {
          const run = yield* hostedTurn(undefined, admission);
          const answer = yield* run.world.harness.runs.hosting().call({
            threadId: run.thread.id,
            agentId: run.thread.agentId,
            toolCallId: 'ask-ungranted',
            name: USER_QUESTION_TOOL_NAME,
            input: ASKED,
            arguments: JSON.stringify(ASKED),
          });
          expect(answer.failed).toBe(true);
          expect(yield* run.questions()).toEqual([]);
        });
      test(
        'an agent granted act alone is refused an ask_user call, and no question is posed',
        asking({ grant: { sources: [{ source: 'acting', tools: ['act'] }] } }),
      );
      test(
        'an unconditional deny of ask_user refuses the call even where its source is granted',
        asking({
          grant: { sources: [{ source: 'acting' }, { source: 'user-question' }] },
          verdicts: (name) => (name === USER_QUESTION_TOOL_NAME ? { rule: 'no-questions' } : null),
        }),
      );
    });
    test(
      'a parent decline keeps its author and note in the denied call and nothing executes',
      Effect.fnUntraced(function* () {
        const approvers: ApproversPort = {
          route: () => Effect.succeed({ approver: 'parent-thread', why: 'parent' }),
          grantOf: () => Effect.succeed(['act']),
          notify: () => Effect.void,
        };
        const run = yield* hostedTurn(undefined, undefined, approvers);
        const answering = yield* Effect.forkScoped(run.call());
        const question = yield* run.asked();
        yield* run.world.harness.runs.questions().decide({
          threadId: run.thread.id,
          questionId: question.questionId,
          caller: 'parent-thread',
          note: 'leave the target alone',
        });
        yield* run.world.harness.runs
          .hosting()
          .answer(run.thread.id, question.questionId, [{ questionId: CALL, values: [THREAD_TOOL_CANCEL_VALUE] }]);
        expect(yield* Fiber.join(answering)).toMatchObject({
          failed: true,
          output: {
            type: 'text',
            value: expect.stringMatching(/^refused\[declined\][\s\S]*by: parent-thread\nnote: leave the target alone$/),
          },
        });
        expect(run.acted).toEqual([]);
        expect(((yield* run.storage.aggregate.transcriptOf(run.thread.id)) ?? []).filter((entry) => entry.type === 'tool')).toEqual([
          expect.objectContaining({ toolCallId: CALL, toolState: 'output-denied' }),
        ]);
      }),
    );
    test(
      'a question the door gave a deadline declines the call when no answer comes in time',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn(30);
        expect(yield* run.call()).toMatchObject({
          failed: true,
          output: {
            type: 'text',
            value: expect.stringMatching(/^refused\[unanswered\][\s\S]*questionId: call-1\naskedOf: operator\ntimeoutMs: 30$/),
          },
        });
        expect(run.acted).toEqual([]);
        expect((yield* run.questions())[0]?.status).toBe('lapsed');
        expect(yield* run.stage()).not.toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
      }),
    );
    test(
      'a host built again over an open confirmation takes the repeated call onto it, and its answer executes once',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        yield* run.pending();
        const question = yield* run.asked();
        const rebuilt = yield* run.rebuilt();
        const hosting = rebuilt.harness.runs.hosting();
        expect(yield* hosting.holds(run.thread.id, question.questionId)).toBe(true);
        const repeated = yield* Effect.forkScoped(run.callOn(rebuilt)());
        yield* until(() => Effect.map(run.stage(), (stage) => run.acted.length === 0 && stage === THREAD_RUN_AWAITING_QUESTION_STAGE));
        yield* hosting.answer(run.thread.id, question.questionId, [{ questionId: CALL, values: [THREAD_TOOL_CONFIRM_VALUE] }]);
        const answer = yield* Fiber.join(repeated);
        expect(answer.failed).toBe(false);
        expect(run.acted).toEqual(['target']);
        expect(yield* run.questions()).toHaveLength(1);
        expect((yield* run.callOn(rebuilt)()).output).toEqual(answer.output);
        expect(run.acted).toEqual(['target']);
      }),
    );
    test(
      'an answer recorded before the runner repeats its call is used once, by that host and by one built after it',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        yield* run.pending();
        const question = yield* run.asked();
        const rebuilt = yield* run.rebuilt();
        yield* rebuilt.harness.runs
          .hosting()
          .answer(run.thread.id, question.questionId, [{ questionId: CALL, values: [THREAD_TOOL_CONFIRM_VALUE] }]);
        expect(run.acted).toEqual([]);
        const answer = yield* run.callOn(rebuilt)();
        const later = yield* run.callOn(yield* run.rebuilt())();
        expect(answer.failed).toBe(false);
        expect(later.output).toEqual(answer.output);
        expect(run.acted).toEqual(['target']);
        expect(yield* run.questions()).toHaveLength(1);
      }),
    );
    test(
      'a cancelled confirmation is answered as cancelled again by a host built after it',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        yield* run.pending();
        const question = yield* run.asked();
        yield* run.world.harness.runs
          .hosting()
          .answer(run.thread.id, question.questionId, [{ questionId: CALL, values: [THREAD_TOOL_CANCEL_VALUE] }]);
        const first = yield* run.callOn(yield* run.rebuilt())();
        const again = yield* run.callOn(yield* run.rebuilt())();
        expect(first.failed).toBe(true);
        expect(again.output).toEqual(first.output);
        expect(run.acted).toEqual([]);
      }),
    );
    test(
      'a deadline runs from the time the question was asked, across a host built again',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn(30);
        yield* run.pending();
        yield* run.asked();
        run.limit.withinMs = 60_000;
        const answer = yield* run.callOn(yield* run.rebuilt())();
        expect(answer).toMatchObject({
          failed: true,
          output: { type: 'text', value: expect.stringMatching(/^refused\[unanswered\][\s\S]*timeoutMs: 30$/) },
        });
        expect(run.acted).toEqual([]);
        expect((yield* run.questions())[0]?.status).toBe('lapsed');
      }),
    );
    test(
      'switching the thread to bypass answers the open confirmation, and the call executes',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const answering = yield* Effect.forkScoped(run.call());
        yield* run.asked();
        yield* run.world.harness.threads.handle(run.thread.id, OWNER).setAuthorityMode('bypass');
        expect((yield* Fiber.join(answering)).failed).toBe(false);
        expect(run.acted).toEqual(['target']);
        expect((yield* run.questions())[0]?.status).toBe('answered');
        yield* until(() => Effect.map(run.stage(), (stage) => stage !== THREAD_RUN_AWAITING_QUESTION_STAGE));
      }),
    );
    test(
      "an ask_user question holds the run awaiting, and the reader's answer is the tool result",
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const answering = yield* Effect.forkScoped(run.ask());
        const question = yield* run.asked();
        yield* until(() => Effect.map(run.stage(), (stage) => stage === THREAD_RUN_AWAITING_QUESTION_STAGE));
        yield* run.world.harness.runs
          .hosting()
          .answer(run.thread.id, question.questionId, [{ questionId: question.questionId, values: ['blue'] }]);
        const answer = yield* Fiber.join(answering);
        expect(answer.failed).toBe(false);
        expect(JSON.stringify(answer.output)).toContain('blue');
        expect((yield* run.questions())[0]?.status).toBe('answered');
        yield* until(() => Effect.map(run.stage(), (stage) => stage !== THREAD_RUN_AWAITING_QUESTION_STAGE));
      }),
    );
    test(
      'stopping the turn that waits on an ask_user clears the question and fails the call',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const answering = yield* Effect.forkScoped(Effect.result(run.ask()));
        yield* run.asked();
        expect(yield* run.world.harness.threads.handle(run.thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        expect((yield* Fiber.join(answering))._tag).toBe('Failure');
        yield* until(() => Effect.map(run.questions(), (questions) => questions[0]?.status === 'cleared'));
      }),
    );
  });
  describe(`${name}: an approval outside any call is a standing question of the thread`, () => {
    const approval = (
      threadId: string,
      key: string,
      over: {
        withinMs?: number | null;
        waitMs?: number;
      } = {},
    ) => ({
      threadId,
      key,
      operation: 'merge_worktree',
      summary: 'Merge the worktree?',
      asked: ['review'],
      withinMs: over.withinMs ?? null,
      waitMs: over.waitMs ?? 20,
    });
    test(
      'the door deadline leaves the question standing; its answer is spent by one repeat, and the next repeat asks again',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const questions = run.world.harness.runs.questions();
        const first = yield* questions.approve(approval(run.thread.id, 'key-1'));
        if (first.kind !== 'waiting') return yield* Effect.die(`Expected a standing question, got ${first.kind}.`);
        expect(yield* questions.holds(run.thread.id, first.questionId)).toBe(true);
        expect((yield* questions.open(run.thread.id)).map((entry) => entry.questionId)).toEqual([first.questionId]);
        expect((yield* run.world.harness.reads.snapshot(run.thread.id)).thread.pendingInteraction?.questionId).toBe(first.questionId);
        const changed = yield* questions.approve(approval(run.thread.id, 'key-2'));
        expect(changed.kind === 'waiting' && changed.questionId !== first.questionId).toBe(true);
        yield* questions.answer(run.thread.id, first.questionId, [{ questionId: first.questionId, values: [THREAD_TOOL_CONFIRM_VALUE] }]);
        expect((yield* questions.approve(approval(run.thread.id, 'key-1'))).kind).toBe('given');
        const again = yield* questions.approve(approval(run.thread.id, 'key-1'));
        expect(again.kind === 'waiting' && again.questionId !== first.questionId).toBe(true);
      }),
    );
    test(
      'two answers under one caller key at once both return the outcome of the one that answered',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const questions = run.world.harness.runs.questions();
        const first = yield* questions.approve(approval(run.thread.id, 'key-1'));
        if (first.kind !== 'waiting') return yield* Effect.die(`Expected a standing question, got ${first.kind}.`);
        const answers = [{ questionId: first.questionId, values: [THREAD_TOOL_CONFIRM_VALUE] }];
        const call = { actor: 'reader', key: 'once' };
        const both = yield* Effect.all(
          [
            questions.answer(run.thread.id, first.questionId, answers, call),
            questions.answer(run.thread.id, first.questionId, answers, call),
          ],
          { concurrency: 2 },
        );
        expect(both[0]).not.toBeNull();
        expect(both[1]).toEqual(both[0]);
        expect((yield* run.questions()).map((entry) => entry.status)).toEqual(['answered']);
      }),
    );
    test(
      'a declined answer is spent by one repeat as declined',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const questions = run.world.harness.runs.questions();
        const first = yield* questions.approve(approval(run.thread.id, 'key-1'));
        if (first.kind !== 'waiting') return yield* Effect.die(`Expected a standing question, got ${first.kind}.`);
        yield* questions.answer(run.thread.id, first.questionId, [{ questionId: first.questionId, values: [THREAD_TOOL_CANCEL_VALUE] }]);
        expect((yield* questions.approve(approval(run.thread.id, 'key-1'))).kind).toBe('declined');
      }),
    );
    test(
      'a question past its deadline is lapsed and leaves the thread asking nothing',
      Effect.fnUntraced(function* () {
        const run = yield* hostedTurn();
        const questions = run.world.harness.runs.questions();
        expect((yield* questions.approve(approval(run.thread.id, 'key-1', { withinMs: 30, waitMs: 2_000 }))).kind).toBe('lapsed');
        expect((yield* run.questions()).map((entry) => entry.status)).toEqual(['lapsed']);
        expect((yield* run.world.harness.reads.snapshot(run.thread.id)).thread.pendingInteraction).toBeNull();
      }),
    );
  });
  describe(`${name}: a question goes to its approver`, () => {
    const parent = 'parent-thread';
    const routed = (to: { approver: string | null }) => {
      const notices: ApprovalNotice[] = [];
      const route: {
        current: ApproverRoute;
      } = {
        current: { approver: to.approver, why: to.approver === null ? 'no-grant' : 'parent' },
      };
      const port: ApproversPort = {
        route: (_threadId, asked) =>
          Effect.succeed(asked.every((one) => one.action.length > 0) ? route.current : { approver: null, why: 'no-grant' }),
        grantOf: () => Effect.succeed([]),
        notify: (_approver, notice) =>
          Effect.sync(() => {
            notices.push(notice);
          }),
      };
      return { port, notices, route };
    };
    test(
      'a standalone approval names its approver and notifies it; only that approver decides, and its decision rides the answer',
      Effect.fnUntraced(function* () {
        const approvers = routed({ approver: parent });
        const run = yield* hostedTurn(undefined, undefined, approvers.port);
        const questions = run.world.harness.runs.questions();
        const approval = {
          threadId: run.thread.id,
          key: 'k',
          operation: 'merge_worktree',
          summary: 'Merge?',
          asked: ['review'],
          withinMs: null,
          waitMs: 20,
        };
        const asked = yield* questions.approve(approval);
        if (asked.kind !== 'waiting') return yield* Effect.die(`Expected a standing question, got ${asked.kind}.`);
        const [standing] = yield* questions.open(run.thread.id);
        expect(standing?.approver).toBe(parent);
        expect(approvers.notices).toMatchObject([
          { threadId: run.thread.id, questionId: asked.questionId, timeoutMs: null, deadlineAt: null },
        ]);
        const decide = (caller: string, note?: string) =>
          questions.decide({ threadId: run.thread.id, questionId: asked.questionId, caller, note });
        expect(yield* decide(run.thread.id)).toBe('not-the-approver');
        expect(yield* decide('brother')).toBe('not-the-approver');
        expect(yield* decide(parent, 'not today')).toBe('decided');
        yield* questions.answer(run.thread.id, asked.questionId, [{ questionId: asked.questionId, values: [THREAD_TOOL_CANCEL_VALUE] }]);
        expect(yield* questions.approve(approval)).toEqual({ kind: 'declined', by: parent, note: 'not today' });
      }),
    );
    test(
      'a hosted confirmation put to the parent executes once when the parent allows, and a rerouted question answers only to the operator',
      Effect.fnUntraced(function* () {
        const approvers = routed({ approver: parent });
        const run = yield* hostedTurn(undefined, undefined, approvers.port);
        const hosting = run.world.harness.runs.hosting();
        const questions = run.world.harness.runs.questions();
        const answering = yield* Effect.forkScoped(run.call());
        const question = yield* run.asked();
        expect(question.approver).toBe(parent);
        approvers.route.current = { approver: null, why: 'taken-over' };
        yield* questions.reroute(run.thread.id);
        expect((yield* run.questions())[0]?.approver).toBeUndefined();
        expect(yield* questions.decide({ threadId: run.thread.id, questionId: question.questionId, caller: parent })).toBe(
          'not-the-approver',
        );
        approvers.route.current = { approver: parent, why: 'parent' };
        yield* questions.reroute(run.thread.id);
        expect(yield* questions.decide({ threadId: run.thread.id, questionId: question.questionId, caller: parent })).toBe('decided');
        yield* hosting.answer(run.thread.id, question.questionId, [{ questionId: CALL, values: [THREAD_TOOL_CONFIRM_VALUE] }]);
        expect((yield* Fiber.join(answering)).failed).toBe(false);
        expect(run.acted).toEqual(['target']);
        expect((yield* run.questions())[0]?.decision).toEqual({ by: parent });
      }),
    );
    test(
      'an ask_user question goes to the approver, and a secret one to the operator',
      Effect.fnUntraced(function* () {
        const approvers = routed({ approver: parent });
        const run = yield* hostedTurn(undefined, undefined, approvers.port);
        yield* Effect.forkScoped(run.ask());
        const asked = yield* run.asked();
        expect(asked.approver).toBe(parent);
        expect(approvers.notices.at(-1)?.prompts).toMatchObject([{ id: asked.questions[0]!.id, prompt: 'Which colour?', multiple: false }]);
        const secret = yield* hostedTurn(undefined, undefined, approvers.port);
        const token = { questions: [{ prompt: 'Which token?', secret: true }] };
        yield* Effect.forkScoped(
          secret.world.harness.runs.hosting().call({
            threadId: secret.thread.id,
            agentId: secret.thread.agentId,
            toolCallId: 'ask-secret',
            name: USER_QUESTION_TOOL_NAME,
            input: token,
            arguments: JSON.stringify(token),
          }),
        );
        expect((yield* secret.asked()).approver).toBeUndefined();
      }),
    );
  });
}
