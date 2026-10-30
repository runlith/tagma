import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { CostLedger } from '@runlith/performance/CostLedger';
import { ActivityStore } from '@runlith/activity/store';
import { Context, Effect, FileSystem, Metric, Queue, Schema, Stream } from 'effect';
import { join } from 'node:path';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { ThreadLive } from '../../../threads/contract/service/engine.js';
import { ThreadFeeds } from '../../../threads/contract/service/feeds.js';
import type { ThreadsFeedEvent } from '../../../threads/contract/wire/list.js';
import type { ThreadWireFeedEvent } from '../../../threads/contract/wire/snapshot.js';
import { turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

const called = Schema.Struct({ failed: Schema.Boolean });

layer(protocolWorld({ name: 'hosted-costs', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
  excludeTestServices: true,
})('hosted call costs', (it) => {
  it.effect('a hosted read attributes its own and reactive statements independently of retained traces', () =>
    Effect.gen(function* () {
      const { world, projectId, checkout, agent, birth } = yield* ProtocolWorld;
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
      const sqlCount = Effect.map(Effect.provide(Metric.snapshot, world.runtime.owners), (snapshots) =>
        snapshots.reduce(
          (total, row) =>
            row.type === 'Histogram' && row.id === 'sql.execute' && row.attributes?.source === 'span' ? total + row.state.count : total,
          0,
        ),
      );
      const activity = Context.get(world.runtime.owners, ActivityStore);
      yield* Effect.provide(activity.log.settled, world.runtime.owners);
      const before = ledger.read({ limit: 4096 });
      const sqlBefore = yield* sqlCount;
      const answer = yield* asThread('call_hosted_tool', { toolCallId: 'cost-read', name: 'read', input: { path } });
      expect((yield* Schema.decodeUnknownEffect(called)(answer.body)).failed).toBe(false);
      const cut = live.view(threadId).at.seq;
      let delivered = 0;
      while (delivered < cut) delivered = (yield* Queue.take(threads)).at.seq;
      yield* Queue.take(lists);
      yield* Effect.provide(activity.log.settled, world.runtime.owners);
      const sqlAfter = yield* sqlCount;
      const after = ledger.read({ limit: 4096 });
      const root = after.rows.findLast((row) => row.name === 'call_hosted_tool');
      console.info('hosted read cost', JSON.stringify({ root, sqlStatements: sqlAfter - sqlBefore }));
      expect(root).toBeDefined();
      expect(root!.own.statements).toBeGreaterThan(0);
      expect(root!.own.units).toBeGreaterThan(0);
      expect(root!.own.writerHoldMs).toBeGreaterThan(0);
      expect(root!.producers.find((row) => row.name === 'ThreadSnapshots.publish')?.counts.statements).toBeGreaterThan(0);
      expect(root!.producers.find((row) => row.name === 'ThreadList.project')?.counts.statements).toBeGreaterThan(0);
      expect(root!.producers.find((row) => row.name === 'ThreadFeeds.project')).toBeDefined();
      expect(root!.own.statements + root!.producers.reduce((sum, row) => sum + row.counts.statements, 0)).toBe(root!.total.statements);
      expect(after.evicted).toBe(before.evicted);
      expect(root!.total.statements).toBe(sqlAfter - sqlBefore);
      yield* files.writeFileString(`${report}.release`, 'release');
    }),
  );
});
