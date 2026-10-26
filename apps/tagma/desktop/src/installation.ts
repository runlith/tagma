import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Schema } from 'effect';
import { currentVersion } from '@tagma/server/installation/closure/versions';
import {
  CLI_ENTRY,
  DATABASE_FILE,
  INSTALL_FILE,
  RUNTIME_PART,
  SERVE_FLAGS,
  TRANSFER_FILE,
  dataDirectory,
} from '@tagma/server/installation/contract/wire/layout';
import { CHANNEL } from '@tagma/server/composition/channel';
import { CHANNELS, type Channel } from '@tagma/server/installation/contract/wire/channel';
import { holderName, junctionDirectory, readActive } from '@tagma/server/installation/contract/wire/junction';
import type { MachineState } from '@tagma/server/installation/contract/wire/machine';
import { type Closure, closureIn, type Refusal, runCli, verbRefusal } from './server.js';

export type Holder = {
  readonly name: string;
  readonly pid: number;
  readonly url: string;
  readonly agents: number | null;
  readonly terminals: number | null;
};

export type Planned = { readonly closure: Closure } | { readonly missing: string; readonly unreadable: boolean };

export type InstallAnswer =
  | { readonly status: 'landed' }
  | { readonly status: 'ask'; readonly reason: string; readonly said: string }
  | { readonly status: 'refused'; readonly refusal: Refusal };

const decodeAnswer = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ status: Schema.Literal('landed') }),
      Schema.Struct({ status: Schema.Literal('ask'), reason: Schema.String, said: Schema.String }),
    ]),
  ),
);

export async function closureOf(installRoot: string): Promise<Planned> {
  const version = currentVersion(installRoot);
  if (version === null) return { missing: `${installRoot} names no current release`, unreadable: false };
  const root = join(installRoot, version);
  for (const part of [INSTALL_FILE, RUNTIME_PART, CLI_ENTRY]) {
    const at = join(root, part);
    try {
      if (!(await stat(at)).isFile()) return { missing: `${root} holds no ${part}`, unreadable: false };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return { missing: `${root} holds no ${part}`, unreadable: false };
      return { missing: `${at} could not be read: ${code ?? 'it would not stat'}`, unreadable: true };
    }
  }
  return { closure: closureIn(root) };
}

export async function installFrom(carried: string, log: string, agreed: boolean, env: NodeJS.ProcessEnv): Promise<InstallAnswer> {
  const args = ['install-from', '--json', ...(agreed ? ['--agreed'] : []), carried];
  const ran = await runCli(closureIn(carried), args, log, env);
  const read = ran.code === 0 ? decodeAnswer(ran.out.trim()) : null;
  if (read !== null && read._tag === 'Success') return read.success;
  return { status: 'refused', refusal: verbRefusal('install-from', ran) };
}

export const transferable = (env: NodeJS.ProcessEnv): Channel | null => {
  const own = dataDirectory(CHANNEL, env);
  if (own === null || (existsSync(join(own, DATABASE_FILE)) && !existsSync(join(own, TRANSFER_FILE)))) return null;
  return (
    Object.values(CHANNELS).find((other) => {
      const at = dataDirectory(other, env);
      return other.id !== CHANNEL.id && at !== null && at !== own && existsSync(join(at, DATABASE_FILE));
    }) ?? null
  );
};

const settledBy = async (
  closure: Closure,
  args: readonly string[],
  log: string,
  env: NodeJS.ProcessEnv,
  verb: string,
): Promise<string | null> => {
  await mkdir(dirname(log), { recursive: true });
  const file = await open(log, 'a');
  try {
    const child = spawn(closure.runtime, [...SERVE_FLAGS, closure.entry, ...args], {
      cwd: closure.root,
      env,
      stdio: ['ignore', file.fd, file.fd],
    });
    return await new Promise<string | null>((settled) => {
      child.on('error', (error) => settled(`${closure.runtime} did not start: ${error.message}`));
      child.on('exit', (code, signal) =>
        settled(code === 0 ? null : signal !== null ? `${verb} ended on ${signal}` : `${verb} exited ${code}`),
      );
    });
  } finally {
    await file.close();
  }
};

export const transferFrom = (closure: Closure, from: Channel, log: string, env: NodeJS.ProcessEnv): Promise<string | null> =>
  settledBy(closure, ['transfer', '--from', from.id], log, env, 'transfer');

export const switchOver = (closure: Closure, log: string, env: NodeJS.ProcessEnv): Promise<string | null> =>
  settledBy(closure, ['switch', '--no-start'], log, env, 'switch');

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const occupancy = async (url: string): Promise<{ readonly agents: number | null; readonly terminals: number | null }> => {
  const answer = await fetch(new URL('/api/op/read_machine_state', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  const read = answer !== null && answer.ok ? ((await answer.json().catch(() => null)) as { machine?: MachineState } | null) : null;
  const machine = read?.machine;
  return { agents: machine?.server.agents ?? null, terminals: machine?.host.holds?.terminals ?? null };
};

export async function activeElsewhere(env: NodeJS.ProcessEnv): Promise<Holder | null> {
  const junction = junctionDirectory(env);
  const holder = junction === null ? null : readActive(junction);
  if (holder === null || holder.channel === CHANNEL.id || !alive(holder.pid)) return null;
  return { name: holderName(holder), pid: holder.pid, url: holder.url, ...(await occupancy(holder.url)) };
}
