import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { join } from 'node:path';
import { Context, type Duration, Effect, Exit, Layer, Scope } from 'effect';
import { graphFixture, tempRootEffect } from '../../composition/testing/graphFixture.js';
import { FileWatcher } from '../../platform/contract/service/watch.js';
import { tagmaFormat } from '../../plugin-formats/tagma/format.js';
import { type PluginFolder, writePlugin } from '../../plugin-formats/tagma/testing/folder.js';
import { type PluginFormat, PluginFormats } from '../../plugins/contract/service/format.js';
import { BuiltinPlugins, PluginPlaces, Plugins, RevisionRecords } from '../../plugins/contract/service/plugins.js';
import { unrecorded } from '../../plugins/testing/revisions.js';
import { plugins as pluginsModule } from '../../plugins/plugins.js';
import { ProjectChanges } from '../../projects/contract/service/changes.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Secrets, SecretsPlace } from '../../secrets/contract/service/secrets.js';
import { secrets as secretsModule } from '../../secrets/secrets.js';
import { Settings } from '../../settings/contract/service/values.js';
import { HostPlace, PLUGIN_QUIET, PluginHost } from '../contract/service/supervision.js';
import { PluginTools } from '../contract/service/tools.js';
import { pluginHost } from '../plugin-host.js';

const fixtureGraph = graphFixture();

export const hostWorld = Effect.fnUntraced(function* (input: {
  readonly prefix: string;
  readonly seed?: (home: string) => Promise<void>;
  readonly watcher?: Context.Context<FileWatcher>;
  readonly formats?: readonly PluginFormat[];
  readonly quiet?: Duration.Input;
}) {
  const demo = yield* Effect.acquireRelease(fixtureGraph.openEffect(), () => Effect.orDie(fixtureGraph.releaseEffect));
  const projectId = demo.projectId;
  const home = yield* tempRootEffect(demo.fixture, input.prefix).pipe(Effect.provide(BunFileSystem.layer));
  const project = yield* Context.get(demo.context, Projects).byId(projectId);
  yield* Effect.promise(() => input.seed?.(home) ?? Promise.resolve());
  const files = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
  const stored = secretsModule.lifetimes.installation.pipe(Layer.provide(Layer.succeed(SecretsPlace, { home })));
  const stack = pluginHost.lifetimes.installation.pipe(
    Layer.provide(Layer.succeed(HostPlace, { server: 'http://127.0.0.1:1', quiet: input.quiet ?? PLUGIN_QUIET })),
    Layer.provideMerge(
      pluginsModule.lifetimes.installation.pipe(
        Layer.provide(Layer.succeed(PluginPlaces, { home })),
        Layer.provide(Layer.succeed(BuiltinPlugins, [])),
        Layer.provide(Layer.succeed(RevisionRecords, unrecorded)),
        Layer.provide(Layer.succeed(PluginFormats, input.formats ?? [tagmaFormat])),
        Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(files))),
        Layer.provide(BunFileSystem.layer),
      ),
    ),
    Layer.provideMerge(Layer.merge(stored, BunFileSystem.layer)),
  );
  const outer = yield* Effect.scope;

  const boot = Effect.fnUntraced(function* () {
    const scope = yield* Scope.fork(outer, 'sequential');
    const built = yield* Layer.buildWithScope(stack, scope).pipe(
      Effect.provideService(Settings, Context.get(demo.context, Settings)),
      Effect.provideService(Projects, Context.get(demo.context, Projects)),
      Effect.provideService(ProjectChanges, Context.get(demo.context, ProjectChanges)),
      Effect.provide(input.watcher ?? Context.empty()),
    );
    const host = Context.get(built, PluginHost);
    yield* host.start();
    const installed = Context.get(built, Plugins);
    const said = Effect.fnUntraced(function* (tool: string, id = 'fixture') {
      const result = yield* host.call(id, tool, {}, {});
      if (!('content' in result)) return yield* Effect.die('the fixture answered no content');
      const first = result.content[0];
      return first?.type === 'text' ? first.text : '';
    });
    return {
      host,
      plugins: installed,
      tools: Context.get(built, PluginTools),
      secrets: Context.get(built, Secrets),
      said,
      install: Effect.fnUntraced(function* (root: string) {
        const prepared = yield* installed.prepare({ projectId, source: root });
        return yield* installed.install({ projectId, prepared, enabled: true, scope: 'project' });
      }),
      shutdown: Scope.close(scope, Exit.void),
    };
  });

  const place = Effect.fnUntraced(function* (id: string, folder: Omit<PluginFolder, 'id'>) {
    const root = join(project.rootPath, '.tagma-plugins', id);
    yield* Effect.promise(() => writePlugin(root, { id, title: 'Fixture', ...folder }));
    return root;
  });

  const until = Effect.fnUntraced(function* (holds: () => boolean) {
    while (!holds()) yield* Effect.sleep('50 millis');
  });

  return {
    ...(yield* boot()),
    projectId,
    home,
    boot,
    place,
    until,
    data: (id: string) => join(home, 'agent-plugin-data', id),
  };
});
