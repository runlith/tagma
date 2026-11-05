import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Queue, Schema, Stream } from 'effect';
import { join } from 'node:path';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { ThreadLive } from '../../../threads/contract/service/engine.js';
import { ThreadFeeds } from '../../../threads/contract/service/feeds.js';
import type { WireState } from '../../../threads/contract/wire/snapshot.js';
import { turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, signal, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

const called = Schema.Struct({ failed: Schema.Boolean });

layer(protocolWorld({ name: 'host-flips', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
  excludeTestServices: true,
})('host settings over a running thread', (it) => {
  it.effect('a delegation or depth flip reaches every frame a followed thread publishes while its run is going', () =>
    Effect.gen(function* () {
      const { world, projectId, checkout, agent, birth } = yield* ProtocolWorld;
      const files = yield* FileSystem.FileSystem;
      const report = yield* agent('reader');
      const threadId = yield* birth();
      const path = join(checkout, 'flip-input.txt');
      yield* files.writeFileString(path, 'a flip reaches the open thread\n');
      const asThread = (id: string, input: object) => world.op(id, input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId) });
      yield* turnsOf(world.runtime.owners).send(threadId, projectId, 'HOLD the turn');
      yield* until(
        Effect.map(heard(report), (lines) => (lines.some((line) => line.method === 'session/prompt') ? true : null)),
        'the turn reached the agent',
        report,
      );
      yield* asThread('open_hosted_turn', {});
      yield* signal(`${report}.announce`, JSON.stringify({ toolCallId: 'flip-read', name: 'read', input: { path } }));
      yield* until(
        Effect.map(files.readFileString(`${report}.out`), (out) => (out.includes('said-flip-read') ? true : null)),
        'the read call was sealed',
        report,
      );
      const live = Context.get(world.runtime.owners, ThreadLive);
      const states = yield* Queue.unbounded<{ readonly seq: number; readonly state: WireState }>();
      yield* Effect.forkScoped(
        Stream.runForEach(Context.get(world.runtime.owners, ThreadFeeds)['thread.subscribe']({ projectId, threadId }), (event) =>
          event.type === 'snapshot' || event.type === 'state'
            ? Queue.offer(states, { seq: event.at.seq, state: event.payload.snapshot })
            : Effect.void,
        ),
      );
      const opened = (yield* Queue.take(states)).state;
      expect(opened.thread.delegation.allowed).toBe(true);
      const depth = opened.thread.spawnDepth.maximum > 1 ? opened.thread.spawnDepth.maximum - 1 : 2;
      const at = `project=${projectId}`;
      expect(yield* world.op('write_setting', { key: 'agent.delegation', value: false }, at)).toMatchObject({ status: 200 });
      expect(yield* world.op('write_setting', { project: projectId, key: 'agent.subAgentDepth', value: depth }, at)).toMatchObject({
        status: 200,
      });
      yield* Effect.sleep(500);
      const flipped = live.view(threadId).at.seq;
      const answer = yield* asThread('call_hosted_tool', { toolCallId: 'flip-read', name: 'read', input: { path } });
      expect((yield* Schema.decodeUnknownEffect(called)(answer.body)).failed).toBe(false);
      const cut = live.view(threadId).at.seq;
      expect(cut).toBeGreaterThan(flipped);
      const shown: WireState[] = [];
      for (let seq = 0; seq < cut;) {
        const next = yield* Queue.take(states);
        seq = next.seq;
        if (seq > flipped) shown.push(next.state);
      }
      expect(shown.length).toBeGreaterThan(0);
      for (const state of shown) {
        expect(state.thread.delegation.allowed).toBe(false);
        expect(state.thread.spawnDepth.maximum).toBe(depth);
      }
      yield* files.writeFileString(`${report}.release`, 'release');
    }),
  );
});
