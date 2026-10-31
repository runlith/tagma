import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { CostLedger } from '@runlith/performance/CostLedger';
import { ActivityStore } from '@runlith/activity/store';
import { Context, Effect, Fiber, FileSystem, Queue, Schema, Stream } from 'effect';
import { THREAD_TOOL_CONFIRM_VALUE, USER_QUESTION_TOOL_NAME } from '@runlith/agent/transcript/parts';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import type { CallEvent } from '@runlith/agent/callProgress';
import { join } from 'node:path';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { CallActivity } from '../../../native-harness/contract/service/calls.js';
import { ThreadHarness, ThreadLive } from '../../../threads/contract/service/engine.js';
import { ThreadFeeds } from '../../../threads/contract/service/feeds.js';
import type { ThreadsFeedEvent } from '../../../threads/contract/wire/list.js';
import type { ThreadWireFeedEvent } from '../../../threads/contract/wire/snapshot.js';
import { turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { suiteGit } from '../suiteGit.js';
import { heard, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

const called = Schema.Struct({ failed: Schema.Boolean });

layer(protocolWorld({ name: 'hosted-costs', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
  excludeTestServices: true,
})('hosted call costs', (it) => {
  it.effect('hosted calls retain attribution, replay their results and keep background ordering', () =>
    Effect.gen(function* () {
      const { world, projectId, checkout, agent, birth, forget } = yield* ProtocolWorld;
      const files = yield* FileSystem.FileSystem;
      const report = yield* agent('reader');
      const threadId = yield* birth();
      const path = join(checkout, 'cost-input.txt');
      yield* files.writeFileString(path, 'the hosted read reaches this file\n');
      const asThread = (id: string, input: object) => world.op(id, input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId) });
      yield* turnsOf(world.runtime.owners).send(threadId, projectId, 'HOLD the turn');
      yield* until(
        Effect.map(heard(report), (lines) => (lines.some((line) => line.method === 'session/prompt') ? true : null)),
        'the turn reached the agent',
        report,
      );
      yield* asThread('open_hosted_turn', {});
      yield* files.writeFileString(`${report}.announce`, JSON.stringify({ toolCallId: 'cost-read', name: 'read', input: { path } }));
      yield* until(
        Effect.map(files.readFileString(`${report}.out`), (out) => (out.includes('said-cost-read') ? true : null)),
        'the read call was sealed',
        report,
      );

      const feeds = Context.get(world.runtime.owners, ThreadFeeds);
      const live = Context.get(world.runtime.owners, ThreadLive);
      const lists = yield* Queue.unbounded<ThreadsFeedEvent>();
      const threads = yield* Queue.unbounded<ThreadWireFeedEvent>();
      yield* Effect.forkScoped(Stream.runForEach(feeds['threads.subscribe']({ projectId }), (frame) => Queue.offer(lists, frame)));
      yield* Effect.forkScoped(
        Stream.runForEach(feeds['thread.subscribe']({ projectId, threadId }), (frame) => Queue.offer(threads, frame)),
      );
      yield* Queue.take(lists);
      yield* Queue.take(threads);

      const ledger = Context.get(world.runtime.owners, CostLedger);
      const served = yield* world.runtime.pool.resolve({ projectId });
      const beforeRefresh = ledger.read({ limit: 4096 });
      yield* served.settled(true);
      const afterRefresh = ledger.read({ limit: 4096 });
      const refresh = afterRefresh.rows.findLast((row) => row.name === 'FreshnessGate.refresh');
      expect(refresh?.sequence).toBeGreaterThan(beforeRefresh.rows.at(-1)?.sequence ?? 0);
      expect(refresh!.total.statements).toBeGreaterThan(0);
      expect(afterRefresh.unattributedStatements).toBe(beforeRefresh.unattributedStatements);
      const activity = Context.get(world.runtime.owners, ActivityStore);
      yield* Effect.provide(activity.log.settled, world.runtime.owners);
      const before = ledger.read({ limit: 4096 });
      const answer = yield* asThread('call_hosted_tool', { toolCallId: 'cost-read', name: 'read', input: { path } });
      expect((yield* Schema.decodeUnknownEffect(called)(answer.body)).failed).toBe(false);
      const cut = live.view(threadId).at.seq;
      let delivered = 0;
      while (delivered < cut) delivered = (yield* Queue.take(threads)).at.seq;
      yield* Queue.take(lists);
      yield* Effect.provide(activity.log.settled, world.runtime.owners);
      const after = ledger.read({ limit: 4096 });
      const root = after.rows.findLast((row) => row.name === 'call_hosted_tool');
      console.info('hosted read cost', JSON.stringify({ root }));
      expect(root).toBeDefined();
      expect(root!.own.statements).toBeGreaterThan(0);
      expect(root!.own.programs).toBeGreaterThan(0);
      expect(root!.own.writerHoldMs).toBeGreaterThan(0);
      expect(root!.producers.find((row) => row.name === 'ThreadSnapshots.publish')?.counts.statements).toBeGreaterThan(0);
      expect(root!.producers.find((row) => row.name === 'ThreadList.project')?.counts.statements).toBeGreaterThan(0);
      expect(root!.producers.find((row) => row.name === 'ThreadFeeds.project')).toBeDefined();
      expect(root!.own.statements + root!.producers.reduce((sum, row) => sum + row.counts.statements, 0)).toBe(root!.total.statements);
      expect(after.evicted).toBe(before.evicted);
      expect(before.unattributedStatements).not.toBeNull();
      expect(after.unattributedStatements).toBe(before.unattributedStatements);
      const first = answer.body as { readonly content: unknown };
      expect(JSON.stringify(first.content)).toContain('the hosted read reaches this file');
      yield* files.writeFileString(path, 'the file changed after the original call\n');
      const repeated = yield* asThread('call_hosted_tool', { toolCallId: 'cost-read', name: 'read', input: { path } });
      expect(repeated.status).toBe(200);
      expect(repeated.body).toMatchObject({ status: 'called', failed: false, content: first.content });
      const announce = Effect.fnUntraced(function* (toolCallId: string, name: string, input: object) {
        const staged = `${report}.staged`;
        yield* files.writeFileString(staged, JSON.stringify({ toolCallId, name, input }));
        yield* files.rename(staged, `${report}.announce`);
      });
      const reveal = { query: `select:${USER_QUESTION_TOOL_NAME}` };
      yield* announce('reveal-question', 'tool_search', reveal);
      expect(
        (yield* asThread('call_hosted_tool', { toolCallId: 'reveal-question', name: 'tool_search', input: reveal })).body,
      ).toMatchObject({
        status: 'called',
        failed: false,
      });
      const input = { questions: [{ prompt: 'Choose a colour', options: [{ value: 'blue', label: 'Blue' }] }] };
      yield* announce('question', USER_QUESTION_TOOL_NAME, input);
      const asking = yield* Effect.forkScoped(
        asThread('call_hosted_tool', { toolCallId: 'question', name: USER_QUESTION_TOOL_NAME, input }),
      );
      const kernel = Context.get(world.runtime.owners, ThreadHarness);
      const questions = kernel.runs.questions();
      let open = yield* questions.open(threadId);
      while (open.length === 0) {
        yield* Queue.take(threads);
        open = yield* questions.open(threadId);
      }
      const retrying = yield* Effect.forkScoped(
        asThread('call_hosted_tool', { toolCallId: 'question', name: USER_QUESTION_TOOL_NAME, input }),
        { startImmediately: true },
      );
      yield* Fiber.interrupt(asking);
      yield* questions.answer(threadId, open[0]!.questionId, [{ questionId: 'question', values: ['blue'] }]);
      const answered = yield* Fiber.join(retrying);
      expect(answered.body).toMatchObject({ status: 'called', failed: false });
      const repeatedQuestion = yield* asThread('call_hosted_tool', { toolCallId: 'question', name: USER_QUESTION_TOOL_NAME, input });
      expect(repeatedQuestion.body).toMatchObject({
        status: 'called',
        failed: false,
        content: (answered.body as { content: unknown }).content,
      });
      expect(yield* questions.open(threadId)).toEqual([]);
      const snapshot = yield* kernel.reads.snapshot(threadId);
      expect(
        snapshot.transcript.filter((entry) => coreEntry(entry) && entry.type === 'question' && entry.questionId === 'question'),
      ).toHaveLength(1);
      yield* files.writeFileString(`${report}.release`, 'release');
      yield* Effect.andThen(kernel.threads.handle(threadId, 'operator').stop(), kernel.threads.handle(threadId, 'operator').release());
      forget(threadId);
      yield* Effect.provide(activity.log.settled, world.runtime.owners);
      {
        const { world, projectId, checkout, agent, birth, forget } = yield* ProtocolWorld;
        const files = yield* FileSystem.FileSystem;
        const report = yield* agent('ordered');
        const threadId = yield* birth();
        const path = join(checkout, 'ordered.txt');
        yield* files.writeFileString(path, 'before\n');
        yield* suiteGit(checkout, 'add', 'ordered.txt');
        yield* suiteGit(checkout, 'commit', '-qm', 'hosted fixture');
        const asThread = (input: object) =>
          world.op('call_hosted_tool', input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId) });
        const harness = Context.get(world.runtime.owners, ThreadHarness);
        const feeds = Context.get(world.runtime.owners, ThreadFeeds);
        const frames = yield* Queue.unbounded<ThreadWireFeedEvent>();
        const callEvents = yield* Queue.unbounded<CallEvent>();
        yield* Effect.forkScoped(
          Stream.runForEach(feeds['thread.subscribe']({ projectId, threadId }), (frame) => Queue.offer(frames, frame)),
        );
        yield* Effect.forkScoped(
          Stream.runForEach(Context.get(world.runtime.owners, CallActivity).feed({ projectId, threadId }, 50), (event) =>
            Queue.offer(callEvents, event),
          ),
        );
        yield* Queue.take(frames);
        yield* turnsOf(world.runtime.owners).send(threadId, projectId, 'HOLD the turn');
        yield* until(
          Effect.map(heard(report), (lines) => (lines.some((line) => line.method === 'session/prompt') ? true : null)),
          'the turn reached the agent',
          report,
        );
        yield* world.op('open_hosted_turn', {}, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId) });
        const earlier = { toolCallId: 'ordered-write', name: 'write', input: { path, content: 'after\n', background: true } };
        const later = { toolCallId: 'ordered-read', name: 'read', input: { path } };
        const staged = `${report}.staged`;
        yield* files.writeFileString(staged, JSON.stringify([earlier, later]));
        yield* files.rename(staged, `${report}.announce`);
        const reading = yield* Effect.forkScoped(asThread(later));
        let queued = false;
        while (!queued) {
          const snapshot = yield* harness.reads.snapshot(threadId);
          queued = snapshot.transcript.some(
            (entry) =>
              coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === later.toolCallId && entry.execution?.state === 'queued',
          );
          if (!queued) yield* Queue.take(frames);
        }
        expect((yield* asThread(earlier)).body).toMatchObject({ status: 'called', failed: false });
        const questions = harness.runs.questions();
        let open = yield* questions.open(threadId);
        while (open.length === 0) {
          yield* Queue.take(frames);
          open = yield* questions.open(threadId);
        }
        yield* turnsOf(world.runtime.owners).send(threadId, projectId, 'A later word.');
        yield* questions.answer(threadId, open[0]!.questionId, [{ questionId: earlier.toolCallId, values: [THREAD_TOOL_CONFIRM_VALUE] }]);
        const read = yield* Fiber.join(reading);
        expect(read.body).toMatchObject({ status: 'called', failed: false });
        expect(JSON.stringify(read.body)).toContain('after');
        expect(yield* files.readFileString(path)).toBe('after\n');
        let finished = false;
        while (!finished) {
          const event = yield* Queue.take(callEvents);
          const calls = event.type === 'snapshot' ? event.calls : [event.call];
          finished = calls.some((call) => call.toolCallId === earlier.toolCallId && call.endedAt !== null);
        }
        yield* files.writeFileString(`${report}.release`, 'release');
        yield* Effect.andThen(harness.threads.handle(threadId, 'operator').stop(), harness.threads.handle(threadId, 'operator').release());
        forget(threadId);
      }
    }),
  );
});
