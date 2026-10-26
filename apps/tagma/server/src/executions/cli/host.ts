import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { DeclaredCancellationCause } from '@runlith/executions/protocol/call';
import { databasePath, installationAnchor } from '../../installation/paths.js';
import { InstalledChannel } from '../../installation/contract/service/channel.js';
import { print } from '../../platform/cli/verb.js';
import {
  executionRefInput,
  limitInput,
  operationRefInput,
  requireSingleHost,
  refuseInput,
  revisionInput,
  runRecovery,
  settleHostCall,
  type ResolveInput,
} from './host/resolve.js';
import { authorityText, operationText, pageText, receiptText, showStatus, shutdownText } from './host/text.js';

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const environment = Flag.String('environment').pipe(
  Flag.optional,
  Flag.withMetavar('id'),
  Flag.withDescription('the installed host to address; omitted, the single one standing'),
);
const state = Flag.String('state').pipe(
  Flag.optional,
  Flag.withMetavar('dir'),
  Flag.withDescription('the host state directory, skipping the installation search'),
);
const operationName = Flag.String('operation').pipe(
  Flag.withMetavar('name'),
  Flag.withDescription(
    'the durable key this act is answered under — re-running the identical command resumes it instead of starting a second one',
  ),
);
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

const resolveInput = (o: {
  environment: Option.Option<string>;
  state: Option.Option<string>;
}): Effect.Effect<ResolveInput, never, InstalledChannel> =>
  Effect.map(InstalledChannel, (channel) => ({
    anchor: installationAnchor(databasePath(channel)),
    environment: optional(o.environment),
    state: optional(o.state),
  }));

const statusCommand = Command.make('status', { json, environment, state }, (o) =>
  Effect.gen(function* () {
    const host = yield* requireSingleHost(yield* resolveInput(o), o.json);
    if (host === undefined) return;
    yield* showStatus(host, o.json);
  }),
).pipe(Command.withDescription('the execution host standing here: its artifact identity and what it holds'));

const listCommand = Command.make(
  'list',
  {
    json,
    environment,
    state,
    after: Flag.String('after').pipe(
      Flag.optional,
      Flag.withMetavar('execution/incarnation'),
      Flag.withDescription('the cursor the previous page answered — its `after`, naming the last row it carried'),
    ),
    limit: Flag.Int('limit').pipe(
      Flag.optional,
      Flag.withMetavar('count'),
      Flag.withDescription('how many rows to read; omitted, the host’s own page'),
    ),
  },
  (o) =>
    Effect.gen(function* () {
      const host = yield* requireSingleHost(yield* resolveInput(o), o.json);
      if (host === undefined) return;
      const installation = host.registration.installation;
      const after = optional(o.after);
      const limit = optional(o.limit);
      const cursor = after === undefined ? undefined : yield* executionRefInput(installation, after).pipe(Effect.mapError(refuseInput));
      const count = limit === undefined ? undefined : yield* limitInput(limit).pipe(Effect.mapError(refuseInput));
      const page = yield* runRecovery(host, (recovery) =>
        recovery.list({
          after: cursor,
          limit: count,
        }),
      ).pipe(settleHostCall);
      if (o.json) return yield* print(page, true);
      yield* print(pageText(page), false);
    }),
).pipe(Command.withDescription('the executions the host holds, one bounded page at a time'));

const operationCommand = Command.make(
  'operation',
  {
    json,
    environment,
    state,
    ref: Argument.String('ref').pipe(Argument.withDescription('the operation key to read back, as --operation spelled it')),
  },
  (o) =>
    Effect.gen(function* () {
      const host = yield* requireSingleHost(yield* resolveInput(o), o.json);
      if (host === undefined) return;
      const operation = yield* operationRefInput(host.registration.installation, o.ref).pipe(Effect.mapError(refuseInput));
      const answer = yield* runRecovery(host, (recovery) => recovery.operation(operation)).pipe(settleHostCall);
      if (o.json) return yield* print(answer, true);
      yield* print(operationText(answer), false);
    }),
).pipe(Command.withDescription('what one durable key was already answered with — how a lost reply is resumed, never re-sent'));

const stopCommand = Command.make(
  'stop',
  {
    json,
    environment,
    state,
    execution: Argument.String('execution').pipe(Argument.withDescription('the execution to end, as <execution-id>/<incarnation>')),
    operation: operationName,
    action: Flag.Literals('action', ['signal', 'destroy']).pipe(
      Flag.withDescription('signal delivers the stop signal and escalates; destroy also closes the terminal and may abandon unread output'),
    ),
    cause: Flag.Literals('cause', DeclaredCancellationCause.literals).pipe(
      Flag.withDefault('explicit-stop'),
      Flag.withDescription('why this execution ends, as the stop receipt records it'),
    ),
  },
  (o) =>
    Effect.gen(function* () {
      const host = yield* requireSingleHost(yield* resolveInput(o), o.json);
      if (host === undefined) return;
      const installation = host.registration.installation;
      const execution = yield* executionRefInput(installation, o.execution).pipe(Effect.mapError(refuseInput));
      const operation = yield* operationRefInput(installation, o.operation).pipe(Effect.mapError(refuseInput));
      const receipt = yield* runRecovery(host, (recovery) => recovery.stop(operation, execution, o.cause, o.action)).pipe(settleHostCall);
      if (o.json) return yield* print(receipt, true);
      yield* print(receiptText(receipt), false);
    }),
).pipe(
  Command.withDescription(
    'end one execution and report what the stop actually covered — re-running the identical command resumes it under the same key',
  ),
);

const shutdownCommand = Command.make('shutdown', { json, environment, state, operation: operationName }, (o) =>
  Effect.gen(function* () {
    const host = yield* requireSingleHost(yield* resolveInput(o), o.json);
    if (host === undefined) return;
    const operation = yield* operationRefInput(host.registration.installation, o.operation).pipe(Effect.mapError(refuseInput));
    const outcome = yield* runRecovery(host, (recovery) => recovery.shutdown(operation)).pipe(settleHostCall);
    if (o.json) return yield* print(outcome, true);
    yield* print(shutdownText(outcome), false);
  }),
).pipe(
  Command.withDescription(
    'end the host, reporting every execution it enumerated — an incomplete shutdown keeps its key, so re-running the identical command resumes it',
  ),
);

const fenceCommand = Command.make(
  'fence',
  {
    json,
    environment,
    state,
    operation: operationName,
    expectedRevision: Flag.Int('expected-revision').pipe(
      Flag.withMetavar('revision'),
      Flag.withDescription('the custody revision this fencing was decided over, as `status` reported it'),
    ),
  },
  (o) =>
    Effect.gen(function* () {
      const host = yield* requireSingleHost(yield* resolveInput(o), o.json);
      if (host === undefined) return;
      const operation = yield* operationRefInput(host.registration.installation, o.operation).pipe(Effect.mapError(refuseInput));
      const expected = yield* revisionInput(o.expectedRevision).pipe(Effect.mapError(refuseInput));
      const outcome = yield* runRecovery(host, (recovery) => recovery.fenceHost(operation, expected)).pipe(settleHostCall);
      if (o.json) return yield* print(outcome, true);
      yield* print(authorityText(outcome), false);
    }),
).pipe(
  Command.withDescription(
    'withdraw a custodian that stopped answering, over the revision read — re-running the identical command resumes it under the same key, and grants nothing',
  ),
);

export const executionHost = Command.make('execution-host', {}, () =>
  Effect.gen(function* () {
    const host = yield* requireSingleHost({ anchor: installationAnchor(databasePath(yield* InstalledChannel)) }, false);
    if (host === undefined) return;
    yield* showStatus(host, false);
  }),
).pipe(
  Command.withDescription(
    'inspect and end this installation’s execution host without the server: status, inventory, and durable stop, shutdown and fencing',
  ),
  Command.withSubcommands([statusCommand, listCommand, operationCommand, stopCommand, shutdownCommand, fenceCommand]),
);
