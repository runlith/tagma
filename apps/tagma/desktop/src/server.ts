import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { appendFile, mkdir, open } from 'node:fs/promises';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import { type Handover, RESTART_RECORD, type Startup } from '@tagma/server/installation/contract/wire/restart';
import { readHandover, readStartup } from '@tagma/server/installation/process/record';
import { CLI_ENTRY, DESKTOP_PID_ENV, RUNTIME_PART, SERVE_FLAGS } from '@tagma/server/installation/contract/wire/layout';
import { stalledSchema, unreadyHealthSchema } from '@tagma/server/http/contract/wire/health';
import { LOCK_FILE } from '@tagma/server/platform/contract/wire/lock';
import type { Bearing } from './release.js';

export type Closure = {
  readonly root: string;
  readonly runtime: string;
  readonly entry: string;
};

export const closureIn = (root: string): Closure => ({ root, runtime: join(root, RUNTIME_PART), entry: join(root, CLI_ENTRY) });

export type Stalled = typeof stalledSchema.Type;

export type Reached =
  | { readonly at: 'silent' }
  | { readonly at: 'starting'; readonly startup: Startup | null }
  | { readonly at: 'ours'; readonly installation: Bearing | null; readonly stalled: Stalled | null }
  | { readonly at: 'foreign' };

export type Refusal = { readonly code: string; readonly reason: string; readonly said: string | null };

const bearing = Schema.Struct({ build: Schema.String, digest: Schema.String });
const decodeHealth = Schema.decodeUnknownResult(
  Schema.Struct({
    ok: Schema.Literal(true),
    database: Schema.String,
    source: Schema.Struct({ installation: Schema.NullOr(bearing) }),
    stalled: Schema.optionalKey(Schema.NullOr(stalledSchema)),
  }),
);
const decodeUnready = Schema.decodeUnknownResult(unreadyHealthSchema);
const refusalShape = Schema.Struct({
  code: Schema.String,
  reason: Schema.String,
  words: Schema.optional(Schema.Struct({ text: Schema.String })),
});
const decodeRefusal = Schema.decodeUnknownResult(refusalShape);
const decodeDevSurface = Schema.decodeUnknownResult(Schema.Struct({ url: Schema.String, started: Schema.Boolean }));
const decodeRefusalText = Schema.decodeUnknownResult(Schema.fromJsonString(refusalShape));
const decodeMachine = Schema.decodeUnknownResult(
  Schema.Struct({
    machine: Schema.Struct({
      server: Schema.Struct({
        agents: Schema.Int,
        calls: Schema.optional(Schema.Int),
        next: Schema.Struct({ installing: Schema.NullOr(Schema.Unknown) }),
      }),
      host: Schema.Struct({ holds: Schema.NullOr(Schema.Struct({ terminals: Schema.Int, commands: Schema.Int })) }),
      restart: Schema.Struct({ stage: Schema.NullOr(Schema.String) }),
      newHost: Schema.optional(Schema.Struct({ cause: Schema.String, build: Schema.NullOr(Schema.String) })),
    }),
  }),
);

const HANDING_OVER = new Set(['accepted', 'prepared', 'transferred']);

const sameDirectory = (one: string, other: string): boolean => {
  if (resolve(one) === resolve(other)) return true;
  const real = (path: string): string | null => {
    try {
      return realpathSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const [a, b] = [real(one), real(other)];
  return a !== null && a === b;
};

const refusalOf = (read: ReturnType<typeof decodeRefusal>, fallback: string): Refusal =>
  read._tag === 'Failure'
    ? { code: 'unreadable', reason: fallback, said: null }
    : { code: read.success.code, reason: read.success.reason, said: read.success.words?.text ?? null };

export async function reach(surfaceUrl: URL, data: string): Promise<Reached> {
  const answer = await fetch(new URL('/health', surfaceUrl)).catch(() => null);
  if (answer === null) return { at: 'silent' };
  const body: unknown = await answer.json().catch(() => null);
  if (answer.status === 503) {
    const unready = decodeUnready(body);
    return unready._tag === 'Success' ? { at: 'starting', startup: unready.success.startup } : { at: 'foreign' };
  }
  const health = decodeHealth(body);
  if (!answer.ok || health._tag === 'Failure') return { at: 'foreign' };
  return sameDirectory(dirname(health.success.database), data)
    ? { at: 'ours', installation: health.success.source.installation, stalled: health.success.stalled ?? null }
    : { at: 'foreign' };
}

export async function endStalled(stalled: Stalled, log: string): Promise<void> {
  const said = `[tagma-desktop] pid ${stalled.pid} stopped answering: the writer of ${stalled.database} has been held${stalled.heldFor === null ? '' : ` by ${stalled.heldFor}`} for ${Math.round(stalled.heldMs / 1000)}s, ${Math.round(stalled.quietMs / 1000)}s of it with nothing running in SQLite, and ${stalled.waiting} writer(s) wait on it; the window ends it with SIGKILL and starts Tagma again\n`;
  await mkdir(dirname(log), { recursive: true });
  await appendFile(log, said).catch((error: unknown) =>
    console.warn(`[tagma-desktop] ${log} did not take the line: ${String(error)}\n${said}`),
  );
  try {
    process.kill(stalled.pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export async function startupLeft(data: string): Promise<Startup | null> {
  return (await Effect.runPromise(readStartup(join(data, RESTART_RECORD)))).startup;
}

export const handover = (data: string): Promise<Handover | null> => Effect.runPromise(readHandover(join(data, RESTART_RECORD)));

const LOCK_PROBE = `const { dlopen } = require('bun:ffi');
const libc = dlopen('libc.dylib', { flock: { args: ['i32', 'i32'], returns: 'i32' } });
let held;
try { held = require('node:fs').openSync(process.env.TAGMA_PROBED, 'r'); } catch (error) { process.exit(error.code === 'ENOENT' ? 0 : 2); }
process.exit(libc.symbols.flock(held, 6) === 0 ? 0 : 1);`;

const locked = (runtime: string, data: string, env: NodeJS.ProcessEnv): Promise<boolean> =>
  new Promise((answered, refused) => {
    const probe = spawn(runtime, ['-e', LOCK_PROBE], { env: { ...env, TAGMA_PROBED: join(data, LOCK_FILE) }, stdio: 'ignore' });
    probe.on('error', refused);
    probe.on('exit', (code, signal) =>
      code === 0 || code === 1
        ? answered(code === 1)
        : refused(
            new Error(`the lock of ${data} could not be read: the probe ${signal === null ? `exited ${code}` : `ended on ${signal}`}`),
          ),
    );
  });

export const dataHeld = async (runtime: string, data: string, env: NodeJS.ProcessEnv): Promise<boolean> =>
  (await locked(runtime, data, env)) || (await handover(data))?.underway === true;

export type ServerHandle = {
  readonly ended: () => string | null;
  readonly exited: Promise<string>;
};

export async function startServer(closure: Closure, log: string, env: NodeJS.ProcessEnv): Promise<ServerHandle> {
  await mkdir(dirname(log), { recursive: true });
  const file = await open(log, 'a');
  try {
    const child = spawn(closure.runtime, [...SERVE_FLAGS, closure.entry, 'serve'], {
      cwd: closure.root,
      env: { ...env, [DESKTOP_PID_ENV]: String(process.pid) },
      detached: true,
      stdio: ['ignore', file.fd, file.fd],
    });
    let ended: string | null = null;
    const exited = Promise.withResolvers<string>();
    child.on('error', (error) => {
      ended ??= `${closure.runtime} did not start: ${error.message}`;
      exited.resolve(ended);
      void appendFile(log, `[tagma-desktop] ${ended}\n`).catch(() => undefined);
    });
    child.on('exit', (code, signal) => {
      ended ??= signal !== null ? `left on ${signal}` : `left with ${code ?? 0}`;
      exited.resolve(ended);
    });
    child.unref();
    return { ended: () => ended, exited: exited.promise };
  } finally {
    await file.close();
  }
}

export type Work = {
  readonly agents: number;
  readonly terminals: number | null;
  readonly commands: number | null;
  readonly calls: number | null;
  readonly busy: boolean;
  readonly needsHost: string | null;
};

const some = (count: number | null): boolean => count === null || count > 0;

export const working = (work: Work): boolean =>
  work.busy || work.agents > 0 || some(work.terminals) || some(work.commands) || some(work.calls);

export async function machineWork(surfaceUrl: URL): Promise<Work | null> {
  const answer = await fetch(new URL('/api/op/read_machine_state', surfaceUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  if (answer === null || !answer.ok) return null;
  const read = decodeMachine(await answer.json().catch(() => null));
  if (read._tag === 'Failure') return null;
  const { server, host, restart, newHost } = read.success.machine;
  return {
    agents: server.agents,
    terminals: host.holds?.terminals ?? null,
    commands: host.holds?.commands ?? null,
    calls: server.calls ?? null,
    busy: server.next.installing !== null || (restart.stage !== null && HANDING_OVER.has(restart.stage)),
    needsHost: newHost?.cause === 'update' ? newHost.build : null,
  };
}

export async function askRestart(surfaceUrl: URL): Promise<Refusal | null> {
  const answer = await fetch(new URL('/api/op/restart_server', surfaceUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (answer instanceof Error) return { code: 'unanswered', reason: `the restart was not answered: ${answer.message}`, said: null };
  const body: unknown = await answer.json().catch(() => null);
  if (answer.ok && (body as { status?: unknown } | null)?.status === 'restarting') return null;
  return refusalOf(decodeRefusal(body), `the restart answered ${answer.status}`);
}

type Answered = { readonly status: number; readonly body: unknown };

const posted = (url: URL): Promise<Answered | Error> =>
  new Promise((settle) => {
    const asked = request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (answer) => {
      let text = '';
      answer.setEncoding('utf8');
      answer.on('data', (chunk: string) => (text += chunk));
      answer.on('error', settle);
      answer.on('end', () => {
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {}
        settle({ status: answer.statusCode ?? 0, body });
      });
    });
    asked.on('error', settle);
    asked.end('{}');
  });

export async function startDevSurface(surfaceUrl: URL): Promise<URL | Refusal> {
  const answer = await posted(new URL('/api/op/start_dev_surface', surfaceUrl));
  if (answer instanceof Error) return { code: 'unanswered', reason: `the dev surface was not answered: ${answer.message}`, said: null };
  const started = decodeDevSurface(answer.body);
  if (answer.status === 200 && started._tag === 'Success' && URL.canParse(started.success.url)) return new URL(started.success.url);
  return refusalOf(decodeRefusal(answer.body), `the dev surface answered ${answer.status}`);
}

export type Ran = { readonly code: number | null; readonly out: string };

export const runCli = async (closure: Closure, args: readonly string[], log: string, env: NodeJS.ProcessEnv): Promise<Ran> => {
  await mkdir(dirname(log), { recursive: true });
  const file = await open(log, 'a');
  try {
    const child = spawn(closure.runtime, [...SERVE_FLAGS, closure.entry, ...args], {
      cwd: closure.root,
      env,
      stdio: ['ignore', 'pipe', file.fd],
    });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    return await new Promise((settled) => {
      child.on('error', (error) => settled({ code: null, out: error.message }));
      child.on('close', (code) => settled({ code, out }));
    });
  } finally {
    await file.close();
  }
};

export const verbRefusal = (verb: string, ran: Ran): Refusal =>
  refusalOf(decodeRefusalText(ran.out.trim()), `${verb} exited ${ran.code ?? 'without a code'}: ${ran.out.trim() || 'it printed nothing'}`);

export async function stopTagma(closure: Closure, log: string, env: NodeJS.ProcessEnv): Promise<Refusal | null> {
  const stopped = await runCli(closure, ['quit', '--json'], log, env);
  return stopped.code === 0 ? null : verbRefusal('quit', stopped);
}
