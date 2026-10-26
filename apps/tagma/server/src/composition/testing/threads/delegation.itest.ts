import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema } from 'effect';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import type { AgentDirective } from '@runlith/agent/AgentRuntimePolicy';
import { Message } from '@runlith/llm/schema/messages';
import { delegationRule } from '../../../native-harness/testing/doubles.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { resolveDelegation } from '../../../threads/testing/doubles.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

const standing = Effect.gen(function* () {
  const { units, store, threads, projectId } = yield* threadStoreFixture;
  const enabled = { value: true };
  const settings = Context.get(
    yield* Layer.build(
      Layer.mock(Settings, {
        value: (key) => Schema.decodeUnknownEffect(key.schema)(enabled.value).pipe(Effect.orDie),
      }),
    ),
    Settings,
  );
  const [root, child, grandchild] = yield* units
    .write('delegation.standing', (unit) =>
      Effect.gen(function* () {
        const root = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.attachFacet({ threadId: root.id, projectId }, unit);
        const child = yield* store.insertChild(root.id, { ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.inheritFacet({ threadId: child.id, fromThreadId: root.id, agentId: 'tagma' }, unit);
        const grandchild = yield* store.insertChild(child.id, { ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.inheritFacet({ threadId: grandchild.id, fromThreadId: child.id, agentId: 'tagma' }, unit);
        return [root.id, child.id, grandchild.id] as const;
      }),
    )
    .pipe(Effect.orDie);
  const machine = (value: boolean) =>
    Effect.sync(() => {
      enabled.value = value;
    });
  const own = (id: string, value: boolean | null) => threads.mandate.setDelegation(id, value).pipe(Effect.orDie);
  const answer = (id: string) => resolveDelegation(threads.mandate, settings, id).pipe(Effect.orDie);
  return { threads, settings, root, child, grandchild, machine, own, answer };
});

it.live('a thread answers the nearest switch in its spawn lineage, and the machine switch where none stands', () =>
  Effect.gen(function* () {
    const { threads, root, child, grandchild, machine, own, answer } = yield* standing;
    const depth = (id: string) => Effect.map(threads.mandate.delegationLineage(id).pipe(Effect.orDie), (lineage) => lineage.depth);
    expect([yield* depth(root), yield* depth(child), yield* depth(grandchild)]).toEqual([0, 1, 2]);
    expect(yield* answer(grandchild)).toEqual({ own: null, allowed: true, setAt: null });
    yield* machine(false);
    expect(yield* answer(child)).toEqual({ own: null, allowed: false, setAt: null });
    yield* own(root, true);
    expect(yield* answer(root)).toEqual({ own: true, allowed: true, setAt: root });
    expect(yield* answer(grandchild)).toEqual({ own: null, allowed: true, setAt: root });
    yield* own(grandchild, false);
    expect(yield* answer(grandchild)).toEqual({ own: false, allowed: false, setAt: grandchild });
    expect(yield* answer(child)).toEqual({ own: null, allowed: true, setAt: root });
    yield* own(root, null);
    expect(yield* answer(child)).toEqual({ own: null, allowed: false, setAt: null });
  }),
);

it.live('a working agent hears a changed delegation once, and after compaction only when it is off', () =>
  Effect.gen(function* () {
    const { settings, threads, child, machine } = yield* standing;
    const rule = delegationRule(threads.mandate);
    const history: Message[] = [Message.user('Build it.')];
    const step = () =>
      rule({ hook: 'beforeStep', modelMessages: history, settings, thread: { id: child } } as unknown as Parameters<typeof rule>[0]);
    const told = (directive: AgentDirective | null): void => {
      if (directive?.type !== 'guide') throw new Error('Expected delegation guidance');
      history.push(agentRuntimeGuidanceMessage(directive.text, directive.state));
    };
    const compacted = () =>
      history.push(
        new Message({
          role: 'user',
          content: [{ type: 'text', text: 'Summary.' }],
          compaction: { id: 'reset', mode: 'manual', transcriptLocation: '/tmp/t', preservedCount: 0 },
        }),
      );
    expect(yield* step()).toBeNull();
    yield* machine(false);
    told(yield* step());
    expect(yield* step()).toBeNull();
    compacted();
    told(yield* step());
    yield* machine(true);
    told(yield* step());
    expect(yield* step()).toBeNull();
    compacted();
    expect(yield* step()).toBeNull();
  }),
);
