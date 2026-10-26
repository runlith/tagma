import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, type Scope } from 'effect';
import type { ApproversPort } from '../Approvers';
import type { ApprovalChoice } from '../run/ApprovalAnswers';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import type { ReportPlan } from '../run/lifecycle/RunReports';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '../storage/runs';
import { bordered, ThreadCallBroke, threadCauseOf } from '../ThreadBorder';
import type { ThreadWriteTx } from '../ThreadPorts';
import type { AskDelivery, Transport, TransportAsks } from '../transport/contract';
import { openedRun, OWNER, SCOPE, scriptedWorld, type ScriptedWorld } from './runLog/world';
import { until } from './runLog/support';
import type { ThreadStorageFactory } from './storagePort';
const ADAPTER = 'acp';
const RUN = 'turn-1';
const ALLOW = 'allow-once';
type Delivery = {
  readonly threadId: string;
  readonly questionId: string;
  readonly values: readonly string[];
};
const askOf = (id: string): ThreadQuestionEntry => ({
  type: 'question',
  id: `entry-${id}`,
  runId: RUN,
  questionId: `harness-protocol:${id}`,
  questions: [
    {
      id: `harness-protocol:${id}`,
      kind: 'choice',
      prompt: 'Devin asks to run `git push`',
      options: [
        { value: ALLOW, label: 'Allow once' },
        { value: 'deny', label: 'Deny' },
      ],
      toolCallId: `call-${id}`,
    },
  ],
  toolCalls: [{ toolCallId: `call-${id}`, toolName: 'bash' }],
  status: 'open',
});
const transportOver = (asks: TransportAsks): Transport => ({
  adapter: ADAPTER,
  declares: { history: 'none', compaction: 'none' },
  words: 'opening',
  runs: {
    launch: () => Effect.void,
    deliver: () => Effect.void,
    withdraw: () => Effect.succeed('unsent'),
    queued: () => Effect.void,
    holds: () => [],
    interrupt: () => Effect.succeed('no-turn'),
    adopt: () => Effect.succeed('declined'),
    reached: () => Effect.void,
  },
  asks,
});
export function describeVendorQuestions<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  const vendorRun = Effect.fnUntraced(function* (approvers?: ApproversPort) {
    const stack = yield* openedRun(open, { harness: { ownerId: OWNER, approvers } });
    const { storage, thread } = stack;
    yield* storage.aggregate.update(thread.id, { transport: { adapter: ADAPTER, profile: 'devin', agent: null } });
    const delivered: Delivery[] = [];
    const behaviour: {
      broken: boolean;
      outcome: AskDelivery;
      during: (() => Effect.Effect<unknown, unknown>) | null;
    } = {
      broken: false,
      outcome: 'delivered',
      during: null,
    };
    const asks: TransportAsks = {
      answer: Effect.fnUntraced(function* (threadId, question, answers) {
        if (behaviour.broken) return yield* new ThreadCallBroke({ cause: new Error('the vendor process is gone') });
        delivered.push({ threadId, questionId: question.questionId, values: answers.flatMap((answer) => answer.values) });
        if (behaviour.during) yield* bordered(behaviour.during());
        return behaviour.outcome;
      }),
    };
    const bound = Effect.fnUntraced(function* (world: ScriptedWorld) {
      yield* world.harness.runs.transports().register(transportOver(asks));
      return world;
    });
    let world = yield* bound(stack.world);
    yield* storage.runs({ ownerId: OWNER, scope: SCOPE }).createRun({
      startFrom: {
        id: thread.id,
        ownerId: thread.ownerId,
        account: thread.account,
        provider: ADAPTER,
        model: null,
        reasoning: null,
        switches: {},
      },
      kind: 'turn',
      approval: { mode: 'trust', interactive: false },
      progress: { stage: null, message: null },
      runId: RUN,
    });
    const run = { id: RUN, threadId: thread.id };
    const apply = (plan: ReportPlan) => storage.aggregate.transaction((unit) => plan.run(unit as unknown as ThreadWriteTx));
    const reports = () => world.harness.runs.reports().of(ADAPTER);
    const questions = () =>
      Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) =>
        (entries ?? []).filter((entry): entry is ThreadQuestionEntry & typeof entry => entry.type === 'question'),
      );
    const standing = () =>
      Effect.map(world.harness.reads.snapshot(thread.id), (snapshot) => ({
        stage: snapshot.activeRun?.progress.stage ?? null,
        open: snapshot.status.openQuestions,
      }));
    const slot = () => Effect.map(storage.aggregate.find(thread.id), (row) => row?.pendingInteraction?.questionId ?? null);
    const runStatus = () => Effect.map(storage.runs({ ownerId: OWNER, scope: SCOPE }).runById(RUN), (row) => row?.status ?? null);
    const answer = (
      questionId: string,
      values: readonly string[] = [ALLOW],
      call?: {
        readonly actor: string;
        readonly key: string;
      },
    ) => world.harness.runs.questions().answer(thread.id, questionId, [{ questionId, values }], call);
    return {
      thread,
      run,
      storage,
      collaboration: () => world.harness.collaboration,
      delivered,
      behaviour,
      apply,
      reports,
      questions,
      standing,
      slot,
      runStatus,
      answer,
      rebuilt: Effect.fnUntraced(function* () {
        world = yield* bound(yield* scriptedWorld(storage, thread.agentId));
      }),
    };
  });
  describe(`${name}: a vendor's questions are records of the core`, () => {
    test(
      'a parent answers a vendor choice by value through collaboration, while an unoffered value or boolean cannot decide it',
      Effect.fnUntraced(function* () {
        let parent: string | null = null;
        const approvers: ApproversPort = {
          route: () => Effect.succeed({ approver: parent, why: 'parent' }),
          notify: () => Effect.void,
          grantOf: () => Effect.succeed([]),
        };
        const stack = yield* vendorRun(approvers);
        parent = (yield* stack.storage.createThread({ ownerId: OWNER, scope: SCOPE })).id;
        const question = { ...askOf('parent-choice'), approver: parent };
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:parent-choice'));
        expect((yield* stack.questions())[0]?.approver).toBe(parent);
        const answer = (caller: string, choice: ApprovalChoice) =>
          stack
            .collaboration()
            .collaborate(caller, OWNER, (verbs) =>
              verbs.approvals.answer({ threadId: stack.thread.id, questionId: question.questionId, choice }),
            );
        expect((yield* answer(stack.thread.id, { values: [ALLOW] })).status).toBe('not-the-approver');
        expect((yield* answer(parent, { values: ['allow-always'] })).status).toBe('unoffered');
        expect((yield* answer(parent, { allow: true })).status).toBe('unoffered');
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.answers])).toEqual([['open', undefined]]);
        expect((yield* answer(parent, { values: [ALLOW] })).status).toBe('answered');
        expect((yield* stack.questions())[0]).toMatchObject({
          status: 'answered',
          answers: [{ values: [ALLOW] }],
          decision: { by: parent },
        });
      }),
    );
    test(
      'two questions asked at once are two records, each answered by its own id, and the run waits until the last is answered',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const [first, second] = [askOf('a1'), askOf('a2')];
        expect((yield* stack.apply(stack.reports().asked(stack.run, first, 'ask:a1'))).status).toBe('applied');
        expect((yield* stack.apply(stack.reports().asked(stack.run, second, 'ask:a2'))).status).toBe('applied');
        expect((yield* stack.questions()).map((entry) => [entry.questionId, entry.status, entry.route])).toEqual([
          [first.questionId, 'open', ADAPTER],
          [second.questionId, 'open', ADAPTER],
        ]);
        expect(yield* stack.standing()).toEqual({ stage: THREAD_RUN_AWAITING_QUESTION_STAGE, open: [first.questionId, second.questionId] });
        expect(yield* stack.slot()).toBe(first.questionId);
        expect(yield* stack.answer(second.questionId)).toEqual({ runId: stack.run.id });
        expect(stack.delivered).toEqual([{ threadId: stack.thread.id, questionId: second.questionId, values: [ALLOW] }]);
        expect(yield* stack.standing()).toEqual({ stage: THREAD_RUN_AWAITING_QUESTION_STAGE, open: [first.questionId] });
        expect(yield* stack.slot()).toBe(first.questionId);
        yield* stack.answer(first.questionId, ['deny']);
        expect(yield* stack.slot()).toBeNull();
        expect(stack.delivered.map((each) => [each.questionId, each.values])).toEqual([
          [second.questionId, [ALLOW]],
          [first.questionId, ['deny']],
        ]);
        expect((yield* stack.standing()).stage).not.toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
        expect((yield* stack.questions()).map((entry) => [entry.questionId, entry.status])).toEqual([
          [first.questionId, 'answered'],
          [second.questionId, 'answered'],
        ]);
        expect(yield* stack.answer(first.questionId)).toBeNull();
      }),
    );
    test(
      'a vendor that withdraws its questions closes them where they stand: repeated is a replay, and the run goes on after the last',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const [first, second] = [askOf('b1'), askOf('b2')];
        yield* stack.apply(stack.reports().asked(stack.run, first, 'ask:b1'));
        yield* stack.apply(stack.reports().asked(stack.run, second, 'ask:b2'));
        expect((yield* stack.apply(stack.reports().asked(stack.run, first, 'ask:b1'))).status).toBe('replayed');
        expect((yield* stack.apply(stack.reports().resolved(stack.run, first.questionId, 'resolved:b1'))).status).toBe('applied');
        expect((yield* stack.apply(stack.reports().resolved(stack.run, first.questionId, 'resolved:b1'))).status).toBe('replayed');
        expect((yield* stack.standing()).stage).toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
        expect(yield* stack.slot()).toBe(second.questionId);
        yield* stack.apply(stack.reports().resolved(stack.run, second.questionId, 'resolved:b2'));
        expect(yield* stack.slot()).toBeNull();
        expect((yield* stack.questions()).map((entry) => entry.status)).toEqual(['cleared', 'cleared']);
        expect(yield* stack.standing()).toEqual({ stage: 'running', open: [] });
        expect(yield* stack.answer(first.questionId)).toBeNull();
        expect(stack.delivered).toEqual([]);
      }),
    );
    test(
      'an answer the vendor never received stays recorded with its question open; the end of the run closes both',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('c1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:c1'));
        stack.behaviour.broken = true;
        expect(threadCauseOf(yield* Effect.flip(stack.answer(question.questionId)))).toMatchObject({
          message: 'the vendor process is gone',
        });
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.answers?.[0]?.values])).toEqual([['open', [ALLOW]]]);
        expect((yield* stack.standing()).open).toEqual([question.questionId]);
        yield* stack.apply(stack.reports().ended(stack.run, { kind: 'aborted', stoppedBy: 'reader' }));
        yield* until(() => Effect.map(stack.questions(), (entries) => entries.every((entry) => entry.status === 'cleared')));
        expect((yield* stack.questions()).map((entry) => entry.answers)).toEqual([undefined]);
      }),
    );
    test(
      'an answer the question does not offer is refused and recorded nowhere',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('d1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:d1'));
        expect(threadCauseOf(yield* Effect.flip(stack.answer(question.questionId, ['allow-always'])))).toMatchObject({
          _tag: 'ThreadAnswerInvalid',
        });
        expect(stack.delivered).toEqual([]);
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.answers])).toEqual([['open', undefined]]);
      }),
    );
    test(
      'a world built again over the same storage answers a standing question by its id',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('e1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:e1'));
        yield* stack.rebuilt();
        expect((yield* stack.standing()).open).toEqual([question.questionId]);
        expect(yield* stack.answer(question.questionId)).toEqual({ runId: stack.run.id });
        expect(stack.delivered).toEqual([{ threadId: stack.thread.id, questionId: question.questionId, values: [ALLOW] }]);
        expect((yield* stack.questions()).map((entry) => entry.status)).toEqual(['answered']);
      }),
    );
    test(
      'a vendor that ends its turn while a question stands completes the run, and the question closes with it',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('f1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:f1'));
        expect((yield* stack.apply(stack.reports().ended(stack.run, { kind: 'completed' }))).status).toBe('applied');
        expect(yield* stack.runStatus()).toBe('completed');
        yield* until(() => Effect.map(stack.questions(), (entries) => entries.every((entry) => entry.status === 'cleared')));
        expect(yield* stack.slot()).toBeNull();
      }),
    );
    test(
      'a vendor run that fails while a question stands closes the question with the failure as its reason',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('f2');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:f2'));
        yield* stack.apply(stack.reports().ended(stack.run, { kind: 'failed', reason: 'the process died' }));
        expect(yield* stack.runStatus()).toBe('failed');
        yield* until(() => Effect.map(stack.questions(), (entries) => entries.every((entry) => entry.status === 'cleared')));
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.decision?.note])).toEqual([
          ['cleared', expect.stringContaining('the process died')],
        ]);
        expect(yield* stack.slot()).toBeNull();
      }),
    );
    test(
      'an answer the vendor did not write leaves the question open and answerable; one the vendor settled meanwhile is never overwritten',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const [unwritten, settled] = [askOf('g1'), askOf('g2')];
        yield* stack.apply(stack.reports().asked(stack.run, unwritten, 'ask:g1'));
        yield* stack.apply(stack.reports().asked(stack.run, settled, 'ask:g2'));
        stack.behaviour.outcome = 'unwritten';
        yield* stack.answer(unwritten.questionId);
        expect((yield* stack.questions()).map((entry) => [entry.questionId, entry.status, entry.answers])).toEqual([
          [unwritten.questionId, 'open', undefined],
          [settled.questionId, 'open', undefined],
        ]);
        expect((yield* stack.standing()).stage).toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
        stack.behaviour.outcome = 'delivered';
        stack.behaviour.during = () => stack.apply(stack.reports().resolved(stack.run, settled.questionId, 'resolved:g2'));
        yield* stack.answer(settled.questionId);
        stack.behaviour.during = null;
        expect((yield* stack.questions()).map((entry) => [entry.questionId, entry.status])).toEqual([
          [unwritten.questionId, 'open'],
          [settled.questionId, 'cleared'],
        ]);
        expect((yield* stack.standing()).stage).toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
        stack.behaviour.outcome = 'delivered';
        expect(yield* stack.answer(unwritten.questionId)).toEqual({ runId: stack.run.id });
        expect((yield* stack.standing()).stage).not.toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
      }),
    );
    test(
      'a delivery the vendor confirms closes the question as answered with the answer kept',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('h1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:h1'));
        stack.behaviour.outcome = 'gone';
        yield* stack.answer(question.questionId);
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.answers?.[0]?.values])).toEqual([['open', [ALLOW]]]);
        yield* stack.apply(stack.reports().resolved(stack.run, question.questionId, 'delivered:h1', 'answered'));
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.answers?.[0]?.values])).toEqual([['answered', [ALLOW]]]);
        expect((yield* stack.standing()).stage).not.toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
      }),
    );
    test(
      'a delivery of unknown fate keeps the answer, marks the question, and is never sent again',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('u1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:u1'));
        stack.behaviour.outcome = 'unknown';
        yield* stack.answer(question.questionId);
        expect(yield* stack.answer(question.questionId)).toEqual({ runId: stack.run.id });
        expect(threadCauseOf(yield* Effect.flip(stack.answer(question.questionId, ['deny'])))).toMatchObject({
          _tag: 'ThreadInteractionConflict',
        });
        expect(stack.delivered).toHaveLength(1);
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.deliveryUnknown, entry.answers?.[0]?.values])).toEqual([
          ['open', true, [ALLOW]],
        ]);
        expect((yield* stack.standing()).stage).toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
      }),
    );
    test(
      'while an answer is on its way to the vendor, the same answer joins it and another one is refused unsent',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('w1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:w1'));
        const sent = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        stack.behaviour.during = () => Effect.andThen(Deferred.succeed(sent, undefined), Deferred.await(release));
        const first = yield* Effect.forkScoped(stack.answer(question.questionId));
        yield* Deferred.await(sent);
        expect(yield* stack.answer(question.questionId)).toEqual({ runId: stack.run.id });
        expect(threadCauseOf(yield* Effect.flip(stack.answer(question.questionId, ['deny'])))).toMatchObject({
          _tag: 'ThreadInteractionConflict',
        });
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(first)).toEqual({ runId: stack.run.id });
        expect(stack.delivered).toHaveLength(1);
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.answers?.[0]?.values])).toEqual([['answered', [ALLOW]]]);
      }),
    );
    test(
      'the intent to send is recorded before the vendor is asked, so a delivery cut off mid-way is never sent again',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('c1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:c1'));
        let during: unknown = null;
        stack.behaviour.during = Effect.fnUntraced(function* () {
          during = (yield* stack.questions()).map((entry) => [entry.status, entry.deliveryUnknown, entry.answers?.[0]?.values]);
          return yield* new ThreadCallBroke({ cause: new Error('the server stopped after the vendor took the answer') });
        });
        expect(threadCauseOf(yield* Effect.flip(stack.answer(question.questionId)))).toMatchObject({
          message: 'the server stopped after the vendor took the answer',
        });
        stack.behaviour.during = null;
        expect(during).toEqual([['open', true, [ALLOW]]]);
        yield* stack.answer(question.questionId);
        expect(stack.delivered).toHaveLength(1);
        expect((yield* stack.questions()).map((entry) => [entry.status, entry.deliveryUnknown])).toEqual([['open', true]]);
      }),
    );
    test(
      'the same caller key answers once and returns its first outcome, and another payload under it conflicts',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const question = askOf('k1');
        yield* stack.apply(stack.reports().asked(stack.run, question, 'ask:k1'));
        const call = { actor: 'reader', key: 'once' };
        const first = yield* stack.answer(question.questionId, [ALLOW], call);
        expect(yield* stack.answer(question.questionId, [ALLOW], call)).toEqual(first);
        expect(stack.delivered).toHaveLength(1);
        expect(threadCauseOf(yield* Effect.flip(stack.answer(question.questionId, ['deny'], call)))).toMatchObject({
          _tag: 'ThreadActReused',
        });
        expect(stack.delivered).toHaveLength(1);
      }),
    );
    test(
      'a question asked while another one is being answered keeps the run waiting',
      Effect.fnUntraced(function* () {
        const stack = yield* vendorRun();
        const [first, second] = [askOf('i1'), askOf('i2')];
        yield* stack.apply(stack.reports().asked(stack.run, first, 'ask:i1'));
        stack.behaviour.during = () => stack.apply(stack.reports().asked(stack.run, second, 'ask:i2'));
        yield* stack.answer(first.questionId);
        stack.behaviour.during = null;
        expect(yield* stack.standing()).toEqual({ stage: THREAD_RUN_AWAITING_QUESTION_STAGE, open: [second.questionId] });
        expect(yield* stack.slot()).toBe(second.questionId);
      }),
    );
  });
}
