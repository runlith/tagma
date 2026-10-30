import { Data, Effect, FileSystem, type PlatformError } from 'effect';
import { accessSync, constants, readFileSync, readlinkSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { CLI_ENTRY, RUNTIME_PART, SERVE_FLAGS, WORLD, WORLD_COMMAND } from '../contract/wire/layout.js';
import type { InstallationPlatform } from '../contract/wire/manifest.js';
import { INSTALLATION_MODE } from '../contract/wire/junction.js';
import { PORT_VARIABLES } from '../contract/wire/ports.js';

export class LauncherWriteFailed extends Data.TaggedError('LauncherWriteFailed')<{ readonly path: string; readonly detail: string }> {}

export type LauncherReach =
  | { readonly _tag: 'Beside' }
  | { readonly _tag: 'Reached' }
  | { readonly _tag: 'Profiled'; readonly profile: string; readonly shadow: string | null }
  | { readonly _tag: 'Unprofiled'; readonly profile: string; readonly detail: string; readonly shadow: string | null };

export type LauncherWritten = {
  readonly path: string;
  readonly reach: LauncherReach;
};

const profileMark = (command: string): string => `# ${command}: the installed ${command} comes first`;

const profileFor = (shell: string, home: string, platform: string): { readonly path: string; readonly line: (bin: string) => string } => {
  const name = shell.split('/').pop() ?? '';
  if (name === 'zsh') return { path: `${home}/.zshrc`, line: exportLine };
  if (name === 'bash') return { path: `${home}/${platform === 'darwin' ? '.bash_profile' : '.bashrc'}`, line: exportLine };
  if (name === 'fish') return { path: `${home}/.config/fish/config.fish`, line: (bin) => `fish_add_path --prepend --move ${bin}` };
  return { path: `${home}/.profile`, line: exportLine };
};

const exportLine = (bin: string): string => `export PATH="${bin}:$PATH"`;

const spelledFor = (bin: string, home: string): string =>
  bin === home ? '$HOME' : bin.startsWith(`${home}/`) ? `$HOME${bin.slice(home.length)}` : bin;

const quoted = (value: string): string => `'${value.split("'").join(`'\\''`)}'`;

export const launcherText = (root: string, platform: InstallationPlatform, env: Readonly<Record<string, string>> = {}): string =>
  `#!/bin/sh
# The installed tagma. Written by the build; every line of it names the closure that stands.
set -eu
${Object.entries(env)
  .map(([name, value]) => `export ${name}=${quoted(value)}`)
  .join('\n')}${Object.keys(env).length === 0 ? '' : '\n'}root=${quoted(root)}
current="$root/current"
if [ ! -d "$current" ]; then
  echo "tagma: nothing is installed at $current; install Tagma again to put one there" >&2
  exit 1
fi
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; then arch=arm64; fi
if [ "$arch" = x86_64 ]; then arch=x64; fi
if [ "$os" != ${quoted(platform.os)} ] || [ "$arch" != ${quoted(platform.arch)} ]; then
  echo "tagma: this installation was built for ${platform.os}/${platform.arch} and this machine is $os/$arch; install the one built for this machine" >&2
  exit 1
fi
exec "$current/${RUNTIME_PART}" ${SERVE_FLAGS.join(' ')} "$current/${CLI_ENTRY}" "$@"
`;

const reached = (path: string, env: NodeJS.ProcessEnv): { readonly onPath: boolean; readonly shadow: string | null } => {
  const stands = resolve(dirname(path));
  const command = basename(path);
  let onPath = false;
  for (const entry of (env.PATH ?? '').split(':')) {
    if (entry === '') continue;
    const here = resolve(entry);
    if (here === stands) {
      onPath = true;
      break;
    }
    const candidate = `${here}/${command}`;
    if (executable(candidate)) return { onPath: false, shadow: pointed(candidate) };
  }
  return { onPath, shadow: null };
};

export const worldDirectory = (installs: string): string => `${dirname(installs)}/${WORLD}`;

export const runningWorld = (runsFromRoot: string | undefined, envInstallRoot: string): string =>
  worldDirectory(runsFromRoot === undefined ? envInstallRoot : dirname(runsFromRoot));

export const ensuredPath = (pathValue: string, world: string): string | null => {
  if (!executable(`${world}/${WORLD_COMMAND}`)) return null;
  const stands = resolve(world);
  const isWorld = (entry: string): boolean => entry.startsWith('/') && resolve(entry) === stands;
  const entries = pathValue.split(':');
  if (isWorld(entries[0] ?? '')) return null;
  return [stands, ...entries.filter((entry) => !isWorld(entry))].join(':');
};

const executable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const pointed = (path: string): string => {
  try {
    const target = readlinkSync(path);
    return `${path} → ${resolve(dirname(path), target)}`;
  } catch {
    return path;
  }
};

const profileOf = (
  launcher: string,
  env: NodeJS.ProcessEnv,
  os: string,
): { readonly path: string; readonly mark: string; readonly wanted: string } => {
  const home = env.HOME ?? '';
  const { path, line } = profileFor(env.SHELL ?? '', home, os);
  return { path, mark: profileMark(basename(launcher)), wanted: line(spelledFor(dirname(launcher), home)) };
};

const carries = (lines: readonly string[], mark: string, wanted: string): boolean => {
  const at = lines.indexOf(mark);
  return at !== -1 && lines[at + 1] === wanted;
};

const profiled = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  launcher: string,
  env: NodeJS.ProcessEnv,
  os: string,
): Effect.fn.Return<{ readonly profile: string; readonly detail: string | null }, LauncherWriteFailed> {
  const { path, mark, wanted } = profileOf(launcher, env, os);
  const read = yield* Effect.result(files.readFileString(path));
  if (read._tag === 'Failure' && read.failure.reason._tag !== 'NotFound') {
    return yield* Effect.fail(new LauncherWriteFailed({ path, detail: `${path} could not be read: ${read.failure.reason._tag}` }));
  }
  const standing = read._tag === 'Success' ? read.success : '';
  const lines = standing.split('\n');
  const at = lines.indexOf(mark);
  if (carries(lines, mark, wanted)) return { profile: path, detail: null };
  const text =
    at === -1
      ? `${standing}${standing.length === 0 || standing.endsWith('\n') ? '' : '\n'}\n${mark}\n${wanted}\n`
      : [...lines.slice(0, at + 1), wanted, ...lines.slice(at + 2)].join('\n');
  const wrote = yield* files
    .makeDirectory(dirname(path), { recursive: true })
    .pipe(Effect.andThen(files.writeFileString(path, text)), Effect.result);
  return { profile: path, detail: wrote._tag === 'Success' ? null : wrote.failure.reason._tag };
});

export const launcherStands = (path: string, env: NodeJS.ProcessEnv, os: string): boolean => {
  if (!executable(path)) return false;
  const { onPath, shadow } = reached(path, env);
  if (onPath && shadow === null) return true;
  const { path: profile, mark, wanted } = profileOf(path, env, os);
  try {
    return carries(readFileSync(profile, 'utf8').split('\n'), mark, wanted);
  } catch {
    return false;
  }
};

export const reachLine = (written: LauncherWritten): string => {
  const reach = written.reach;
  if (reach._tag === 'Beside') return `${written.path} is bound to the beside installation; the shell profile is unchanged`;
  if (reach._tag === 'Reached') return `${written.path} is on PATH already`;
  if (reach._tag === 'Profiled')
    return `${dirname(written.path)} goes first on PATH from ${reach.profile}; a new shell finds ${basename(written.path)}${reach.shadow === null ? '' : ` before ${reach.shadow}`}`;
  return `${reach.profile} could not be written (${reach.detail}); add ${dirname(written.path)} to PATH yourself`;
};

export const writeLauncherBeside = Effect.fnUntraced(function* (
  root: string,
  path: string,
  platform: InstallationPlatform,
  env: Readonly<Record<string, string>> = {},
): Effect.fn.Return<string, LauncherWriteFailed, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  const directory = dirname(path);
  const world = worldDirectory(root);
  const alias = `${world}/${WORLD_COMMAND}`;
  const refuse = (detail: string) => Effect.fail(new LauncherWriteFailed({ path, detail }));
  const failed = (error: PlatformError.PlatformError) => refuse(error.reason._tag);
  yield* files
    .makeDirectory(directory, { recursive: true })
    .pipe(Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) => refuse(`${directory}: ${error.reason._tag}`)));
  yield* files.writeFileString(path, launcherText(root, platform, env), { mode: 0o700 }).pipe(Effect.catchTag('PlatformError', failed));
  yield* files.chmod(path, 0o700).pipe(Effect.catchTag('PlatformError', failed));
  yield* files.makeDirectory(world, { recursive: true }).pipe(
    Effect.andThen(files.remove(alias, { force: true })),
    Effect.andThen(files.symlink(relative(world, path), alias)),
    Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) => refuse(`${alias}: ${error.reason._tag}`)),
  );
  return path;
});

export const writeLauncher = Effect.fnUntraced(function* (
  root: string,
  path: string,
  platform: InstallationPlatform,
  env: NodeJS.ProcessEnv,
): Effect.fn.Return<LauncherWritten, LauncherWriteFailed, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  const beside = env[INSTALLATION_MODE] === 'beside';
  const bindings: Record<string, string> = {};
  if (beside) {
    for (const name of [INSTALLATION_MODE, 'TAGMA_DATABASE_PATH', 'TAGMA_INSTALL_ROOT', ...Object.values(PORT_VARIABLES)]) {
      const value = env[name];
      if (value !== undefined) bindings[name] = value;
    }
  }
  yield* writeLauncherBeside(root, path, platform, bindings);
  if (beside) return { path, reach: { _tag: 'Beside' } };
  const { onPath, shadow } = reached(path, env);
  if (onPath && shadow === null) return { path, reach: { _tag: 'Reached' } };
  const written = yield* profiled(files, path, env, platform.os);
  return {
    path,
    reach:
      written.detail === null
        ? { _tag: 'Profiled', profile: written.profile, shadow }
        : { _tag: 'Unprofiled', profile: written.profile, detail: written.detail, shadow },
  };
});
