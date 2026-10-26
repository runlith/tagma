import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { ProjectLifecycle } from '../graph/contract/service/serving.js';
import { Context, Effect } from 'effect';
import { OWN_GIT_VARIABLE } from '../platform/contract/service/credentials.js';
import { grantEnvironment } from '../platform/testing/grants.js';
import { testSessionIdentity } from '../platform/testing/identity.js';
import { commitCase, commitFixture, DOWN, FORWARD, OPERATOR, SESSION } from '../composition/testing/commitFixture.js';
import { TreeCommits } from '../graph/tree/commits.js';
import type { GraphPool } from '../graph/serving/pool.js';
import { treeGateKey } from '../graph/serving/permits.js';

const holding = Effect.fnUntraced(function* (gate: Effect.Success<typeof commitCase>, projectId: number) {
  const pool = gate.world.runtime.pool as GraphPool;
  const served = yield* pool.resolve({ projectId });
  const permit = pool.gate(treeGateKey(served.layout.treeRoot));
  yield* permit.take(1);
  return permit.release(1);
});

const quiet = ['-c', 'core.hooksPath=/dev/null'];

const op = (gate: Effect.Success<typeof commitCase>, cwd: string, id: string, input: unknown) =>
  gate.world.tagma(['op', id, '--json', JSON.stringify(input)], { cwd, env: OPERATOR });

layer(commitFixture, { excludeTestServices: true, testTimeout: 40_000, timeout: '30 seconds' })('commit gate', (it) => {
  it.effect(
    'the hooks refuse a violating session commit despite --no-verify and another server address, refuse a person’s commit, and let a person commit when no server answers',
    () =>
      Effect.gen(function* () {
        const gate = yield* commitCase;
        const before = yield* gate.head();
        yield* gate.put('b.ts', FORWARD);
        yield* gate.ran(gate.repo, ['add', 'b.ts']);
        expect((yield* gate.ran(gate.repo, ['commit', '-qm', 'forward'], SESSION)).code).not.toBe(0);
        expect((yield* gate.ran(gate.repo, ['commit', '-qm', 'forward', '--no-verify'], SESSION)).code).not.toBe(0);
        expect(
          (yield* gate.ran(gate.repo, ['commit', '-qm', 'forward', '--no-verify'], { ...SESSION, TAGMA_SERVER_URL: DOWN })).code,
        ).not.toBe(0);
        expect(yield* gate.head()).toBe(before);

        expect((yield* gate.ran(gate.repo, ['commit', '-qm', 'forward'])).code).not.toBe(0);
        expect(yield* gate.head()).toBe(before);

        yield* gate.installed(gate.repo, DOWN);
        yield* gate.put('c.ts', FORWARD);
        yield* gate.ran(gate.repo, ['add', 'c.ts']);
        expect((yield* gate.ran(gate.repo, ['commit', '-qm', 'unasked'])).code).toBe(0);
        expect(yield* gate.head()).not.toBe(before);
        yield* gate.installed(gate.repo);
      }),
  );

  it.effect('tagma check judges what the index would commit: 1 refused, 2 nothing judged for a person and 1 for a session', () =>
    Effect.gen(function* () {
      const gate = yield* commitCase;
      yield* gate.put('d.ts', FORWARD);
      yield* gate.ran(gate.repo, ['add', 'd.ts']);
      const check = (env: Record<string, string | undefined>, server?: string) =>
        Effect.map(gate.world.tagma(['check'], { cwd: gate.repo, env, server }), (answer) => answer.code);
      expect(yield* check(OPERATOR)).toBe(1);
      expect(yield* check({ ...OPERATOR, TAGMA_ALLOW: '1' })).toBe(0);
      expect(yield* check({ ...SESSION, TAGMA_ALLOW: '1' })).toBe(1);
      expect(yield* check(OPERATOR, DOWN)).toBe(2);
      expect(yield* check(SESSION, DOWN)).toBe(1);
      yield* gate.ran(gate.repo, ['reset', '-q']);

      const stray = yield* gate.seeded('unregistered');
      const strayCheck = (env: Record<string, string | undefined>) =>
        Effect.map(gate.world.tagma(['check'], { cwd: stray, env }), (answer) => answer.code);
      expect([yield* strayCheck(OPERATOR), yield* strayCheck(SESSION)]).toEqual([2, 1]);
    }),
  );

  it.effect(
    "a foreign project's live thread is judged by this checkout, its refused git commit is attributed to it, and commit_checkout refuses the same violation",
    () =>
      Effect.gen(function* () {
        const gate = yield* commitCase;
        const neighbour = yield* gate.world.directory('neighbour');
        yield* Context.get(gate.world.runtime.graph, ProjectLifecycle)
          .create({ name: `neighbour-${gate.projectId}`, rootPath: neighbour })
          .pipe(Effect.provide(gate.world.runtime.graph));
        const born = yield* gate.world.tagma(['op', 'create_thread', '--json', '{}'], { cwd: neighbour, env: OPERATOR });
        const threadId = (JSON.parse(born.out) as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
        const thread = grantEnvironment(threadId, testSessionIdentity);
        const check = () => Effect.map(gate.world.tagma(['check'], { cwd: gate.repo, env: thread }), (answer) => answer.code);
        yield* gate.put('clean.ts', 'export const clean = 1;\n');
        yield* gate.ran(gate.repo, ['add', 'clean.ts']);
        expect(yield* check()).toBe(0);
        yield* gate.ran(gate.repo, ['reset', '-q']);

        const before = yield* gate.head();
        yield* gate.put('h.ts', FORWARD);
        yield* gate.ran(gate.repo, ['add', 'h.ts']);
        expect(yield* check()).toBe(1);
        expect((yield* gate.ran(gate.repo, ['commit', '-qm', 'forward'], thread)).code).not.toBe(0);
        expect(yield* gate.head()).toBe(before);
        const read = yield* op(gate, gate.repo, 'read_enforcement', { rule: gate.rule });
        const rows = (JSON.parse(read.out) as { refusals: { rows: { file: string }[] } }).refusals.rows;
        expect(rows.find((row) => row.file === 'h.ts')).toMatchObject({
          op: 'git_commit',
          times: 1,
          branch: 'main',
          actor: { kind: 'thread', threadId },
        });

        const byThread = (id: string, input: unknown) =>
          gate.world.tagma(['op', id, '--json', JSON.stringify(input)], { cwd: gate.repo, env: thread });
        const rootId = (JSON.parse((yield* byThread('read_checkout', { root: gate.repo })).out) as { checkout: { rootId: string } })
          .checkout.rootId;
        const refused = yield* byThread('commit_checkout', { rootId, message: 'forward' });
        expect([refused.code, (JSON.parse(refused.out) as { code: string }).code]).toEqual([2, 'rule-violated']);
        expect(yield* gate.head()).toBe(before);
        yield* gate.ran(gate.repo, ['reset', '-q']);
      }),
  );

  it.effect('a tagma CLI started under Tagma’s own git refuses before it reaches the server', () =>
    Effect.gen(function* () {
      const gate = yield* commitCase;
      const own = yield* gate.world.tagma(['op', 'read_checkout', '--json', JSON.stringify({ root: gate.repo })], {
        cwd: gate.repo,
        env: { ...OPERATOR, [OWN_GIT_VARIABLE]: '1' },
      });
      expect([own.code, (JSON.parse(own.out) as { code: string }).code]).toEqual([2, 'own-git']);
    }),
  );

  it.effect(
    'a commit and a merge Tagma’s own git makes while the project’s tree permit is held complete, and no hook calls into the server',
    () =>
      Effect.gen(function* () {
        const gate = yield* commitCase;
        const calls = yield* gate.counting(gate.repo);
        yield* gate.put('own.ts', 'export const own = 1;\n');
        yield* gate.ran(gate.repo, ['add', 'own.ts']);
        yield* gate.ran(gate.repo, [...quiet, 'checkout', '-qb', 'aside']);
        yield* gate.put('aside.ts', 'export const aside = 1;\n');
        yield* gate.ran(gate.repo, ['add', 'aside.ts']);
        yield* gate.ran(gate.repo, [...quiet, 'commit', '-qm', 'aside', '--', 'aside.ts']);
        yield* gate.ran(gate.repo, [...quiet, 'checkout', '-q', 'main']);

        const release = yield* holding(gate, gate.projectId);
        yield* Effect.gen(function* () {
          expect(yield* gate.own(['commit', '-qm', 'own'])).toMatchObject({ status: 0 });
          expect(yield* gate.own(['merge', '--no-ff', '-qm', 'aside', 'aside'])).toMatchObject({ status: 0 });
        }).pipe(Effect.ensuring(release));
        expect(yield* calls()).toEqual([]);
      }),
  );

  it.effect(
    'a person’s commit returns while what it let in waits to be recorded behind the tree permit, and its escape lands once the permit is let go',
    () =>
      Effect.gen(function* () {
        const gate = yield* commitCase;
        yield* gate.counting(gate.repo);
        yield* gate.put('late.ts', FORWARD);
        yield* gate.ran(gate.repo, ['add', 'late.ts']);
        const release = yield* holding(gate, gate.projectId);
        const allowed = yield* Effect.gen(function* () {
          expect(yield* gate.ran(gate.repo, ['commit', '-qm', 'forward'], { TAGMA_ALLOW: '1' })).toMatchObject({ code: 0 });
          const head = yield* gate.head();
          expect((yield* gate.documentOf()).escaped.some((one) => one.commit === head)).toBe(false);
          return head;
        }).pipe(Effect.ensuring(release));
        const recorded = yield* gate.documentWhen((document) =>
          document.escaped.some((one) => one.commit === allowed && one.holder !== undefined),
        );
        expect(recorded.escaped.filter((one) => one.commit === allowed).map((one) => [one.path, one.holder])).toEqual([
          ['late.ts', 'operator'],
        ]);
      }),
  );

  it.effect('pull_checkout merges the upstream tree without calling a hook into the server', () =>
    Effect.gen(function* () {
      const gate = yield* commitCase;
      const calls = yield* gate.counting(gate.repo);
      const remote = `${yield* gate.world.directory('pulled-from')}/remote.git`;
      const upstream = `${yield* gate.world.directory('pulled-by')}/other`;
      yield* gate.ran(gate.repo, ['clone', '-q', '--bare', gate.repo, remote]);
      yield* gate.ran(gate.repo, ['remote', 'add', 'origin', remote]);
      yield* gate.ran(gate.repo, ['fetch', '-q', 'origin']);
      yield* gate.ran(gate.repo, ['branch', '-q', '--set-upstream-to', 'origin/main', 'main']);
      yield* gate.ran(gate.repo, ['clone', '-q', remote, upstream]);
      yield* gate.put('pulled.ts', FORWARD, upstream);
      yield* gate.ran(upstream, ['add', 'pulled.ts']);
      yield* gate.ran(upstream, [...quiet, '-c', 'user.name=peer', '-c', 'user.email=peer@test', 'commit', '-qm', 'upstream forward']);
      yield* gate.ran(upstream, ['push', '-q', 'origin', 'main']);
      yield* gate.put('local.ts', 'export const local = 1;\n');
      yield* gate.ran(gate.repo, ['add', 'local.ts']);
      yield* gate.ran(gate.repo, [...quiet, 'commit', '-qm', 'local']);

      const rootId = (
        JSON.parse((yield* op(gate, gate.repo, 'read_checkout', { root: gate.repo })).out) as { checkout: { rootId: string } }
      ).checkout.rootId;
      const pulled = yield* op(gate, gate.repo, 'pull_checkout', { rootId });
      expect(pulled).toMatchObject({ code: 0 });
      const merge = (JSON.parse(pulled.out) as { merge: string | null }).merge;
      expect(merge).toBe(yield* gate.head());
      expect(yield* calls()).toEqual([]);
      expect((yield* gate.ran(gate.repo, ['show', 'HEAD:pulled.ts'])).out).toBe(FORWARD.trim());
    }),
  );

  it.effect(
    'the operator’s commit_checkout bypasses hooks and records its escape even when another enforced rule’s program cannot judge',
    () =>
      Effect.gen(function* () {
        const gate = yield* commitCase;
        yield* gate.put(
          'crash.js',
          "export default { crash: async ({ tree }) => {\n  for (const path of tree.paths) if (((await tree.read(path)) ?? '').includes('CRASH')) process.exit(3);\n  return { tree: { findings: [] } };\n} };\n",
        );
        yield* gate.put('crashing.ts', 'export const ready = 1;\n');
        const crash = { program: 'crash.js', name: 'crash', concern: 'code', params: {}, files: ['crashing.ts'] };
        const config = (yield* gate.ran(gate.repo, ['show', 'HEAD:tagma.config.ts'])).out.replace(
          '{"reexports":',
          `{"crash":${JSON.stringify(crash)},"reexports":`,
        );
        yield* gate.put('tagma.config.ts', `${config}\n`);
        yield* gate.ran(gate.repo, ['add', '-A']);
        yield* gate.ran(gate.repo, ['commit', '-qm', 'a program that cannot judge a crash', '--no-verify']);
        const made = yield* op(gate, gate.repo, 'create_block', {
          title: 'Nothing crashes the checker',
          tags: ['rule'],
          sources: [{ kind: 'file', ref: 'crashing.ts' }],
        });
        const rule = (JSON.parse(made.out) as { block: { name: string } }).block.name;
        const on = [{ op: 'submit_work', phase: 'before' }];
        expect(
          yield* op(gate, gate.repo, 'enforce_rule', { blockId: rule, base: null, strictness: 'gate', on, inspection: 'crash' }),
        ).toMatchObject({
          code: 0,
        });

        const calls = yield* gate.counting(gate.repo);
        yield* gate.put('crashing.ts', `${FORWARD}export const CRASH = 1;\n`);
        yield* gate.ran(gate.repo, ['add', 'crashing.ts']);
        const rootId = (
          JSON.parse((yield* op(gate, gate.repo, 'read_checkout', { root: gate.repo })).out) as { checkout: { rootId: string } }
        ).checkout.rootId;
        const before = yield* gate.head();
        expect(yield* op(gate, gate.repo, 'commit_checkout', { rootId, message: 'past a crashing checker' })).toMatchObject({ code: 0 });
        const landed = yield* gate.head();
        expect(landed).not.toBe(before);
        expect(yield* calls()).toEqual([]);
        const recorded = yield* gate.documentWhen((document) =>
          document.escaped.some((one) => one.commit === landed && one.holder !== undefined),
        );
        expect(recorded.escaped.filter((one) => one.commit === landed).map((one) => [one.path, one.holder])).toEqual([
          ['crashing.ts', 'operator'],
        ]);
      }),
  );

  it.effect('a graph commit of a team tree calls no hook into the server, and a graph read of the project answers meanwhile', () =>
    Effect.gen(function* () {
      const gate = yield* commitCase;
      const root = yield* gate.seeded('team');
      const team = yield* Context.get(gate.world.runtime.graph, ProjectLifecycle)
        .create({ name: `team-${gate.projectId}`, rootPath: root, storage: 'team' })
        .pipe(Effect.provide(gate.world.runtime.graph));
      const calls = yield* gate.counting(root);
      expect(yield* op(gate, root, 'create_block', { title: 'A block the graph commits' })).toMatchObject({ code: 0 });
      const served = yield* gate.world.runtime.pool.resolve({ projectId: team.id });
      const commits = Context.get(served.context, TreeCommits);
      if (commits === undefined) return yield* Effect.die('a team tree is served with its committer');
      const answered = yield* Effect.all([commits.commit, op(gate, root, 'search_blocks', { query: 'graph commits' })], { concurrency: 2 });
      expect(answered).toMatchObject([{ kind: 'committed' }, { code: 0 }]);
      expect((yield* gate.ran(root, ['log', '-1', '--format=%an'])).out).toBe('tagma');
      expect(yield* calls()).toEqual([]);
    }),
  );
});
