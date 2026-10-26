import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { Effect, Option, Schema } from 'effect';
import {
  LAUNCH_PATH,
  PROFILE_PATHS,
  type ProfileRead,
  UserEnvironment,
  type UserPaths,
  type UserShell,
} from '../contract/service/userEnvironment.js';
import { ensuredPath } from '../setup/launcher.js';

const READ_DEADLINE_MS = 10_000;
const CANDIDATES = 4;

const handedProfile = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      outcome: Schema.Literals(['read', 'timeout', 'exit', 'spawn-failed', 'empty', 'no-shell']),
      entries: Schema.Array(Schema.String),
      detail: Schema.NullOr(Schema.String),
    }),
  ),
);

export type EnvironmentInput = {
  readonly shell: UserShell | null;
  readonly env: NodeJS.ProcessEnv;
  readonly world: string | null;
  readonly home: string | null;
  readonly deadlineMs?: number;
  readonly told?: (line: string) => void;
};

const entriesOf = (path: string | undefined): readonly string[] => (path ?? '').split(':').filter((entry) => entry.length > 0);

export const assembledPath = (parts: readonly (readonly string[])[]): string => {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    for (const entry of part) {
      if (!isAbsolute(entry)) continue;
      const key = resolve(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(entry);
    }
  }
  return kept.join(':');
};

const executableFile = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const realOf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export const locatedIn = (name: string, dirs: readonly string[]): readonly string[] => {
  if (isAbsolute(name)) return executableFile(name) ? [name] : [];
  const seen = new Set<string>();
  const found: string[] = [];
  for (const dir of dirs) {
    if (found.length === CANDIDATES) break;
    if (!isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    if (!executableFile(candidate)) continue;
    const real = realOf(candidate);
    if (seen.has(real)) continue;
    seen.add(real);
    found.push(candidate);
  }
  return found;
};

export const makeUserEnvironment = ({ shell, env, world, home, deadlineMs = READ_DEADLINE_MS, told }: EnvironmentInput) => {
  const launchPath = env[LAUNCH_PATH] ?? env.PATH ?? '';
  const inherited = Option.getOrNull(handedProfile(env[PROFILE_PATHS]));
  delete env[LAUNCH_PATH];
  delete env[PROFILE_PATHS];
  const desktop = shell !== null && home !== null && shell.desktopLaunch(launchPath);
  let profile: ProfileRead | null = desktop ? inherited : { outcome: 'not-needed', entries: [], detail: null };
  let reading: Promise<UserPaths> | null = null;

  const build = (): string => {
    const assembled =
      desktop && shell !== null && home !== null
        ? assembledPath([profile?.entries ?? [], shell.managers(home), entriesOf(launchPath), shell.fallback(home)])
        : launchPath;
    return world === null ? assembled : (ensuredPath(assembled, world) ?? assembled);
  };
  const current = (): UserPaths => ({ path: env.PATH ?? '', profile, reading: reading !== null });
  env.PATH = build();

  const read = (): Promise<UserPaths> => {
    if (reading !== null) return reading;
    if (!desktop || shell === null || home === null) return Promise.resolve(current());
    const kept = profile?.entries ?? [];
    const settle = (answer: ProfileRead): UserPaths => {
      profile = answer.outcome === 'read' ? answer : { ...answer, entries: kept };
      env.PATH = build();
      reading = null;
      told?.(
        answer.outcome === 'read'
          ? `the login profile named ${answer.entries.length} PATH entries`
          : `the login profile was not read (${answer.outcome}${answer.detail === null ? '' : `: ${answer.detail}`}); user commands are searched without it`,
      );
      return current();
    };
    const started = shell
      .read({ shell: env.SHELL?.trim() || null, launchPath, home, deadlineMs })
      .then(settle, (cause: unknown) => settle({ outcome: 'spawn-failed', entries: [], detail: String(cause) }));
    reading = started;
    return started;
  };
  if (desktop && profile?.outcome !== 'read') void read();

  return UserEnvironment.of({
    ready: Effect.promise(() => reading ?? Promise.resolve(current())),
    now: Effect.sync(current),
    refresh: Effect.promise(read).pipe(Effect.withSpan('UserEnvironment.refresh')),
    locate: (name, dirs) =>
      Effect.sync(() =>
        locatedIn(name, [...entriesOf(env.PATH), ...(shell !== null && home !== null ? shell.runtimes(home) : []), ...dirs]),
      ),
    handoff: () => ({
      [LAUNCH_PATH]: launchPath,
      ...(profile === null || profile.outcome === 'not-needed' ? {} : { [PROFILE_PATHS]: JSON.stringify(profile) }),
    }),
  });
};
