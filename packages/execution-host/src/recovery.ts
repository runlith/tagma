import { endpointConnection } from '@runlith/executions/posix/endpoint';
import type { EndpointConnection } from '@runlith/executions/EndpointConnection';
import { Data, Effect, FileSystem, Path, Schema, type Scope } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import { hostAddress } from '@runlith/executions/hostAddress';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { ARTIFACT_FILE, ArtifactManifest, stampText, type ArtifactIdentity } from '@runlith/executions/protocol/artifact';
import { shutdownMsOf } from '@runlith/executions/protocol/capacity';
import {
  ExecutionId,
  type ExecutionRef,
  type ExecutionState,
  Incarnation,
  type InstallationId,
  HostRequestKey,
  type HostRequestRef,
} from '@runlith/executions/protocol/execution';
import { HostCustodyRevision } from '@runlith/executions/protocol/registration';
import type { ExecutionPage, OperationAnswer } from '@runlith/executions/protocol/runtime';
import type { ShutdownAnswer } from '@runlith/executions/protocol/stop';
import { WIRE_VERSION, WireLimits } from '@runlith/executions/protocol/wire';
import { recoveryClient } from '@runlith/executions/RecoveryClient';

export class RecoveryRefused extends Data.TaggedError('RecoveryRefused')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

const FRAME_BYTES = 1024 * 1024;

export const LIST_PAGE_ROWS = 100;

export const HANDSHAKE_MS = 5000;

export const READ_PATIENCE_MS = HANDSHAKE_MS;

export const ENDING_PATIENCE_MS = shutdownMsOf(undefined) + HANDSHAKE_MS;

export const limits: WireLimits = Schema.decodeUnknownSync(WireLimits)({
  frameBytes: FRAME_BYTES,
  headerBytes: FRAME_BYTES,
  connections: 1,
  requests: 1,
  subscriptions: 1,
  credits: FRAME_BYTES,
  helloMs: HANDSHAKE_MS,
});

export const Verb = Schema.Literals(['status', 'list', 'operation', 'stop', 'shutdown', 'fence', 'version']);
export type Verb = typeof Verb.Type;

const readVerb = Schema.decodeUnknownEffect(Verb);
const readOperationId = Schema.decodeUnknownEffect(HostRequestKey);
const readExecutionId = Schema.decodeUnknownEffect(ExecutionId);
const readIncarnation = Schema.decodeUnknownEffect(Incarnation.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)));
const readRevision = Schema.decodeUnknownEffect(HostCustodyRevision);

export type ListedRow = {
  readonly state: ExecutionState;
};

export const formatListRow = (row: ListedRow): string =>
  `${row.state.ref.execution} ${row.state.ref.incarnation} ${row.state.phase}` +
  ` ${row.state.transport} cleanup ${row.state.cleanup} record ${row.state.record}`;

export const formatListCursor = (after: ExecutionRef): string => `more after ${after.execution} ${after.incarnation}`;

export const formatVersion = (wire: number, manifest: ArtifactIdentity | undefined): string =>
  manifest === undefined ? `wire ${wire} bundle unknown` : `wire ${wire} bundle ${manifest.digest} build ${manifest.build}`;

export const readBundleManifest = Effect.fnUntraced(function* (
  root: string,
): Effect.fn.Return<ArtifactIdentity | undefined, never, FileSystem.FileSystem | Path.Path> {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const manifest = path.join(root, ARTIFACT_FILE);
  return yield* files.readFileString(manifest).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactManifest))),
    Effect.map((read) => read.identity),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(undefined)),
    Effect.catchTags({
      PlatformError: (failure) => Effect.as(Effect.logWarning(`the bundle manifest at ${manifest} could not be read`, failure), undefined),
      SchemaError: (failure) =>
        Effect.as(Effect.logWarning(`the bundle manifest at ${manifest} is not readable as a bundle`, failure), undefined),
    }),
  );
});

const ownBundleRoot = (path: Path.Path): string => path.dirname(path.dirname(new URL(import.meta.url).pathname));

export const readOperationKey = (
  name: string | undefined,
  verb: Verb,
  installation: InstallationId,
): Effect.Effect<HostRequestRef, RecoveryRefused> =>
  name === undefined
    ? Effect.fail(
        new RecoveryRefused({ detail: `${verb} needs an operation key: running it again with the same key resumes the same operation` }),
      )
    : readOperationId(name).pipe(
        Effect.mapError(
          () => new RecoveryRefused({ detail: `"${name}" is not an operation key: a key is a caller-minted non-empty string` }),
        ),
        Effect.map((operation) => ({ installation, operation })),
      );

export const readListLimit = (text: string | undefined): Effect.Effect<number, RecoveryRefused> => {
  if (text === undefined) return Effect.succeed(LIST_PAGE_ROWS);
  const rows = Number(text);
  return Number.isSafeInteger(rows) && rows > 0
    ? Effect.succeed(rows)
    : Effect.fail(new RecoveryRefused({ detail: `${text} is not a page size: list limit takes the row count` }));
};

export type ListArgs = { readonly after: ExecutionRef | undefined; readonly limit: number };

export const readListArgs = Effect.fnUntraced(function* (
  args: ReadonlyArray<string>,
  installation: InstallationId,
): Effect.fn.Return<ListArgs, RecoveryRefused> {
  let rest = args;
  let limit = LIST_PAGE_ROWS;
  if (rest[0] === 'limit') {
    const count = rest[1];
    if (count === undefined) {
      return yield* Effect.fail(new RecoveryRefused({ detail: 'list limit takes the row count' }));
    }
    limit = yield* readListLimit(count);
    rest = rest.slice(2);
  }
  const [after, incarnation, extra] = rest;
  if (extra !== undefined) {
    return yield* Effect.fail(
      new RecoveryRefused({
        detail: `unexpected argument ${extra}: list takes limit <rows>, then the execution and incarnation the last page ended at`,
      }),
    );
  }
  return { after: yield* readListCursor(after, incarnation, installation), limit };
});

export const readListCursor = Effect.fnUntraced(function* (
  execution: string | undefined,
  incarnation: string | undefined,
  installation: InstallationId,
): Effect.fn.Return<ExecutionRef | undefined, RecoveryRefused> {
  if (execution === undefined) {
    if (incarnation !== undefined) {
      return yield* Effect.fail(new RecoveryRefused({ detail: 'list takes the execution before its incarnation' }));
    }
    return undefined;
  }
  const ref = yield* readExecutionId(execution).pipe(
    Effect.mapError(
      () =>
        new RecoveryRefused({
          detail: `"${execution}" is not an execution identity: a cursor names the execution the previous page ended at`,
        }),
    ),
  );
  const generation = yield* readIncarnation(Number(incarnation ?? 0)).pipe(
    Effect.mapError(() => new RecoveryRefused({ detail: `${incarnation} is not an incarnation` })),
  );
  return { installation, execution: ref, incarnation: generation };
});

export const formatOperationLine = (answer: OperationAnswer): string => {
  switch (answer._tag) {
    case 'Accepted':
      return answer.execution === undefined
        ? 'Accepted'
        : `Accepted execution ${answer.execution.execution} ${answer.execution.incarnation}`;
    case 'Cancelled':
      return 'Cancelled';
    case 'Refused':
      return `Refused ${answer.refusal._tag}: ${answer.refusal.reason}`;
    case 'Uncertain':
      return `Uncertain ${answer.effect._tag} ${answer.effect.operation.operation}`;
    case 'Unanswered':
      return 'Unanswered';
  }
};

export const formatShutdownLine = (outcome: ShutdownAnswer): string => {
  switch (outcome._tag) {
    case 'ShutdownComplete':
      return 'ShutdownComplete';
    case 'ShutdownIncomplete':
      return 'ShutdownIncomplete';
    case 'Refused':
      return `Refused ${outcome.refusal._tag}: ${outcome.refusal.reason}`;
    case 'Uncertain':
      return `Uncertain ${outcome.effect._tag} ${outcome.effect.operation.operation}`;
  }
};

export type RecoveryRequest = {
  readonly state: string;
  readonly verb: Verb;
  readonly arguments: ReadonlyArray<string>;
};

export const request = Effect.fnUntraced(function* (argv: ReadonlyArray<string>): Effect.fn.Return<RecoveryRequest, RecoveryRefused> {
  const given = argv.slice(2);
  const [state, verb, ...rest] = given;
  if (state === undefined || verb === undefined) {
    return yield* Effect.fail(
      new RecoveryRefused({
        detail: 'expected at least two arguments: the state directory and one of status, list, operation, stop, shutdown, fence, version',
      }),
    );
  }
  const named = yield* readVerb(verb).pipe(
    Effect.catchTag('SchemaError', () => Effect.fail(new RecoveryRefused({ detail: `${verb} is not a recovery verb` }))),
  );
  return { state, verb: named, arguments: rest };
});

export const perform = Effect.fnUntraced(function* (
  asked: RecoveryRequest,
): Effect.fn.Return<void, RecoveryRefused, FileSystem.FileSystem | Path.Path | HostRegistration | EndpointConnection | Scope.Scope> {
  if (asked.verb === 'version') {
    const path = yield* Path.Path;
    const manifest = yield* readBundleManifest(ownBundleRoot(path));
    return yield* Effect.sync(() => console.log(formatVersion(WIRE_VERSION, manifest)));
  }
  const registrations = yield* HostRegistration;
  const standing = yield* registrations
    .read(asked.state)
    .pipe(Effect.mapError((refusal) => new RecoveryRefused({ detail: `${refusal._tag}: no owner can be addressed at ${asked.state}` })));
  const address = yield* hostAddress(standing.state, standing.installation).pipe(
    Effect.mapError((refusal) => new RecoveryRefused({ detail: refusal.detail })),
  );
  const recovery = yield* recoveryClient(address, limits, { handshakeMs: HANDSHAKE_MS });
  const key = (name: string | undefined): Effect.Effect<HostRequestRef, RecoveryRefused> =>
    readOperationKey(name, asked.verb, standing.installation);
  const failed = (failure: ExecutionsFailure) => {
    switch (failure._tag) {
      case 'HostRefused':
        return new RecoveryRefused({
          detail: `the owner at ${address.state} refused this act: ${failure.refusal._tag} — ${failure.refusal.reason}`,
        });
      case 'WireInvalid':
        return new RecoveryRefused({
          detail: `the client could not frame the request for ${address.state}: ${failure.detail}`,
        });
      case 'WireUnreadable':
        return new RecoveryRefused({
          detail: `the owner at ${address.state} answered a frame this client will not read: ${failure.detail}`,
        });
      case 'WireFailed':
        return new RecoveryRefused({
          detail: `the owner at ${address.state} refused the frame: ${failure.fault.kind} — ${failure.fault.detail}`,
        });
      case 'WireLost':
        return new RecoveryRefused({
          detail: `the connection to ${address.state} ended before an answer: ${failure.reason}${failure.sent ? ' (the request had left this process — read its key back rather than sending it again)' : ''}`,
        });
      case 'WireUnavailable':
        return new RecoveryRefused({
          detail: `${failure.kind === 'unreachable' || failure.kind === 'absent' ? 'no owner could be reached at' : 'the owner could not be used at'} ${address.state}: ${failure.kind} — ${failure.reason}`,
        });
    }
  };
  const say = (line: string) => Effect.sync(() => console.log(line));
  const within = <A>(act: Effect.Effect<A, ExecutionsFailure>, patience: number, unanswered: string): Effect.Effect<A, RecoveryRefused> =>
    Effect.timeoutOrElse(Effect.mapError(act, failed), {
      duration: patience,
      orElse: () => Effect.fail(new RecoveryRefused({ detail: unanswered })),
    });
  const silent = (verb: string, patience: number): string =>
    `the owner at ${address.state} did not answer this ${verb} within ${patience}ms`;
  const unanswered = (verb: string, patience: number, operation: HostRequestRef): string =>
    `${silent(verb, patience)}; the act may have run — read it back under its own key: operation ${operation.operation}`;

  switch (asked.verb) {
    case 'status': {
      const status = yield* within(recovery.status(), READ_PATIENCE_MS, silent('status', READ_PATIENCE_MS));
      yield* say(`installation ${status.installation} incarnation ${status.incarnation} ${status.phase}`);
      yield* say(
        standing.artifact === undefined
          ? 'artifact none: this host recorded no pinned bundle'
          : `artifact ${standing.artifact.identity.digest} build ${standing.artifact.identity.build}` +
              ` ${standing.artifact.protocol} wire ${stampText(standing.artifact)}`,
      );
      return;
    }
    case 'list': {
      const { after: from, limit } = yield* readListArgs(asked.arguments, standing.installation);
      let rows = limit;
      let page: ExecutionPage | undefined;
      for (;;) {
        const read = yield* Effect.result(
          Effect.timeoutOrElse(recovery.list(from === undefined ? { limit: rows } : { after: from, limit: rows }), {
            duration: READ_PATIENCE_MS,
            orElse: () => Effect.fail(new RecoveryRefused({ detail: silent('list', READ_PATIENCE_MS) })),
          }),
        );
        if (read._tag === 'Success') {
          page = read.success;
          break;
        }
        if (read.failure._tag === 'RecoveryRefused') return yield* Effect.fail(read.failure);
        if (read.failure._tag === 'HostRefused' && read.failure.refusal._tag === 'CapacityExceeded' && rows > 1) {
          rows = Math.max(1, Math.floor(rows / 2));
          continue;
        }
        return yield* Effect.fail(failed(read.failure));
      }
      for (const row of page.executions) yield* say(formatListRow(row));
      if (page.after !== undefined) yield* say(formatListCursor(page.after));
      return;
    }
    case 'operation': {
      const operation = yield* key(asked.arguments[0]);
      const answer = yield* within(recovery.operation(operation), READ_PATIENCE_MS, silent('operation', READ_PATIENCE_MS));
      yield* say(`${operation.operation} ${formatOperationLine(answer)}`);
      return;
    }
    case 'stop': {
      const [name, execution, incarnation] = asked.arguments;
      const operation = yield* key(name);
      if (execution === undefined || incarnation === undefined) {
        return yield* Effect.fail(new RecoveryRefused({ detail: 'stop takes the operation key, the execution and its incarnation' }));
      }
      const generation = yield* readIncarnation(Number(incarnation)).pipe(
        Effect.mapError(() => new RecoveryRefused({ detail: `${incarnation} is not an incarnation` })),
      );
      const target = yield* readExecutionId(execution).pipe(
        Effect.mapError(
          () => new RecoveryRefused({ detail: `"${execution}" is not an execution identity: stop takes the execution the key ends` }),
        ),
      );
      const receipt = yield* within(
        recovery.stop(
          operation,
          {
            installation: standing.installation,
            execution: target,
            incarnation: generation,
          },
          'explicit-stop',
          'signal',
        ),
        ENDING_PATIENCE_MS,
        unanswered('stop', ENDING_PATIENCE_MS, operation),
      );
      yield* say(
        `${receipt.relation} confirmed ${receipt.confirmed.length}` +
          ` residual ${receipt.residual.length} unverifiable ${receipt.unverifiable.length}`,
      );
      for (const held of receipt.residual) yield* say(`residual ${held.kind}: ${held.detail}`);
      for (const held of receipt.unverifiable) yield* say(`unverifiable ${held.kind}: ${held.reason}`);
      return;
    }
    case 'shutdown': {
      const operation = yield* key(asked.arguments[0]);
      const outcome = yield* within(
        recovery.shutdown(operation),
        ENDING_PATIENCE_MS,
        unanswered('shutdown', ENDING_PATIENCE_MS, operation),
      );
      yield* say(formatShutdownLine(outcome));
      if (outcome._tag === 'ShutdownComplete' || outcome._tag === 'ShutdownIncomplete') {
        for (const held of outcome.executions) {
          yield* say(`${held.execution.execution} ${held.relation} residual ${held.residual.length}`);
        }
      }
      if (outcome._tag === 'ShutdownIncomplete') {
        yield* say(`incomplete: ${outcome.reason}`);
        for (const held of outcome.residual) yield* say(`residual ${held.kind}: ${held.detail}`);
        for (const held of outcome.unverifiable) yield* say(`unverifiable ${held.kind}: ${held.reason}`);
      }
      return;
    }
    case 'fence': {
      const [name, revision] = asked.arguments;
      const operation = yield* key(name);
      if (revision === undefined) {
        return yield* Effect.fail(new RecoveryRefused({ detail: 'fence takes the operation key and the custody revision it was read at' }));
      }
      const held = yield* readRevision(Number(revision)).pipe(
        Effect.mapError(() => new RecoveryRefused({ detail: `${revision} is not a custody revision` })),
      );
      const outcome = yield* within(
        recovery.fenceHost(operation, held),
        READ_PATIENCE_MS,
        unanswered('fence', READ_PATIENCE_MS, operation),
      );
      yield* say(outcome._tag);
      return;
    }
  }
}, Effect.scoped);

export const main = Effect.gen(function* () {
  const asked = yield* request(process.argv);
  return yield* perform(asked);
}).pipe(
  Effect.catchTag('RecoveryRefused', (refused) =>
    Effect.sync(() => {
      console.log(oneLine(refused.detail));
      process.exitCode = 1;
    }),
  ),
  Effect.provide(HostRegistration.layer),
  Effect.provide(endpointConnection),
  Effect.provide(BunServices.layer),
);

const oneLine = (detail: string): string =>
  detail
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');

if (import.meta.main) BunRuntime.runMain(main);
