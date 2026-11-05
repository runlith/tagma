import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect } from 'effect';
import { type GitAnswer, GitUnavailable, Git } from '@runlith/git/Git';
import { LandingLanes } from '../land/lanes.js';
import type { PreparedChange } from '../../change-record/contract/service/prepared.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { commitLane } from '../../platform/git/lanes.js';
import type { PreservedWorktree } from '../../worktrees/contract/service/preservation.js';
import { memoryIntents } from '../testing/lifecycle.js';
import { preservation } from './commit.js';

const BRANCH = 'refs/heads/wt';

type Repo = {
  readonly refs: Map<string, string>;
  commits: number;
  dropPublication: number;
};

const answer = (stdout: string, status = 0, stderr = ''): GitAnswer => ({
  status,
  stdout,
  stderr,
  overflow: false,
  messageOverflow: false,
});

const plain = (args: readonly string[]): readonly string[] => {
  const rest: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === '-C' || args[at] === '-c' || args[at] === '--git-dir') at += 1;
    else if (args[at] !== '--literal-pathspecs') rest.push(args[at]!);
  }
  return rest;
};

const gitOf = (repo: Repo): Git['Service'] => ({
  run: (args, options) =>
    Effect.suspend(() => {
      const [verb, ...rest] = plain(args);
      if (verb === 'symbolic-ref') return Effect.succeed(answer(BRANCH));
      if (verb === 'rev-parse') {
        if (rest.includes('--git-common-dir')) return Effect.succeed(answer('/repo/.git\n'));
        if (rest.includes('--git-path'))
          return Effect.succeed(
            answer(
              `${[
                ...(rest.includes('--absolute-git-dir') ? ['/repo/.git'] : []),
                ...rest.filter((one) => !one.startsWith('-')).map((one) => `/nowhere/${one}`),
              ].join('\n')}\n`,
            ),
          );
        if (rest.includes('--verify')) {
          const sha = repo.refs.get(rest.at(-1)!.replace('^{commit}', ''));
          return Effect.succeed(sha === undefined ? answer('', 1) : answer(sha));
        }
        return Effect.succeed(answer('/repo/.git\n'));
      }
      if (verb === 'commit-tree') {
        repo.commits += 1;
        return Effect.succeed(answer(`c${repo.commits}`));
      }
      if (verb === 'update-ref' && rest[0] === '-d') {
        if (repo.refs.get(rest[1]!) !== rest[2]) return Effect.succeed(answer('', 1, 'cannot lock ref'));
        repo.refs.delete(rest[1]!);
        return Effect.succeed(answer(''));
      }
      if (verb === 'update-ref') {
        if (repo.dropPublication > 0) {
          repo.dropPublication -= 1;
          return Effect.fail(new GitUnavailable({ command: args, reason: 'killed' }));
        }
        const lines = String(options?.stdin ?? '')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => line.split(' '));
        const holds = lines.every(([op, ref, , old]) => (op === 'create' ? !repo.refs.has(ref!) : repo.refs.get(ref!) === old));
        if (!holds) return Effect.succeed(answer('', 128, 'cannot lock ref'));
        for (const [, ref, sha] of lines) repo.refs.set(ref!, sha!);
        return Effect.succeed(answer(''));
      }
      return Effect.succeed(answer(''));
    }),
});

const prepared = (tree = 't1'): PreparedChange<PreservedWorktree> => ({
  subject: { kind: 'tree', projectId: 1, root: '/wt', base: 'b0', built: tree, paths: ['a.ts'], caller: { name: 'wt', holders: ['sol'] } },
  built: {
    base: 'b0',
    tree,
    from: tree,
    changed: ['a.ts'],
    entries: { base: 'b0', tree, before: new Map(), after: new Map() },
    plan: [],
    hashes: new Map(),
    reshaped: [],
    formatSkipped: false,
    declaration: [],
  },
  index: '/index',
});

type Tools = {
  readonly repo: Repo;
  readonly store: ReturnType<typeof memoryIntents>;
  readonly preserved: Effect.Success<ReturnType<typeof preservation>>;
  readonly reboot: () => Effect.Effect<Effect.Success<ReturnType<typeof preservation>>>;
};

const world = Effect.fnUntraced(function* <A, E>(use: (tools: Tools) => Effect.Effect<A, E>) {
  const repo: Repo = { refs: new Map([[BRANCH, 'b0']]), commits: 0, dropPublication: 0 };
  const store = memoryIntents();
  const context = Context.make(Git, gitOf(repo)).pipe(Context.add(LandingLanes, { commits: yield* commitLane }));
  const started = yield* Clock.currentTimeMillis;
  const make = (at: number) => Effect.provide(preservation({ lifecycle: store.lifecycle, startedAt: new Date(at) }), context);
  return yield* use({
    repo,
    store,
    preserved: yield* make(started),
    reboot: Effect.fnUntraced(function* () {
      return yield* make((yield* Clock.currentTimeMillis) + 1);
    }),
  });
});

const key = RequestKey.make('archive-1');

const keyRefs = (repo: Repo) => [...repo.refs.keys()].filter((ref) => ref.startsWith('refs/tagma/'));

it.live('an archive asked again by its key answers the same receipt without a second commit', () =>
  world(({ repo, preserved }) =>
    Effect.gen(function* () {
      const first = yield* preserved.commit(key, prepared());
      const again = yield* preserved.commit(key, prepared());
      expect(repo.refs.get(BRANCH)).toBe(first.commit);
      expect(again).toEqual(first);
      expect(repo.commits).toBe(1);
      expect(keyRefs(repo)).toEqual([]);
      expect(yield* preserved.readReceipt(key)).toEqual(first);
    }),
  ),
);

it.live('a preservation killed after publishing and before its receipt is recorded at boot from its key proof, never committed twice', () =>
  world(({ repo, store, preserved, reboot }) =>
    Effect.gen(function* () {
      store.faults.receive = 1;
      const killed = yield* Effect.flip(preserved.commit(key, prepared()));
      expect(killed._tag).toBe('PreservationUnavailable');
      const published = repo.refs.get(BRANCH);
      const booted = yield* reboot();
      yield* booted.recover;
      const receipt = yield* booted.readReceipt(key);
      expect(receipt?.commit).toBe(published);
      expect(store.intents.get(key)?.phase).toBe('settled');
      expect(repo.commits).toBe(1);
      expect(keyRefs(repo)).toEqual([]);
    }),
  ),
);

it.live('a witnessed preservation without proof becomes lost once and is never published again', () =>
  world(({ repo, store, preserved, reboot }) =>
    Effect.gen(function* () {
      repo.dropPublication = 1;
      yield* Effect.flip(preserved.commit(key, prepared()));
      const booted = yield* reboot();
      yield* booted.recover;
      expect(store.intents.get(key)?.phase).toBe('lost');
      const again = yield* Effect.flip(booted.commit(key, prepared()));
      const read = yield* Effect.flip(booted.readReceipt(key));
      expect([again._tag, read._tag]).toEqual(['PreservationLost', 'PreservationLost']);
      expect(repo.refs.get(BRANCH)).toBe('b0');
      expect(repo.commits).toBe(1);
    }),
  ),
);

it.live('a key already naming another tree conflicts instead of committing', () =>
  world(({ repo, preserved }) =>
    Effect.gen(function* () {
      yield* preserved.commit(key, prepared('t1'));
      const other = yield* Effect.flip(preserved.commit(key, prepared('t2')));
      expect(other._tag).toBe('PreservationConflict');
      expect(repo.commits).toBe(1);
    }),
  ),
);

it.live('a key whose intent another call of this process holds is refused as claimed, and publishes nothing', () =>
  world(({ repo, store, preserved }) =>
    Effect.gen(function* () {
      const live = {
        key,
        kind: 'preservation' as const,
        projectId: 1,
        phase: 'intended' as const,
        repository: '/repo/.git',
        checkout: '/wt',
        ref: BRANCH,
        base: 'b0',
        tree: 't1',
        commit: null,
        witnessedAt: null,
        at: new Date((yield* Clock.currentTimeMillis) + 1000),
      };
      yield* store.lifecycle.claim(live, null);
      const refused = yield* Effect.flip(preserved.commit(key, prepared()));
      expect(refused._tag === 'PreservationUnavailable' && refused.cause).toBe('claimed');
      expect(repo.commits).toBe(0);
      expect(store.intents.get(key)).toEqual(live);
    }),
  ),
);

it.live('an intent left by an earlier process is taken over and published once', () =>
  world(({ repo, store, preserved }) =>
    Effect.gen(function* () {
      yield* store.lifecycle.claim(
        {
          key,
          kind: 'preservation',
          projectId: 1,
          phase: 'intended',
          repository: '/repo/.git',
          checkout: '/wt',
          ref: BRANCH,
          base: 'b0',
          tree: 't1',
          commit: null,
          witnessedAt: null,
          at: new Date(0),
        },
        null,
      );
      const receipt = yield* preserved.commit(key, prepared());
      expect(repo.refs.get(BRANCH)).toBe(receipt.commit);
      expect(repo.commits).toBe(1);
    }),
  ),
);

it.live('a failure before the witness releases the key, so the same request can be asked again', () =>
  world(({ repo, store, preserved }) =>
    Effect.gen(function* () {
      repo.refs.set(BRANCH, 'elsewhere');
      yield* Effect.flip(preserved.commit(key, prepared()));
      expect(store.intents.has(key)).toBe(false);
      repo.refs.set(BRANCH, 'b0');
      const receipt = yield* preserved.commit(key, prepared());
      expect(repo.refs.get(BRANCH)).toBe(receipt.commit);
    }),
  ),
);

it.live('a branch that left its base refuses and leaves no receipt behind the key', () =>
  world(({ repo, preserved }) =>
    Effect.gen(function* () {
      repo.refs.set(BRANCH, 'elsewhere');
      const refused = yield* Effect.flip(preserved.commit(key, prepared()));
      expect(refused._tag === 'PreservationRefused' && refused.reason).toBe('moved');
      expect(yield* preserved.readReceipt(key)).toBeNull();
      expect(repo.refs.get(BRANCH)).toBe('elsewhere');
    }),
  ),
);
