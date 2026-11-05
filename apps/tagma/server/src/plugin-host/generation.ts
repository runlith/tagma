import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { McpNotConnected } from '@runlith/mcp/McpFailure';
import { mcpRedactor } from '@runlith/mcp/mcpRedactor';
import { type McpCallOptions, type McpSession, openMcpSession } from '@runlith/mcp/McpSession';
import { Clock, Data, Deferred, type Duration, Effect, Exit, Scope } from 'effect';
import type { PluginProcess } from '../plugins/contract/service/format.js';
import { pluginCaller } from '../plugins/contract/wire/names.js';
import { PLUGIN_ENVIRONMENT } from './contract/wire/environment.js';

type LaunchEnvironment = {
  readonly env: Readonly<Record<string, string>>;
  readonly redact: readonly string[];
  readonly fingerprint: string;
};

export const environmentOf = (options: Readonly<Record<string, string>>, redact: readonly string[]): LaunchEnvironment => {
  const env = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== ''));
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(Object.entries(env).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))))
    .digest('hex');
  return { env, redact, fingerprint };
};

export type Generation = {
  readonly scope: Scope.Closeable;
  readonly session: McpSession | null;
  readonly revision: string;
  readonly fingerprint: string;
  readonly startedAt: number;
  release: () => void;
  active: number;
  idle: Deferred.Deferred<void> | null;
};

type Launch = {
  readonly id: string;
  readonly root: string;
  readonly data: string;
  readonly server: string | null;
  readonly process: PluginProcess | null;
  readonly revision: string;
  readonly environment: LaunchEnvironment;
};

class LaunchFailed extends Data.TaggedError('LaunchFailed')<{ readonly reason: string }> {}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const declarationOf = (launch: Launch, process: PluginProcess): McpServerDeclaration => ({
  name: launch.id,
  transport: 'stdio',
  command: process.command,
  args: process.args,
  cwd: launch.root,
  env: {
    ...launch.environment.env,
    ...(launch.server === null ? {} : { [PLUGIN_ENVIRONMENT.server]: launch.server }),
    [PLUGIN_ENVIRONMENT.caller]: pluginCaller(launch.id),
    [PLUGIN_ENVIRONMENT.data]: launch.data,
    [PLUGIN_ENVIRONMENT.revision]: launch.revision,
  },
  capabilities: { kinds: [], mutates: true },
  enabled: true,
});

export const openGeneration = Effect.fn('pluginHost.openGeneration')(function* (
  launch: Launch,
  parent: Scope.Scope,
): Effect.fn.Return<Generation, LaunchFailed> {
  const made = (scope: Scope.Closeable, session: McpSession | null, startedAt: number): Generation => ({
    scope,
    session,
    revision: launch.revision,
    fingerprint: launch.environment.fingerprint,
    startedAt,
    release: () => undefined,
    active: 0,
    idle: null,
  });
  const declared = launch.process;
  if (declared === null) return made(yield* Scope.fork(parent), null, yield* Clock.currentTimeMillis);
  const data = launch.data;
  yield* Effect.tryPromise({
    try: () => mkdir(data, { recursive: true }),
    catch: (error) => new LaunchFailed({ reason: `its data directory ${data} could not be made: ${reasonOf(error)}` }),
  });
  const scope = yield* Scope.fork(parent);
  const session = yield* openMcpSession(declarationOf(launch, declared), {
    redact: mcpRedactor(launch.environment.redact),
  }).pipe(
    Scope.provide(scope),
    Effect.mapError((failure) => new LaunchFailed({ reason: failure.message })),
    Effect.onError(() => Scope.close(scope, Exit.void)),
  );
  return made(scope, session, yield* Clock.currentTimeMillis);
});

export const alive = (generation: Generation): boolean => generation.session === null || !Deferred.isDoneUnsafe(generation.session.closed);

export const drained = (generation: Generation, within: Duration.Input): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (generation.active === 0) return Effect.void;
    const idle = generation.idle ?? Deferred.makeUnsafe<void>();
    generation.idle = idle;
    return Deferred.await(idle).pipe(Effect.timeoutOption(within), Effect.asVoid);
  }).pipe(Effect.withSpan('pluginHost.drained'));

export const callIn = (
  generation: Generation,
  id: string,
  state: string,
  tool: string,
  args: Readonly<Record<string, unknown>>,
  options: McpCallOptions,
) => within(generation, id, state, (session) => session.call(tool, args, options));

export const within = <A, E>(
  generation: Generation,
  id: string,
  state: string,
  use: (session: McpSession) => Effect.Effect<A, E>,
): Effect.Effect<A, E | McpNotConnected> => {
  const session = generation.session;
  if (session === null || !alive(generation)) return Effect.fail(new McpNotConnected({ server: id, state }));
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      generation.active += 1;
    }),
    () => use(session),
    () =>
      Effect.sync(() => {
        generation.active -= 1;
        if (generation.active === 0 && generation.idle !== null) Deferred.doneUnsafe(generation.idle, Effect.void);
      }),
  );
};
