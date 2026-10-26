import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Exit } from 'effect';
import { ThreadCallBroke } from '../ThreadBorder';
import { until } from './runLog/support';
import type { ApprovalNotice, ApproversPort } from '../Approvers';
import { openMemoryStorage } from './memoryStorage';
import { OWNER, SCOPE, scriptedWorld, startedTurn, pump } from './runLog/world';
import { confirmingTurn, reportTurn, selectingCatalog } from './runLog/toolScripts';
it.live(
  'a native child retries its lost approval notice without waking the parent twice and executes only after the answer',
  Effect.fnUntraced(function* () {
    const storage = yield* openMemoryStorage();
    const parent = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
    const child = yield* storage.aggregate.transaction((tx) =>
      storage.aggregate.insertChild(parent.id, { ownerId: OWNER, agentId: parent.agentId }, tx),
    );
    const selector = { names: ['thread-a'] as readonly string[], read: [] as readonly string[] };
    const catalog = selectingCatalog(selector);
    Object.defineProperty(catalog['read_selection']!, 'approval', { value: { asksFrom: 'review', timeout: Duration.minutes(2) } });
    const notices: ApprovalNotice[] = [];
    let deliver: ApproversPort['notify'] = () => Effect.die('the parent delivery has not been bound');
    const approvers: ApproversPort = {
      route: () => Effect.succeed({ approver: parent.id, why: 'parent' }),
      grantOf: () => Effect.succeed(['read_selection']),
      notify: (approver, notice) =>
        Effect.exit(deliver(approver, notice)).pipe(
          Effect.flatMap((exit) => (Exit.isFailure(exit) ? Effect.logWarning('parent delivery failed', exit.cause) : Effect.void)),
        ),
    };
    const world = yield* scriptedWorld(storage, parent.agentId, { catalog, harness: { approvers } });
    let lost = true;
    deliver = Effect.fnUntraced(function* (approver, notice) {
      if (lost) {
        lost = false;
        return yield* new ThreadCallBroke({ cause: new Error('delivery is unavailable') });
      }
      yield* world.harness.inputs.deliver(approver, OWNER, {
        id: notice.id,
        senderThreadId: null,
        intent: 'approval',
        text: JSON.stringify(notice),
      });
      notices.push(notice);
    });
    const handle = world.harness.threads.handle(child.id, OWNER);
    yield* handle.setAuthorityMode('review');
    world.plan.push(confirmingTurn(catalog));
    const turn = yield* startedTurn(world, child.id, 'Read the lineage.');
    yield* pump(turn);
    const questions = world.harness.runs.questions();
    const [asked] = yield* questions.open(child.id);
    expect(asked).toMatchObject({ approver: parent.id, status: 'open' });
    if (asked === undefined) return yield* Effect.die('the child did not park its gated action');
    expect(notices).toEqual([]);
    world.plan.push(reportTurn());
    yield* questions.reroute(child.id);
    expect(notices).toMatchObject([{ threadId: child.id, questionId: asked.questionId, timeoutMs: 120_000 }]);
    expect(notices[0]?.deadlineAt).toBe(new Date(Date.parse(asked.occurredAt!) + 120_000).toISOString());
    yield* until(() => Effect.map(world.harness.reads.snapshot(parent.id), (snapshot) => snapshot.activeRun === null));
    const woken = (yield* world.harness.reads.snapshot(parent.id)).latestRun?.id;
    expect(woken).toBeDefined();
    yield* questions.reroute(child.id);
    expect((yield* world.harness.reads.snapshot(parent.id)).latestRun?.id).toBe(woken);
    expect(yield* storage.inbox.pending(parent.id)).toEqual([]);
    expect(selector.read).toEqual([]);
    expect(yield* questions.decide({ threadId: child.id, questionId: asked.questionId, caller: child.id })).toBe('not-the-approver');
    expect(yield* questions.decide({ threadId: child.id, questionId: asked.questionId, caller: parent.id })).toBe('decided');
    world.plan.push(reportTurn());
    yield* questions.answer(child.id, asked.questionId, [{ questionId: 'call-1', values: ['confirm'] }]);
    yield* pump(turn);
    expect(selector.read).toEqual(['thread-a']);
    expect(yield* questions.open(child.id)).toEqual([]);
    expect((yield* storage.aggregate.transcriptOf(child.id))?.filter((entry) => entry.type === 'tool')).toMatchObject([
      { toolCallId: 'call-1', toolState: 'output-available', toolOutput: { read: ['thread-a'] } },
    ]);
    selector.read = [];
    world.plan.push(confirmingTurn(catalog), reportTurn());
    const declined = yield* startedTurn(world, child.id, 'Read again.');
    yield* pump(declined);
    const [second] = yield* questions.open(child.id);
    if (second === undefined) return yield* Effect.die('the second call did not ask');
    yield* questions.decide({ threadId: child.id, questionId: second.questionId, caller: parent.id, note: 'not this target' });
    world.plan.push(reportTurn());
    yield* questions.answer(child.id, second.questionId, [{ questionId: 'call-1', values: ['cancel'] }]);
    yield* pump(declined);
    expect(selector.read).toEqual([]);
    expect((yield* storage.aggregate.transcriptOf(child.id))?.filter((entry) => entry.type === 'tool').at(-1)).toMatchObject({
      toolState: 'output-denied',
      toolOutput: { status: 'refused', code: 'declined', by: parent.id, note: 'not this target' },
    });
  }),
);
