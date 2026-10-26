import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ownGitLayer, runGit } from '../../platform/git/ownGit.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { encodeBlockFile } from '../tree/blockFile.js';
import { markerText } from '../tree/marker.js';
import { shippedSteps } from '../steps/sequence.js';
import { ShadowGit } from '../tree/shadow.js';
import { syncTopology, type TreeHold } from '../tree/topology.js';
import { stealthTreeName } from '../storage/layout.js';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'operator',
  GIT_AUTHOR_EMAIL: 'operator@test',
  GIT_COMMITTER_NAME: 'operator',
  GIT_COMMITTER_EMAIL: 'operator@test',
};

export const unheld: TreeHold = () => (act) => act;

class Template extends Context.Service<Template, string>()('tagma/graph/Template') {}

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(platform));
const git = ownGitLayer(gitLayer.pipe(Layer.provide(spawning)));

export const twinWorldLayer = Layer.effect(
  Template,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'twins-template-' });
    const project = join(root, 'project');
    yield* fs.makeDirectory(project);
    yield* runGit(git, 'test', ['init', '-b', 'main', project]);
    yield* fs.writeFileString(join(project, 'README.md'), 'the project');
    yield* runGit(git, 'test', ['-C', project, 'add', '-A']);
    yield* runGit(git, 'test', ['-C', project, 'commit', '-m', 'project born'], { env: IDENTITY });
    yield* ShadowGit.open(join(root, 'tagma/graph.git'), git, null);
    return root;
  }),
).pipe(Layer.provideMerge(Layer.merge(platform, git)));

export const twinWorld = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const base = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'twins-' }));
  yield* fs.copy(yield* Template, base, { overwrite: true });
  const project = join(base, 'project');
  const sh = (args: string[], cwd?: string) => runGit(git, 'test', args, { cwd, env: IDENTITY });
  const shadow = yield* ShadowGit.open(join(base, 'tagma/graph.git'), git, null);
  const treeOf = (checkout: string) => join(base, 'tagma/trees', stealthTreeName(checkout));
  const sync = (checkout: string) => syncTopology(shadow, checkout, treeOf(checkout), shippedSteps, { treeHold: unheld });
  const checkout = Effect.fnUntraced(function* (branch: string, from: string) {
    const path = join(base, branch);
    yield* sh(['worktree', 'add', '-b', branch, path, from], project);
    return path;
  });
  const commit = Effect.fnUntraced(function* (path: string, name: string) {
    yield* fs.writeFileString(join(path, `${name}.ts`), `export const ${name} = true;`);
    yield* sh(['add', '-A'], path);
    yield* sh(['commit', '-m', name], path);
  });
  const identities = new Map<string, string>();
  const write = Effect.fnUntraced(function* (checkout: string, name: string, body = name) {
    const id = identities.get(name) ?? mintBlockId();
    identities.set(name, id);
    const text = encodeBlockFile({ frontmatter: { id, title: name, ord: 1 }, body });
    yield* fs.writeFileString(join(treeOf(checkout), `${name}.md`), text);
    yield* shadow.commitAct(treeOf(checkout), `write ${name}`);
    return text;
  });
  const level = Effect.fnUntraced(function* (twin: string) {
    const scratch = join(base, 'levelled');
    return yield* Effect.acquireUseRelease(
      sh(['--git-dir', shadow.gitDir, 'worktree', 'add', '--detach', scratch, twin]),
      () =>
        Effect.gen(function* () {
          yield* fs.writeFileString(join(scratch, FORMAT_FILE), markerText(shippedSteps.last));
          yield* sh(['add', '-A'], scratch);
          yield* sh(['commit', '-m', 'graph steps'], scratch);
          return yield* sh(['rev-parse', 'HEAD'], scratch);
        }),
      () => Effect.orDie(sh(['--git-dir', shadow.gitDir, 'worktree', 'remove', '--force', scratch])),
    );
  });
  return { base, project, shadow, treeOf, sync, checkout, commit, write, sh, level };
});
