import { sessionIdentity } from '../../external-harnesses/testing/builtin.js';
import { ProjectLifecycle } from '../../graph/contract/service/serving.js';
import { expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Git } from '@runlith/git/Git';
import { Context, Effect, FileSystem, Layer, Queue } from 'effect';
import { GraphFeed } from '../../graph/contract/service/journal.js';
import { COMMIT_HOOKS, type HookCli, installCommitHooks } from '../../enforcement/commits/hooks.js';
import { Blocks } from '../../graph/contract/service/blocks.js';
import { BlockNames } from '../../graph/contract/service/acts.js';
import { blockName } from '../../graph/contract/wire/references.js';
import type { LawEnforcement } from '../../graph/contract/wire/enforcement.js';
import { GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { unsignedEnvironment } from '../../platform/credentials/grants.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { makeTerminalWorld } from './fixture.js';

const OWNER = '/tagma-commit-fixture-owner';
const CLI = join(import.meta.dir, '../developer/cli.ts');
export const FORWARD = "export * from './a';\n";
export const DOWN = 'http://127.0.0.1:9';
const REEXPORTS = { builtin: 'reexports', params: { base: '', allows: [], files: { extensions: ['.ts'], exclude: [] } } };
export const OPERATOR = { [GRANT_VARIABLE]: undefined };
export const SESSION = { [GRANT_VARIABLE]: 'a-session-grant' };
export type Ran = { readonly code: number | null; readonly out: string; readonly err: string };

const present = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));

const makeCommitFixture = Effect.fn('commitFixture.make')(function* () {
  const files = yield* FileSystem.FileSystem;
  const world = yield* makeTerminalWorld();
  const directory = (name: string) => world.directory(join('commits', randomUUID(), name));
  const git = Context.get(world.runtime.graph, Git);
  const cli = (server = world.url, owner = OWNER): HookCli => ({ runtime: process.execPath, entry: CLI, server, owner });
  const ran = Effect.fn('commitFixture.git')(function* (
    cwd: string,
    args: readonly string[],
    env: Record<string, string | undefined> = {},
  ) {
    const merged = { ...unsignedEnvironment(process.env, sessionIdentity), TAGMA_ALLOW: undefined, ...env };
    const result = yield* spawnedEffect(['git', ...args], { cwd, env: present(merged), stdin: 'ignore' });
    return { code: result.exitCode, out: result.stdout.toString().trim(), err: result.stderr.toString() } satisfies Ran;
  });
  const seed = yield* directory('seed');
  yield* Effect.gen(function* () {
    const root = seed;
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 'tagma@test'],
      ['config', 'user.name', 'tagma'],
    ]) {
      const result = yield* ran(root, args);
      if (result.code !== 0) return yield* Effect.die(new Error(result.err));
    }
    yield* files.writeFileString(join(root, 'a.ts'), 'export const a = 1;\n');
    yield* files.writeFileString(
      join(root, 'tagma.config.ts'),
      `export default ${JSON.stringify({ inspections: { reexports: REEXPORTS } })};\n`,
    );
    for (const args of [
      ['add', '-A'],
      ['commit', '-qm', 'seed', '--no-verify'],
    ]) {
      const result = yield* ran(root, args);
      if (result.code !== 0) return yield* Effect.die(new Error(result.err));
    }
  });
  const seeded = Effect.fn('commitFixture.seeded')(function* (name: string) {
    const root = yield* directory(name);
    yield* files.copy(seed, root, { overwrite: true });
    return root;
  });
  const take = Effect.fn('commitFixture.take')(function* () {
    const repo = yield* seeded('gated');
    const projectId = (yield* Context.get(world.runtime.graph, ProjectLifecycle)
      .create({ name: `gated-${randomUUID()}`, rootPath: repo })
      .pipe(Effect.provide(world.runtime.graph))).id;
    const root = yield* Context.get(world.runtime.graph, Blocks).rootBlockOf(projectId).pipe(Effect.provide(world.runtime.graph));
    const made = yield* world.tagma(
      [
        'op',
        'create_block',
        '--json',
        JSON.stringify({ title: 'No module forwards another module', tags: ['rule'], parentId: blockName(root.uuid) }),
      ],
      { cwd: repo, env: OPERATOR },
    );
    expect(made.code, made.err || made.out).toBe(0);
    const rule = (JSON.parse(made.out) as { block: { name: string } }).block.name;
    const enforced = yield* world.tagma(
      [
        'op',
        'enforce_rule',
        '--json',
        JSON.stringify({
          blockId: rule,
          base: null,
          strictness: 'gate',
          on: [{ op: 'submit_work', phase: 'before' }],
          inspection: 'reexports',
        }),
      ],
      { cwd: repo, env: OPERATOR },
    );
    expect(enforced.code, enforced.err || enforced.out).toBe(0);
    expect(yield* installCommitHooks(git, repo, cli())).toMatchObject({ hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: 'written' })) });
    const counting = Effect.fn('commitFixture.counting')(function* (root: string) {
      const calls = join(yield* world.directory('hook-calls'), randomUUID());
      const entry = `${calls}.mjs`;
      yield* files.writeFileString(
        entry,
        `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');\nawait import(${JSON.stringify(CLI)});\n`,
      );
      yield* installCommitHooks(git, root, { ...cli(), entry });
      return Effect.fnUntraced(function* () {
        return (yield* files.exists(calls)) ? (yield* files.readFileString(calls)).split('\n').filter((line) => line !== '') : [];
      });
    });
    const documentOf = Effect.fnUntraced(function* () {
      const served = yield* world.runtime.pool.resolve({ projectId });
      return yield* Effect.gen(function* () {
        const blocks = yield* Blocks;
        const names = yield* BlockNames;
        return (yield* blocks.blockById(yield* names.idOfName(rule))).fields.enforcement as LawEnforcement;
      }).pipe(Effect.provide(served.context));
    });
    const changes = yield* Queue.unbounded<void>();
    const served = yield* world.runtime.pool.resolve({ projectId });
    yield* Effect.acquireRelease(
      Context.get(served.context, GraphFeed).subscribe(projectId, () => {
        Queue.offerUnsafe(changes, undefined);
      }),
      (stop) => Effect.sync(stop),
    );
    const documentWhen = Effect.fn('commitFixture.documentWhen')(function* (done: (document: LawEnforcement) => boolean) {
      for (;;) {
        const document = yield* documentOf();
        if (done(document)) return document;
        yield* Queue.take(changes);
      }
    });
    return {
      world: { ...world, directory },
      repo,
      projectId,
      rule,
      ran,
      put: (path: string, text: string, at = repo) => files.writeFileString(join(at, path), text),
      seeded,
      head: (cwd = repo) => Effect.map(ran(cwd, ['rev-parse', 'HEAD']), (result) => result.out),
      installed: (root: string, server?: string, owner?: string) => installCommitHooks(git, root, cli(server, owner)),
      counting,
      own: (args: readonly string[], cwd = repo) =>
        Effect.orDie(git.run(['-C', cwd, ...args], { env: present(unsignedEnvironment(process.env, sessionIdentity)) })),
      documentOf,
      documentWhen,
    };
  });
  return { scene: yield* take() };
});

export class CommitFixture extends Context.Service<CommitFixture, Effect.Success<ReturnType<typeof makeCommitFixture>>>()(
  'testing/CommitFixture',
) {}
export const commitFixture = Layer.effect(CommitFixture, makeCommitFixture()).pipe(Layer.provide(BunFileSystem.layer));
export const commitCase = Effect.map(CommitFixture, (fixture) => fixture.scene);
