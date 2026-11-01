import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';

export type MusePlace = { readonly account: string; readonly config: string };

type MuseSettings = {
  readonly system: string;
  readonly toolset: readonly string[];
};

const ELSEWHERE = ['META_API_KEY', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'MUSE_AUTH_PATH'];

const failed = (doing: string) => (cause: { readonly message: string }) =>
  new AgentFault({ code: FAULT.internal, message: `The Muse home could not ${doing}: ${cause.message}` });

const linked = Effect.fnUntraced(function* (target: string, path: string) {
  const files = yield* FileSystem.FileSystem;
  const standing = yield* files.readLink(path).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)));
  if (standing === target) return;
  if (standing !== null) yield* files.remove(path);
  yield* files
    .symlink(target, path)
    .pipe(
      Effect.catchReason('PlatformError', 'AlreadyExists', () =>
        Effect.flatMap(files.readLink(path), (raced) =>
          raced === target ? Effect.void : Effect.fail(new AgentFault({ code: FAULT.internal, message: `${path} links to ${raced}` })),
        ),
      ),
    );
});

export const prepareHome = Effect.fn('muse.prepareHome')(function* (
  place: MusePlace,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
) {
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32')
    return yield* new AgentFault({
      code: FAULT.internal,
      message: `Tagma hosts Muse Code on macOS, Linux and Windows; how its login is reached from a separate home on ${platform} is not established`,
    });
  const user = env.HOME || env.USERPROFILE;
  if (!user)
    return yield* new AgentFault({
      code: FAULT.internal,
      message: 'HOME and USERPROFILE name no home directory, so the Muse login cannot be found',
    });
  const files = yield* FileSystem.FileSystem;
  const userConfig = env.XDG_CONFIG_HOME || join(user, '.config');
  const config = join(place.config, 'muse');
  yield* files.makeDirectory(config, { recursive: true }).pipe(Effect.mapError(failed('make its config directory')));
  yield* linked(join(userConfig, 'muse', 'auth.json'), join(config, 'auth.json')).pipe(Effect.mapError(failed('reach the login')));
  if (platform === 'darwin') {
    yield* files.makeDirectory(join(place.account, 'Library'), { recursive: true }).pipe(Effect.mapError(failed('make its home')));
    yield* linked(join(user, 'Library', 'Keychains'), join(place.account, 'Library', 'Keychains')).pipe(
      Effect.mapError(failed('reach the login keychain')),
    );
  } else yield* files.makeDirectory(place.account, { recursive: true }).pipe(Effect.mapError(failed('make its home')));
  const kept: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) if (!ELSEWHERE.includes(name)) kept[name] = value;
  return {
    ...kept,
    HOME: place.account,
    ...(platform === 'win32' ? { USERPROFILE: place.account } : {}),
    XDG_CONFIG_HOME: place.config,
    XDG_DATA_HOME: join(place.account, '.local', 'share'),
    XDG_STATE_HOME: join(place.account, '.local', 'state'),
    XDG_CACHE_HOME: join(place.account, '.cache'),
  };
});

const settingsOf = (settings: MuseSettings) => ({
  schema_version: 1,
  context_compaction: { soft_threshold: 0.97, hard_threshold: 0.99 },
  run: {
    system_prompt: settings.system,
    toolset: settings.toolset,
    reminder_roster: [],
    workflow_trigger_mode: 'off',
    context_slimming: {
      meta_context_note_enabled: false,
      session_identity_enabled: false,
      skill_catalog_descriptions: 'first_sentence',
    },
  },
});

const replaced = Effect.fnUntraced(function* (path: string, text: string, doing: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.writeFileString(`${path}.next`, text).pipe(Effect.mapError(failed(doing)));
  yield* files.rename(`${path}.next`, path).pipe(Effect.mapError(failed(doing)));
});

type SessionState = 'priced' | 'compaction';

const statePath = (place: MusePlace, session: string, state: SessionState) => join(place.config, `${session}.${state}`);

export const keepState = Effect.fn('muse.keepState')(function* (place: MusePlace, session: string, state: SessionState, text: string) {
  yield* replaced(statePath(place, session, state), text, `keep the ${state} state of ${session}`);
});

export const keptState = Effect.fn('muse.keptState')(function* (place: MusePlace, session: string, state: SessionState) {
  const files = yield* FileSystem.FileSystem;
  return yield* files.readFileString(statePath(place, session, state)).pipe(
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
    Effect.mapError(failed(`read the ${state} state of ${session}`)),
  );
});

export const keepPriced = (place: MusePlace, session: string, usd: number) => keepState(place, session, 'priced', String(usd));

export const keptPriced = Effect.fn('muse.keptPriced')(function* (place: MusePlace, session: string) {
  const text = (yield* keptState(place, session, 'priced'))?.trim() ?? '';
  const usd = text === '' ? Number.NaN : Number(text);
  return Number.isFinite(usd) ? usd : null;
});

export const writeSettings = Effect.fn('muse.writeSettings')(function* (place: MusePlace, settings: MuseSettings) {
  yield* replaced(join(place.config, 'muse', 'settings.json'), JSON.stringify(settingsOf(settings)), 'write its settings');
});
