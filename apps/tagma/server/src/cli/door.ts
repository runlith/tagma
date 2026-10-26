import { Console, Context, Data, Duration, Effect, Schedule } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import * as HttpClientError from 'effect/http/HttpClientError';
import { OUTCOME_HEADER } from '../invocation/contract/wire/headers.js';
import {
  ACT_HEADER,
  ACT_VARIABLE,
  GRANT_HEADER,
  GRANT_VARIABLE,
  OWN_GIT_VARIABLE,
  TERMINAL_HEADER,
  TERMINAL_VARIABLE,
} from '../platform/contract/service/credentials.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { faultBody, type RefusalBody } from '../platform/contract/wire/refusal.js';
import { MCP_SESSION_HEADER, SESSION_HEADER, sessionToken, type SessionRef } from '../platform/contract/wire/session.js';
import { refuse, CurrentInvocation, type Invocation } from '../platform/cli/verb.js';
import type { ServerWire } from './contract/service/server.js';

export const here = (at: Invocation) => ({ cwd: at.cwd });

export const lens = (at: Invocation, options: { project?: string | undefined; scope?: string | undefined }) => ({
  ...here(at),
  project: options.project,
  scope: options.scope,
});

const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

class Unready extends Data.TaggedError('Unready')<{ readonly refusal: RefusalBody; readonly after: Duration.Duration }> {}

const isUnready = (failure: unknown): failure is Unready => failure instanceof Unready;

const afterOf = (header: string | undefined): Duration.Duration | null => {
  const seconds = header === undefined || header.trim() === '' ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Duration.seconds(seconds) : null;
};

const undeclaredAnswer = (failure: unknown): Effect.Effect<never, unknown> => {
  const response = HttpClientError.isHttpClientError(failure) ? failure.response : undefined;
  if (response === undefined || response.status < 500) return Effect.fail(failure);
  return Effect.flatMap(response.text.pipe(Effect.mapError(() => failure)), (text) => {
    const body = faultBody(text);
    if (body === undefined) return Effect.fail(failure);
    if (response.headers[OUTCOME_HEADER] !== 'refusal') {
      return Effect.fail(new Error(refusalLines(body).join('\n')));
    }
    const after = afterOf(response.headers['retry-after']);
    return Effect.fail(after === null ? body : new Unready({ refusal: body, after }));
  });
};

const ASKED_AGAIN = Schedule.modifyDelay(Schedule.forever, ({ input }) => Effect.succeed(isUnready(input) ? input.after : Duration.zero));

export const CallerSignal = Context.Reference<AbortSignal | null>('tagma/cli/CallerSignal', { defaultValue: () => null });

const ask = <Door, A>(
  client: (at: Invocation) => Effect.Effect<Door>,
  call: (door: Door, at: Invocation) => Effect.Effect<A, unknown>,
): Effect.Effect<A, unknown> =>
  Effect.flatMap(Effect.all([CurrentInvocation, CallerSignal]), ([at, caller]) => {
    const once = client(at).pipe(
      Effect.flatMap((door) => call(door, at)),
      Effect.catch(undeclaredAnswer),
    );
    const awaited = (failure: unknown): failure is Unready => isUnready(failure) && caller?.aborted !== true;
    return Effect.catchIf(once, awaited, (unready) =>
      Console.error(`[tagma] ${unready.refusal.reason}; this call waits for its answer`).pipe(
        Effect.andThen(Effect.sleep(unready.after)),
        Effect.andThen(Effect.retry(once, { while: awaited, schedule: ASKED_AGAIN })),
      ),
    ).pipe(Effect.mapError((failure) => (isUnready(failure) ? failure.refusal : failure)));
  });

const unavailable = (failure: unknown): boolean => {
  if (!(failure instanceof Error)) return false;
  const cause = 'code' in failure ? failure : failure.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ETIMEDOUT',
      'ConnectionRefused',
      'ConnectionClosed',
      'FailedToOpenSocket',
    ].includes(String(cause.code))
  );
};

const healthOrNone = <Health>(
  baseUrl: (at: Invocation) => string,
  readAnswer: (body: unknown) => Health | null,
): Effect.Effect<Health | null> =>
  Effect.flatMap(CurrentInvocation, (at) =>
    Effect.tryPromise({ try: (signal) => fetch(`${baseUrl(at)}/health`, { signal }), catch: (failure) => failure }).pipe(
      Effect.catchIf(unavailable, () => Effect.succeed(null)),
      Effect.orDie,
      Effect.flatMap((response) =>
        response !== null && response.ok
          ? Effect.map(Effect.tryPromise(() => response.json()).pipe(Effect.orDie), readAnswer)
          : Effect.succeed(null),
      ),
    ),
  );

export const serverDoor = <Door, Health>(wire: ServerWire<Door, Health>) => {
  const boundPort = (at: Invocation): string => at.env.TAGMA_PORT?.trim() || String(wire.defaultPort);

  const boundAddress = (at: Invocation): string => `http://127.0.0.1:${boundPort(at)}`;

  const baseUrl = (at: Invocation): string => {
    if ((at.env[OWN_GIT_VARIABLE]?.trim() ?? '') !== '') {
      refuse(
        'own-git',
        `${OWN_GIT_VARIABLE} marks a process Tagma's own git started, and nothing Tagma's own git starts calls back into the server`,
        [`run this outside that git process: ${OWN_GIT_VARIABLE} rides only the git the server runs, never a shell`],
      );
    }
    const url = at.env.TAGMA_SERVER_URL?.trim();
    if (url) return url.replace(/\/$/, '');
    return boundAddress(at);
  };

  const boundHere = (at: Invocation, address: string): boolean => {
    const url = URL.parse(address);
    if (url === null || url.protocol !== 'http:') return false;
    return LOOPBACK.has(url.hostname) && (url.port || '80') === boundPort(at);
  };

  type Held = {
    door: Door | null;
    bridge: SessionRef | null;
  };

  const helds = new WeakMap<Invocation, Held>();

  const heldBy = (at: Invocation): Held => {
    const standing = helds.get(at);
    if (standing !== undefined) return standing;
    const born: Held = { door: null, bridge: null };
    helds.set(at, born);
    return born;
  };

  const declareBridge = (at: Invocation, declared: SessionRef): void => {
    heldBy(at).bridge = declared;
  };

  const sessionHeader = (at: Invocation): Record<string, string> => {
    const grant = at.env[GRANT_VARIABLE]?.trim();
    if (grant) {
      const act = at.env[ACT_VARIABLE]?.trim();
      return act ? { [GRANT_HEADER]: grant, [ACT_HEADER]: act } : { [GRANT_HEADER]: grant };
    }
    const shell = at.env[TERMINAL_VARIABLE]?.trim();
    const beside: Record<string, string> = shell ? { [TERMINAL_HEADER]: shell } : {};
    const bridge = heldBy(at).bridge;
    if (bridge !== null) return { [MCP_SESSION_HEADER]: sessionToken(bridge), ...beside };
    for (const { harness, variable } of wire.signers) {
      const key = variable === undefined ? undefined : at.env[variable]?.trim();
      if (key) return { [SESSION_HEADER]: sessionToken({ harness, key }), ...beside };
    }
    return {};
  };

  const signing = (at: Invocation, client: HttpClient.HttpClient) =>
    HttpClient.mapRequest(client, (request) => HttpClientRequest.setHeaders(request, sessionHeader(at)));

  const client = (at: Invocation): Effect.Effect<Door> =>
    Effect.suspend(() => {
      const held = heldBy(at);
      if (held.door !== null) return Effect.succeed(held.door);
      return wire.connect(baseUrl(at), (bound) => signing(at, bound)).pipe(Effect.map((bound) => (held.door = bound)));
    });

  const serverDown = (at: Invocation): never => {
    const other = wire.elsewhere(at.env);
    if (other !== null) return refuse('channel-active', other.reason, other.unblock);
    return refuse('server-down', `nothing answers at ${baseUrl(at)}`, [
      `${wire.command} serve — start it`,
      'TAGMA_SERVER_URL / TAGMA_PORT — if it listens elsewhere',
    ]);
  };

  const reading = (): Effect.Effect<Health | null> => healthOrNone(baseUrl, wire.readHealth);

  const health = (): Effect.Effect<Health> =>
    Effect.flatMap(CurrentInvocation, (at) =>
      Effect.flatMap(reading(), (answered) => (answered === null ? Effect.sync(() => serverDown(at)) : Effect.succeed(answered))),
    );

  return {
    baseUrl,
    boundAddress,
    boundHere,
    declareBridge,
    sessionHeader,
    client,
    ask: <A>(call: (door: Door, at: Invocation) => Effect.Effect<A, unknown>) => ask(client, call),
    healthOrNone: reading,
    health,
  };
};
