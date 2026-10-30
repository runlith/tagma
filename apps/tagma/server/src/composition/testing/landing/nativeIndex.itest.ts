import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Context, Effect } from 'effect';
import { join } from 'node:path';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { CurrentGraph } from '../../../graph/contract/service/serving.js';
import { LandingGit } from '../../../landing/contract/service/servedGit.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { nativeLanding } from './native.js';

it.live('submit_work never overwrites an external git add accepted after its index read', () =>
  Effect.gen(function* () {
    const { world, root, projectId, files, born, doors, write, read } = yield* nativeLanding({ 'value.ts': 'export const value = 1;\n' });
    const caller = yield* born();
    yield* write(caller.threadId, 'value.ts', 'export const value = 2;\n');
    const git = Context.get(world.runtime.owners, Git);
    let published = false;
    let staged: { readonly status: number | null; readonly locked: boolean } | null = null;
    const external = 'export const value = 3;\n';
    const guarded = Git.of({
      run: Effect.fnUntraced(function* (args, options) {
        const answer = yield* git.run(args, options);
        if (args.includes('update-ref') && answer.status === 0) published = true;
        if (published && staged === null && args.includes('ls-files') && args.includes('--stage')) {
          yield* Effect.orDie(files.writeFileString(join(root, 'value.ts'), external));
          const added = yield* Effect.orDie(spawnedEffect(['git', 'add', '--', 'value.ts'], { cwd: root }));
          staged = { status: added.exitCode, locked: yield* Effect.orDie(files.exists(join(root, '.git', 'index.lock'))) };
        }
        return answer;
      }),
    });
    const served = { ...caller.served, git: guarded, context: Context.add(caller.served.context, Git, guarded) };
    const owners = Context.mergeAll(world.routed, world.runtime.owners, world.runtime.workspace, world.runtime.enforcement).pipe(
      Context.add(Git, guarded),
      Context.add(CurrentGraph, served),
      Context.add(LandingGit, { run: (_act, platform) => Effect.succeed(platform) }),
    );
    const origin = yield* Context.get(owners, WorkingOrigins).of({ projectId, threadId: caller.threadId }, root);
    const vocabulary = yield* Context.get(caller.served.context, Tags).of(projectId);
    const native = yield* fixtureNativeCatalog(
      {
        caller: {
          actor: {
            kind: 'thread',
            threadId: caller.threadId,
            projectId,
            principalId: 'owner',
            session: { harness: 'tagma', key: caller.threadId },
          },
          files: null,
        },
        place: { root, origin },
        world: 'checkout',
        project: { id: projectId, name: 'test' },
        vocabulary: () => vocabulary,
        identity: testSessionIdentity,
        served,
        owners,
      },
      ['submit_work'],
    );
    const submitted = yield* doors.atNative('submit_work', { subject: 'land while an external user stages' }, { ...caller, native });
    expect(submitted).toMatchObject({ class: 'answer', value: { submitted: { status: 'landed' } } });
    expect(yield* read('value.ts')).toBe('export const value = 2;\n');
    const attempt = (): typeof staged => staged;
    const attempted = attempt();
    expect(attempted).not.toBeNull();
    if (attempted === null) return;
    if (attempted.status !== 0) {
      expect(attempted.locked).toBe(true);
      expect((yield* spawnedEffect(['git', 'add', '--', 'value.ts'], { cwd: root })).exitCode).toBe(0);
    }
    const index = yield* spawnedEffect(['git', 'show', ':value.ts'], { cwd: root });
    expect(index.exitCode).toBe(0);
    expect(new TextDecoder().decode(index.stdout)).toBe(external);
    expect(yield* files.readFileString(join(root, 'value.ts'))).toBe(external);
    expect(yield* files.exists(join(root, '.git', 'index.lock'))).toBe(false);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
