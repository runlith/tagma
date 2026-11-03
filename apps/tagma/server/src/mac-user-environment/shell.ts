import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { ProfileAnswer, ProfileAsk, UserShell } from '../installation/contract/service/userEnvironment.js';

const SYSTEM_PATHS = new Set(['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/System/Cryptexes/App/usr/bin']);
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const OUTPUT_BYTES = 1024 * 1024;
const ALIAS_HOPS = 8;
const PROBE = 'TAGMA_SHELL_PATH_PROBE';

const directories = (dirs: readonly string[]): readonly string[] =>
  dirs.filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });

type Version = { readonly name: string; readonly parts: readonly number[] };

const versionOf = (name: string): Version | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(name);
  return match === null ? null : { name, parts: [Number(match[1]), Number(match[2]), Number(match[3])] };
};

const newestFirst = (left: Version, right: Version): number => {
  for (let at = 0; at < 3; at += 1) {
    const step = right.parts[at]! - left.parts[at]!;
    if (step !== 0) return step;
  }
  return 0;
};

const nvmVersions = (home: string): readonly Version[] => {
  const root = join(home, '.nvm', 'versions', 'node');
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root)
      .flatMap((name) => {
        const version = versionOf(name);
        return version === null ? [] : [version];
      })
      .sort(newestFirst);
  } catch {
    return [];
  }
};

const nvmDefault = (home: string, installed: readonly Version[]): Version | null => {
  const aliases = join(home, '.nvm', 'alias');
  let wanted = 'default';
  const seen = new Set<string>();
  for (let hop = 0; hop < ALIAS_HOPS; hop += 1) {
    const file = join(aliases, wanted);
    if (seen.has(wanted) || !existsSync(file)) break;
    seen.add(wanted);
    try {
      wanted = readFileSync(file, 'utf8').trim();
    } catch {
      return null;
    }
  }
  if (wanted === 'system' || wanted.length === 0) return null;
  if (wanted === 'node' || wanted === 'stable') return installed[0] ?? null;
  const prefix = wanted.replace(/^v/u, '').split('.');
  return installed.find((version) => prefix.every((part, at) => String(version.parts[at]) === part)) ?? null;
};

const nvmBin = (home: string, version: Version): string => join(home, '.nvm', 'versions', 'node', version.name, 'bin');

const managers = (home: string): readonly string[] => {
  const installed = nvmVersions(home);
  const chosen = nvmDefault(home, installed);
  return directories([
    ...(chosen === null ? [] : [nvmBin(home, chosen)]),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin'),
    join(home, '.fnm', 'aliases', 'default', 'bin'),
    join(home, '.local', 'share', 'mise', 'shims'),
    join(home, '.bun', 'bin'),
  ]);
};

const fallback = (home: string): readonly string[] =>
  directories([
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/nix/var/nix/profiles/default/bin',
    join(home, '.nix-profile', 'bin'),
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, 'Library', 'pnpm'),
    join(home, '.yarn', 'bin'),
  ]);

const runtimes = (home: string): readonly string[] => directories(nvmVersions(home).map((version) => nvmBin(home, version)));

export const profileEntries = (path: string, home: string): readonly string[] =>
  path
    .split(':')
    .map((entry) => (entry.startsWith('~/') ? join(home, entry.slice(2)) : entry))
    .filter((entry) => entry.startsWith('/') && !entry.includes('$'));

const environmentOf = (output: string): Readonly<Record<string, string>> => {
  const variables: Record<string, string> = {};
  for (const entry of output.split('\0')) {
    const at = entry.indexOf('=');
    if (at > 0) variables[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return variables;
};

const loginShell = (named: string | null): string | null => {
  if (named !== null) return named;
  try {
    return userInfo().shell ?? null;
  } catch {
    return null;
  }
};

const groupExited = async (pid: number): Promise<void> => {
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return;
      if (code !== 'EPERM') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const read = ({ shell, launchPath, home, deadlineMs }: ProfileAsk): Promise<ProfileAnswer> => {
  const program = loginShell(shell);
  if (program === null) return Promise.resolve({ outcome: 'no-shell', entries: [], detail: 'the user directory names no login shell' });
  return new Promise((answer, refuse) => {
    const child = spawn(program, ['-i', '-l', '-c', "/usr/bin/printf '\\0'; /usr/bin/env -0"], {
      env: { ...process.env, HOME: home, PATH: launchPath.trim() || SYSTEM_PATH, [PROBE]: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stopped: 'timeout' | 'buffer limit' | undefined;
    const stop = (condition: 'timeout' | 'buffer limit') => {
      stopped ??= condition;
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    const timeout = setTimeout(() => stop('timeout'), deadlineMs);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > OUTPUT_BYTES) stop('buffer limit');
      else chunks.push(chunk);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      answer({ outcome: 'spawn-failed', entries: [], detail: `${program}: ${error.code ?? 'spawn failed'}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const finish = async (): Promise<ProfileAnswer> => {
        if (stopped !== undefined && child.pid !== undefined) await groupExited(child.pid);
        if (stopped === 'timeout') {
          return { outcome: 'timeout', entries: [], detail: `${program} did not answer in ${deadlineMs} ms` };
        }
        if (stopped !== undefined || code !== 0) {
          return {
            outcome: 'exit',
            entries: [],
            detail: `${program}: ${stopped ?? (signal === null ? `exit ${code}` : `signal ${signal}`)}`,
          };
        }
        const environment = environmentOf(Buffer.concat(chunks).toString('utf8'));
        const path = environment.PATH;
        const entries = path === undefined ? [] : profileEntries(path, home);
        return entries.length === 0
          ? { outcome: 'empty', entries: [], detail: `${program} printed no usable PATH` }
          : { outcome: 'read', entries, detail: null, environment };
      };
      void finish().then(answer, refuse);
    });
  });
};

export const macUserShell: UserShell = {
  desktopLaunch: (launchPath) => launchPath.split(':').every((entry) => entry.length === 0 || SYSTEM_PATHS.has(entry)),
  managers,
  fallback,
  runtimes,
  read,
};
