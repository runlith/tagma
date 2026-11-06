import { dirname, join } from 'node:path';
import { changeOf } from '@runlith/files/change';
import { replaced } from '@runlith/files/replace';
import { pluginTemplate } from '@runlith/tagma/plugin/template';
import { Clock, Effect, FileSystem } from 'effect';
import { Intake } from '../change-record/contract/service/intake.js';
import type { SettableScope } from '../platform/contract/wire/setting.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Projects } from '../projects/contract/service/registry.js';
import type { Holder } from '../workspace/contract/wire/checkout.js';
import { PluginPlaces } from './contract/service/plugins.js';
import { ownRoot } from './sources.js';

const PROJECT_PLUGINS = '.tagma-plugins';

const ABSENT = { absent: true } as const;

const unwritable = (folder: string, reason: string) =>
  new GateRefusal('plugin-folder-unwritable', `The plugin folder ${folder} could not be written: ${reason}`, [
    `make ${dirname(folder)} writable to the server, then create the plugin again`,
  ]);

export const createPlugin = Effect.fn('Plugins.create')(function* (input: {
  readonly projectId: number;
  readonly id: string;
  readonly title: string;
  readonly scope: SettableScope;
  readonly holder: Holder;
}) {
  const files = yield* FileSystem.FileSystem;
  const intake = yield* Intake;
  const project = yield* (yield* Projects)
    .byId(input.projectId)
    .pipe(
      Effect.mapError(
        () =>
          new GateRefusal('unknown-project', `No project ${input.projectId} is registered.`, [
            'list_projects names the registered projects',
          ]),
      ),
    );
  const folder = input.scope === 'user' ? ownRoot((yield* PluginPlaces).home, input.id) : join(project.rootPath, PROJECT_PLUGINS, input.id);
  if (yield* files.exists(folder).pipe(Effect.mapError((failure) => unwritable(folder, failure.message)))) {
    return yield* new GateRefusal('plugin-folder-taken', `${folder} already stands, so no plugin is created over it.`, [
      `install_plugin from ${folder} if it is that plugin, or create the plugin under another id`,
    ]);
  }
  const at = new Date(yield* Clock.currentTimeMillis);
  const written = pluginTemplate({ id: input.id, title: input.title }).map((file) => ({ path: join(folder, file.path), text: file.text }));
  const write = Effect.gen(function* () {
    for (const { path, text } of written) {
      yield* files.makeDirectory(dirname(path), { recursive: true });
      if (!(yield* replaced(path, ABSENT, text))) return false;
    }
    return true;
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, files),
    Effect.mapError((failure) => unwritable(folder, failure.message)),
  );
  if (input.scope === 'user') {
    if (!(yield* write)) return yield* moved(folder);
    return folder;
  }
  const facts = written.map(({ path, text }) => changeOf('write', path, ABSENT, '', text, false, at));
  const landed = yield* intake
    .turn(
      input.projectId,
      written.map(({ path }) => path),
      intake.land({ projectId: input.projectId, holder: input.holder }, facts, write),
    )
    .pipe(Effect.catchTag('IntakeRefused', (refused) => Effect.fail(unwritable(folder, refused.message))));
  if (landed._tag === 'moved') return yield* moved(folder);
  return folder;
});

const moved = (folder: string) =>
  new GateRefusal('plugin-folder-taken', `A file appeared in ${folder} while the plugin was created.`, [
    `read ${folder} and create the plugin under another id`,
  ]);
