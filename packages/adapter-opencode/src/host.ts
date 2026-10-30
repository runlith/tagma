import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OpenCode, type OpenCodeClient } from '@opencode/client';
import { Data, Deferred, Effect, Result, Schema } from 'effect';
import { HARNESS_PROGRAM } from '@runlith/hosted-runner/wire/program';

const VERSION = '2.1.3';

export class HostRefused extends Data.TaggedError('HostRefused')<{
  readonly code: 'program-missing' | 'spawn-failed' | 'version-unsupported' | 'readiness-invalid' | 'host-exited' | 'request-failed';
  readonly message: string;
}> {}

export type HostConfig = {
  readonly directory: string;
  readonly content: string;
  readonly project: false;
  readonly claude: false;
};

export type HostInput = {
  readonly program: string;
  readonly cwd: string;
  readonly environment: Record<string, string | undefined>;
  readonly config: HostConfig;
  readonly onStderr?: (chunk: string) => void;
};

export type Host = {
  readonly client: OpenCodeClient;
  readonly endpoint: string;
  readonly version: string;
  readonly exit: Effect.Effect<number, HostRefused>;
};

type ProcessInput = {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Record<string, string | undefined>;
  readonly stdout: (chunk: string) => void;
  readonly stderr?: (chunk: string) => void;
};

type Process = {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exit: Effect.Effect<number, HostRefused>;
  readonly closed: Effect.Effect<Result.Result<number, HostRefused>>;
};

const closeProcess = Effect.fn('opencode.closeProcess')(function* (process: Process) {
  if (!process.child.stdin.destroyed) process.child.stdin.end();
  const outcome = yield* process.closed;
  if (Result.isFailure(outcome))
    yield* Effect.logWarning('OpenCode process closed with an error', { code: outcome.failure.code, message: outcome.failure.message });
  else if (outcome.success !== 0) yield* Effect.logWarning('OpenCode process exited unsuccessfully', { code: outcome.success });
});

const startProcess = Effect.fn('opencode.startProcess')(function* (input: ProcessInput) {
  const exited = yield* Deferred.make<Result.Result<number, HostRefused>>();
  return yield* Effect.acquireRelease(
    Effect.try({
      try: (): Process => {
        const child = spawn(input.program, [...input.args], { cwd: input.cwd, env: input.environment, stdio: 'pipe' });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', input.stdout);
        child.stderr.on('data', (chunk: string) => input.stderr?.(chunk));
        let failure: HostRefused | undefined;
        child.stdin.on('error', (cause) => {
          failure = new HostRefused({ code: 'host-exited', message: cause.message });
        });
        child.once('error', (cause) => {
          failure = new HostRefused({ code: 'spawn-failed', message: cause.message });
        });
        child.once('close', (code, signal) => {
          Deferred.doneUnsafe(
            exited,
            Effect.succeed(
              failure !== undefined
                ? Result.fail(failure)
                : code === null
                  ? Result.fail(new HostRefused({ code: 'host-exited', message: `OpenCode exited on signal ${signal}` }))
                  : Result.succeed(code),
            ),
          );
        });
        const closed = Deferred.await(exited);
        return { child, closed, exit: closed.pipe(Effect.flatMap(Effect.fromResult)) };
      },
      catch: (cause) => new HostRefused({ code: 'spawn-failed', message: String(cause) }),
    }),
    closeProcess,
  );
});

export const installedProgram = (): string =>
  fileURLToPath(new URL('./bin/opencode.exe', import.meta.resolve('@opencode/cli/package.json')));

export const findProgram = Effect.fn('opencode.findProgram')(function* (environment: Record<string, string | undefined> = process.env) {
  return yield* Effect.try({
    try: () => environment[HARNESS_PROGRAM] ?? installedProgram(),
    catch: (cause) => new HostRefused({ code: 'program-missing', message: `OpenCode V2 could not be resolved: ${String(cause)}` }),
  });
});

const checkVersion = Effect.fn('opencode.checkVersion')(function* (input: HostInput) {
  let stdout = '';
  let stderr = '';
  const process = yield* startProcess({
    program: input.program,
    args: ['--version'],
    cwd: input.cwd,
    environment: input.environment,
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });
  const code = yield* process.exit;
  const found = stdout.trim();
  const version = /^opencode v(\d+\.\d+\.\d+)$/u.exec(found)?.[1];
  if (code !== 0 || version !== VERSION)
    return yield* new HostRefused({
      code: 'version-unsupported',
      message: `OpenCode ${VERSION} is required; ${code === 0 ? `found ${found}` : `version command exited ${code}: ${stderr.trim()}`}`,
    });
  return version;
});

const readinessSchema = Schema.fromJsonString(Schema.Struct({ url: Schema.String }));

export const openHost = Effect.fn('opencode.openHost')(function* (input: HostInput) {
  const version = yield* Effect.scoped(checkVersion(input));
  const ready = yield* Deferred.make<string>();
  let line = '';
  let received = false;
  const password = randomBytes(32).toString('base64url');
  const process = yield* startProcess({
    program: input.program,
    args: ['serve', '--stdio', '--port', '0', '--hostname', '127.0.0.1'],
    cwd: input.cwd,
    environment: {
      ...input.environment,
      OPENCODE_PASSWORD: password,
      OPENCODE_SERVER_PASSWORD: undefined,
      OPENCODE_CONFIG: undefined,
      OPENCODE_CONFIG_DIR: input.config.directory,
      OPENCODE_CONFIG_CONTENT: input.config.content,
      OPENCODE_CONFIG_PROJECT_DISABLE: String(!input.config.project),
      OPENCODE_DISABLE_CLAUDE_CODE: String(!input.config.claude),
      OPENCODE_FILEWATCHER_DISABLE: 'true',
      OPENCODE_DISABLE_FFF: 'true',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      TMPDIR: input.config.directory,
      TMP: input.config.directory,
      TEMP: input.config.directory,
      OPENCODE_CLIENT: 'Tagma',
    },
    stdout: (chunk) => {
      if (received) return;
      line += chunk;
      const end = line.indexOf('\n');
      if (end < 0) return;
      received = true;
      Deferred.doneUnsafe(ready, Effect.succeed(line.slice(0, end)));
      line = '';
    },
    stderr: input.onStderr,
  });
  const first = yield* Effect.raceFirst(
    Deferred.await(ready),
    process.exit.pipe(
      Effect.flatMap((code) => new HostRefused({ code: 'host-exited', message: `OpenCode exited ${code} before readiness.` })),
    ),
  );
  const readiness = yield* Schema.decodeUnknownEffect(readinessSchema)(first).pipe(
    Effect.mapError((cause) => new HostRefused({ code: 'readiness-invalid', message: cause.message })),
  );
  const endpoint = URL.parse(readiness.url);
  if (
    endpoint === null ||
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password
  )
    return yield* new HostRefused({
      code: 'readiness-invalid',
      message: `OpenCode returned an invalid private endpoint: ${readiness.url}`,
    });
  return {
    client: OpenCode.make({
      baseUrl: endpoint.href,
      headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
    }),
    endpoint: endpoint.href,
    version,
    exit: process.exit,
  } satisfies Host;
});
