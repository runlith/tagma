import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { type GitAnswer, GitUnavailable, type Git } from '@runlith/git/Git';
import { memoryIntents } from '../testing/lifecycle.js';
import { landingIntents, recoverLandings } from './intents.js';

const answer = (stdout: string, status = 0, stderr = ''): GitAnswer => ({
  status,
  stdout,
  stderr,
  overflow: false,
  messageOverflow: false,
});

type Checkout = { readonly log: string } | { readonly gone: string } | 'unreachable';

const gitOf = (checkouts: ReadonlyMap<string, Checkout>, asked: string[]): Git['Service'] => ({
  run: (args) =>
    Effect.suspend(() => {
      const root = args[args.indexOf('-C') + 1]!;
      asked.push(root);
      const checkout = checkouts.get(root);
      if (checkout === 'unreachable' || checkout === undefined)
        return Effect.fail(new GitUnavailable({ command: args, reason: 'spawn failed' }));
      if ('gone' in checkout) return Effect.succeed(answer('', 128, checkout.gone));
      return Effect.succeed(answer(checkout.log));
    }),
});

const line = (sha: string, tree: string, parents: string) => `${sha}\0${tree}\0${parents}`;

const BOOT = new Date('2026-09-29T00:00:00Z');

it.effect(
  'a landing killed after its commit is answered at boot by its key: the commit is found and recorded, and git is never asked to commit',
  () =>
    Effect.gen(function* () {
      const store = memoryIntents();
      const asked: string[] = [];
      const intents = landingIntents(store.lifecycle);
      yield* intents.intend('landing:a:1', 1, '/landed', 'b0', 't1');
      yield* intents.intend('landing:b:1', 1, '/never', 'b0', 't1');
      yield* intents.intend('landing:c:1', 1, '/gone', 'b0', 't1');
      yield* intents.intend('landing:d:1', 1, '/unreachable', 'b0', 't1');
      for (const one of store.intents.values()) store.intents.set(one.key, { ...one, at: new Date(BOOT.getTime() - 1000) });
      const checkouts = new Map<string, Checkout>([
        ['/landed', { log: [line('c9', 't9', 'c1'), line('c1', 't1', 'b0')].join('\n') }],
        ['/never', { log: line('x1', 't7', 'b0') }],
        ['/gone', { gone: 'fatal: not a git repository' }],
        ['/unreachable', 'unreachable'],
      ]);
      const report = yield* recoverLandings(store.lifecycle, gitOf(checkouts, asked), BOOT);
      expect(report.landed).toEqual([{ key: 'landing:a:1', commit: 'c1' }]);
      expect(report.forgotten).toEqual(['landing:b:1']);
      expect(report.lost.map((one) => one.key)).toEqual(['landing:c:1']);
      expect(report.unread.map((one) => one.key)).toEqual(['landing:d:1']);
      expect(store.intents.get('landing:a:1')?.phase).toBe('settled');
      expect([...store.intents.keys()].sort()).toEqual(['landing:a:1', 'landing:d:1']);
      expect(asked.sort()).toEqual(['/gone', '/landed', '/never', '/unreachable']);
    }),
);

it.effect('a landing that went in on a commit landed first is still found by its tree, and an unreadable range keeps the intent', () =>
  Effect.gen(function* () {
    const store = memoryIntents();
    const intents = landingIntents(store.lifecycle);
    yield* intents.intend('landing:stacked:1', 1, '/stacked', 'b0', 't1');
    yield* intents.intend('landing:locked:1', 1, '/locked', 'b0', 't1');
    for (const one of store.intents.values()) store.intents.set(one.key, { ...one, at: new Date(BOOT.getTime() - 1000) });
    const checkouts = new Map<string, Checkout>([
      ['/stacked', { log: [line('c2', 't1', 'p1'), line('p1', 't0', 'b0')].join('\n') }],
      ['/locked', { gone: 'fatal: bad revision b0..HEAD' }],
    ]);
    const report = yield* recoverLandings(store.lifecycle, gitOf(checkouts, []), BOOT);
    expect(report.landed).toEqual([{ key: 'landing:stacked:1', commit: 'c2' }]);
    expect(report.unread.map((one) => one.key)).toEqual(['landing:locked:1']);
    expect(store.intents.get('landing:locked:1')?.phase).toBe('intended');
  }),
);

it.effect('recovery leaves the landings of the running process alone and prunes only ended landings past the window', () =>
  Effect.gen(function* () {
    const store = memoryIntents();
    const intents = landingIntents(store.lifecycle);
    yield* intents.intend('landing:live:1', 1, '/checkout', 'b0', 't1');
    yield* intents.intend('landing:old:1', 1, '/checkout', 'b0', 't1');
    yield* intents.land('landing:old:1', 'c0');
    const live = store.intents.get('landing:live:1')!;
    store.intents.set(live.key, { ...live, at: new Date(BOOT.getTime() + 1) });
    const old = store.intents.get('landing:old:1')!;
    store.intents.set(old.key, { ...old, at: new Date(BOOT.getTime() - 8 * 24 * 60 * 60 * 1000) });
    const asked: string[] = [];
    const report = yield* recoverLandings(store.lifecycle, gitOf(new Map(), asked), BOOT);
    expect(asked).toEqual([]);
    expect(report.pruned).toBe(1);
    expect([...store.intents.keys()]).toEqual(['landing:live:1']);
  }),
);
