import { Effect, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import {
  buildFeaturesAt,
  configValueAt,
  fsmonitorWatchingAt,
  setLocalConfigAt,
  stopFsmonitorAt,
  troubleOf,
  type GitAnswerInvalid,
  type GitRefused,
  type GitUnreadable,
} from '@runlith/git/repository';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { SettingKey } from '../../platform/contract/wire/setting.js';
import { session } from '../../platform/store/writers.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { ManagedWrite } from '../../settings/contract/service/managed.js';
import { setting } from '../../settings/store/table.js';
import { fsmonitor, untrackedCache } from '../contract/wire/settings.js';

export type Speedup = { readonly key: string; readonly mark: string };

export const UNTRACKED: Speedup = { key: 'core.untrackedCache', mark: 'tagma.fastStatus.untrackedCache' };
export const MONITOR: Speedup = { key: 'core.fsmonitor', mark: 'tagma.fastStatus.fsmonitor' };

const ON = 'true';

const MONITORED = new Set<string>(['darwin', 'win32']);

const DAEMON = 'fsmonitor--daemon';

export type GitFailure = GitUnreadable | GitRefused | GitAnswerInvalid;

export type KeptValue = { readonly key: string; readonly value: string; readonly scope: string };

export const monitorCarried = (git: Git['Service'], dir: string, platform: string): Effect.Effect<boolean, GitFailure> =>
  MONITORED.has(platform) ? Effect.map(buildFeaturesAt(git, dir), (features) => features.has(DAEMON)) : Effect.succeed(false);

export const enableSpeedup = Effect.fn('FastStatus.enable')(function* (
  git: Git['Service'],
  dir: string,
  speedup: Speedup,
): Effect.fn.Return<KeptValue | null, GitFailure> {
  const standing = yield* configValueAt(git, dir, speedup.key);
  if (standing !== null) return standing.value === ON ? null : { key: speedup.key, ...standing };
  yield* setLocalConfigAt(git, dir, speedup.mark, ON);
  yield* setLocalConfigAt(git, dir, speedup.key, ON);
  return null;
});

export const disableSpeedup = Effect.fn('FastStatus.disable')(function* (
  git: Git['Service'],
  dir: string,
  speedup: Speedup,
): Effect.fn.Return<void, GitFailure> {
  const marked = yield* configValueAt(git, dir, speedup.mark, { local: true });
  if (marked === null) return;
  const standing = yield* configValueAt(git, dir, speedup.key, { local: true });
  if (standing?.value === marked.value) {
    yield* setLocalConfigAt(git, dir, speedup.key, null);
    if (speedup === MONITOR && (yield* fsmonitorWatchingAt(git, dir))) yield* stopFsmonitorAt(git, dir);
  }
  yield* setLocalConfigAt(git, dir, speedup.mark, null);
});

const refusalOf =
  (id: string) =>
  (failure: GitFailure): GateRefusal<'git-refused' | 'git-unreadable' | 'git-incomplete'> =>
    new GateRefusal(
      failure._tag === 'GitRefused' ? 'git-refused' : failure._tag === 'GitAnswerInvalid' ? 'git-incomplete' : 'git-unreadable',
      `${id} could not change the repository config: ${troubleOf(failure)}`,
      ["read the repository's config with `git config --list --show-origin` there, and write the key again"],
    );

const keptRefusal = (id: string, kept: KeptValue): GateRefusal<'setting-conflict'> =>
  new GateRefusal('setting-conflict', `${id} writes nothing over a value that stands: ${kept.key}=${kept.value} in ${kept.scope} config`, [
    'leave it off and keep the value that stands',
    `or remove ${kept.key} from the ${kept.scope} config, then turn ${id} on again`,
  ]);

const monitorMissing = (): GateRefusal<'git-refused'> =>
  new GateRefusal('git-refused', `${fsmonitor.id} needs a git build that carries its own file system monitor, and the git here does not`, [
    'leave it off: git status scans the worktree itself',
    'or install a git build with fsmonitor--daemon (the macOS and Windows builds of git carry it), then turn it on again',
  ]);

export const fastStatusLayer: Layer.Layer<never, never, ManagedWrite | GraphStore | Projects | Git> = Layer.effectDiscard(
  Effect.gen(function* () {
    const managed = yield* ManagedWrite;
    const store = yield* GraphStore;
    const projects = yield* Projects;
    const git = yield* Git;
    const register = (key: SettingKey<boolean>, speedup: Speedup, carried: (dir: string) => Effect.Effect<boolean, GitFailure>) =>
      managed.register(key, (input) =>
        Effect.gen(function* () {
          if (input.projectId === null) {
            return yield* new GateRefusal('project-required', `${key.id} is set per project.`, ['name the project it binds']);
          }
          const dir = (yield* projects.byId(input.projectId)).rootPath;
          if (input.resolved) {
            if (!(yield* carried(dir).pipe(Effect.mapError(refusalOf(key.id))))) return yield* monitorMissing();
            const kept = yield* enableSpeedup(git, dir, speedup).pipe(Effect.mapError(refusalOf(key.id)));
            if (kept !== null) return yield* keptRefusal(key.id, kept);
          } else {
            yield* disableSpeedup(git, dir, speedup).pipe(Effect.mapError(refusalOf(key.id)));
          }
          yield* store.transaction(writes('settings', [session, setting]), (unit) => managed.write(unit, input), {
            onCommit: (written) => written.announce,
          });
        }),
      );
    yield* register(untrackedCache, UNTRACKED, () => Effect.succeed(true));
    yield* register(fsmonitor, MONITOR, (dir) => monitorCarried(git, dir, process.platform));
  }),
);
