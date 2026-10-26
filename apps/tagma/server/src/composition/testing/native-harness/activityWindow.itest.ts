import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { activity } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import { MODEL_CALL } from '@runlith/activity/modelCall';
import { ActivityStore } from '@runlith/activity/store';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { asEvidenceAnswer } from '../../../threads/testing/doubles.js';

const THREADS = 2;
const TURNS = 1;
const TOOL = activityKind<{ readonly toolName: string }>('tool-call');

const request = (turn: number) =>
  new TextEncoder().encode(JSON.stringify({ model: 'opus', messages: [{ role: 'user', content: `turn ${turn}` }] }));

layer(doorFixture(), { excludeTestServices: true })('project activity window', (it) => {
  it.effect('model and tool calls are recorded and read back across live and archived threads', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const projectId = yield* world.knowledgeProject();
      const threads: string[] = [];
      for (let index = 0; index < THREADS; index += 1) {
        const created = yield* world.call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: {} });
        threads.push((created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id);
      }
      const store = yield* Effect.provide(ActivityStore, yield* Effect.promise(() => world.runtime.runtime.context()));
      const since = new Date((yield* Clock.currentTimeMillis) - 24 * 60 * 60 * 1000).toISOString();

      const turn = (thread: string, at: number) =>
        activity(
          MODEL_CALL,
          { provider: 'subscription', model: 'opus', rung: 'high' },
          activity(TOOL, { toolName: 'read' }, Effect.void, {
            bodies: [
              {
                kind: 'input',
                contentType: 'application/json',
                encoded: new TextEncoder().encode(JSON.stringify({ path: `file-${at}.ts` })),
              },
            ],
          }),
          {
            thread,
            bodies: [{ kind: 'request', encoded: request(at), contentType: 'application/json', series: true }],
            ended: () => ({
              result: { usage: { inputTokens: 1_000, outputTokens: 10 } },
              bodies: [
                { kind: 'response', contentType: 'application/json', encoded: new TextEncoder().encode(JSON.stringify({ text: 'ok' })) },
              ],
            }),
          },
        );

      for (let at = 0; at < TURNS; at += 1) {
        yield* Effect.forEach(threads, (thread) => turn(thread, at), { discard: true }).pipe(Effect.provideService(ActivityLog, store.log));
      }
      yield* store.settled;
      yield* world.call(`/api/op/archive_thread?project=${projectId}`, { method: 'POST', body: { threadId: threads[0], archived: true } });
      const answered = yield* world.call(`/api/op/read_thread?project=${projectId}`, {
        method: 'POST',
        body: {
          selection: { activeSince: since },
          select: 'activity',
          group: ['kind'],
          count: true,
          sum: ['usage.inputTokens'],
          order: { by: 'count', dir: 'desc' },
          limit: 1,
        },
      });
      const answer = (answered.body as { evidence: ReturnType<typeof asEvidenceAnswer> }).evidence;

      expect(answer.groups).toHaveLength(1);
      expect(answer.cursor).toEqual(expect.any(String));
      const continued = yield* world.call(`/api/op/read_thread?project=${projectId}`, {
        method: 'POST',
        body: { cursor: answer.cursor },
      });
      expect(continued.status).toBe(200);
      const rest = (continued.body as { evidence: ReturnType<typeof asEvidenceAnswer> }).evidence;
      expect(rest.cursor).toBeNull();
      expect([...(answer.groups ?? []), ...(rest.groups ?? [])]).toEqual([
        { by: { kind: 'model-call' }, count: THREADS * TURNS, sum: { 'usage.inputTokens': THREADS * TURNS * 1_000 } },
        { by: { kind: 'tool-call' }, count: THREADS * TURNS, unknown: { 'usage.inputTokens': THREADS * TURNS } },
      ]);
      expect(answer.coverage).toMatchObject({ complete: true, read: THREADS * TURNS * 2 });
      expect(answer.over).toBe(THREADS);
      for (const [selection, count, over] of [
        [{ activeSince: since, set: 'live' }, (THREADS - 1) * TURNS * 2, THREADS - 1],
        [{ activeSince: since, ids: [threads[0]] }, TURNS * 2, 1],
      ] as const) {
        const selected = yield* world.call(`/api/op/read_thread?project=${projectId}`, {
          method: 'POST',
          body: { selection, select: 'activity', count: true },
        });
        expect((selected.body as { evidence: ReturnType<typeof asEvidenceAnswer> }).evidence).toMatchObject({
          groups: [{ by: {}, count }],
          over,
        });
      }
    }),
  );
});
