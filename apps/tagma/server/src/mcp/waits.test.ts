import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, PubSub, Queue, Stream } from 'effect';
import { Notifications } from '../notify/contract/service/notifications.js';
import { Senders } from '../notify/contract/service/senders.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { Projects } from '../projects/contract/service/registry.js';
import { McpServers } from './contract/service/servers.js';
import type { McpServerRow, McpServerRowStatus } from './contract/wire/servers.js';
import { waitsLayer } from './waits.js';

type Act = { readonly act: 'send' | 'withdraw'; readonly key: string };

const unused = () => Effect.die('unused by the waits follower');

const row = (name: string, status: McpServerRowStatus): McpServerRow => ({
  name,
  scope: 'project',
  reach: { transport: 'http', url: `https://${name}.example`, headers: [] },
  capabilities: { kinds: [], mutates: false },
  enabled: true,
  identity: name,
  status,
  tools: 0,
  measuredAt: 0,
});

const world = Effect.fnUntraced(function* (input: { readonly standing: readonly string[]; readonly limit: number }) {
  const pulses = yield* PubSub.unbounded<number | null>();
  const acts = yield* Queue.unbounded<Act>();
  const standing = new Set(input.standing);
  const rows = { now: [] as readonly McpServerRow[] };
  const context = Context.make(
    McpServers,
    McpServers.of({
      list: () => Effect.sync(() => rows.now),
      rows: () => Stream.die('unused by the waits follower'),
      moves: Effect.map(PubSub.subscribe(pulses), Stream.fromSubscription),
      opened: () => [1],
      add: unused,
      remove: unused,
      setEnabled: unused,
      signIn: unused,
      signOut: unused,
      forgetContributed: unused,
      finishSignIn: unused,
      reconcile: unused,
      reconcileAll: unused,
      raise: unused,
      palette: () => [],
      catalogRevision: () => 'none',
      caller: () => ({ call: unused }),
      contributedCall: unused,
      release: unused,
      appView: unused,
      appRead: unused,
      appCall: unused,
      appWatch: () => Stream.die('unused by the waits follower'),
    }),
  ).pipe(
    Context.add(
      Notifications,
      Notifications.of({
        send: Effect.fnUntraced(function* (sender, draft) {
          const key = draft.key ?? '';
          if (standing.size >= input.limit) return yield* new GateRefusal('too-many-open', `${sender} is full`, ['wait for one to end']);
          standing.add(key);
          yield* Queue.offer(acts, { act: 'send', key });
          return {
            id: key,
            sender,
            title: draft.title,
            body: draft.body,
            at: '',
            question: null,
            link: draft.link ?? null,
            repeated: false,
          };
        }),
        answer: unused,
        dismiss: unused,
        withdraw: Effect.fnUntraced(function* (_sender, key) {
          standing.delete(key ?? '');
          yield* Queue.offer(acts, { act: 'withdraw', key: key ?? '' });
        }),
        keys: () => Effect.sync(() => [...standing]),
        changes: Stream.die('unused by the waits follower'),
      }),
    ),
    Context.add(Senders, Senders.of({ register: () => () => undefined, accepts: () => true, deliver: unused })),
    Context.add(
      Projects,
      Projects.of({
        list: unused,
        byId: () => Effect.fail(new GateRefusal('not-found', 'no project 1', ['register it'])),
        named: unused,
        resolve: unused,
        global: unused,
        removed: unused,
        register: unused,
        setRoot: unused,
        rename: unused,
        remove: unused,
        forget: unused,
        registryVersion: Effect.die('unused by the waits follower'),
      }),
    ),
    Context.add(
      ProjectChanges,
      ProjectChanges.of({
        removed: { publish: unused, subscribe: () => () => undefined },
        grouped: { subscribe: () => () => undefined },
        changed: { publish: unused, subscribe: () => () => undefined },
      }),
    ),
  );
  return {
    acts,
    serve: (now: readonly McpServerRow[]) =>
      Effect.andThen(
        Effect.sync(() => (rows.now = now)),
        Layer.build(waitsLayer.pipe(Layer.provide(Layer.succeedContext(context)))),
      ),
    pulse: (now: readonly McpServerRow[]) =>
      Effect.andThen(
        Effect.sync(() => (rows.now = now)),
        PubSub.publish(pulses, 1),
      ),
  };
});

it.effect('a wait the operator saw before a restart is not sent again, and is withdrawn once its server stops waiting', () =>
  Effect.gen(function* () {
    const linear = 'sign-in/1/project/linear';
    const served = yield* world({ standing: [linear], limit: 20 });
    yield* served.serve([row('linear', 'needs-sign-in')]);
    yield* served.pulse([row('linear', 'connected')]);
    expect(yield* Queue.take(served.acts)).toEqual({ act: 'withdraw', key: linear });
  }),
);

it.effect("a wait refused at the sender's limit is sent once a wait ahead of it ends", () =>
  Effect.gen(function* () {
    const served = yield* world({ standing: [], limit: 1 });
    yield* served.serve([row('linear', 'needs-sign-in'), row('sentry', 'needs-value')]);
    expect(yield* Queue.take(served.acts)).toEqual({ act: 'send', key: 'sign-in/1/project/linear' });
    yield* served.pulse([row('linear', 'connected'), row('sentry', 'needs-value')]);
    expect(yield* Queue.take(served.acts)).toEqual({ act: 'withdraw', key: 'sign-in/1/project/linear' });
    expect(yield* Queue.take(served.acts)).toEqual({ act: 'send', key: 'value/1/project/sentry' });
  }),
);
