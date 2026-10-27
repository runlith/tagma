import { Effect, Schema } from 'effect';
import type { Refusal } from '@runlith/executions/protocol/host';
import { ExecutionId, type InstallationId } from '@runlith/executions/protocol/execution';
import type { InputRequest } from '@runlith/executions/protocol/input';
import { type EndingReading, type EndingReceipt, recordedEnding } from '@runlith/executions/protocol/stop';
import type { Request, HostAnswer, RetireAnswer } from '@runlith/executions/protocol/wire';
import { authority } from './authority';
import type { Bindings, BindingClaim } from './Bindings';
import { measuredPage, measuredRows } from './commandUsage';
import type { Custodian } from './Custodian';
import type { ExecutionCapacity } from './ExecutionCapacity';
import type { Executions } from './registry/launch';
import type { ExecutionRequest } from './registry/operations';
import type { HostCommands, HostProcessFacts } from './registry/inventory';
import type { CustodyControl, InputLanes, PaceControl } from './registry/control';
import type { ExecutionStop } from './registry/stops';
import type { HostByteRecords, TerminalScreen } from './registry/reads';
import type { ExecutionRetirement, HostDisown } from './registry/retention';
import type { HostLifecycle } from './registry/shutdown';
import type { ForgetAnswer } from './registry/retention';
import { actingRefusal, generationOf, liveReadRefOf, replacedRefusal } from './generation';
import type { HostAdmission } from './HostAdmission';
import type { Admitted } from './HostConnections';
import { countRead, hostSpan, noteRefusal } from './hostTelemetry';
import type { ProcessEvidence } from './ProcessEvidence';
import type { ProcessUsage } from './ProcessUsage';
import { refusalOf } from './refusals';
import { subscribe } from './subscriptions';

const readExecutionId = Schema.decodeUnknownSync(ExecutionId);

const strippedReading = (reading: EndingReading): EndingReceipt => {
  const { measurement: _measurement, ...receipt } = reading;
  return receipt;
};

const RECOVERY_MAY: ReadonlySet<Request['_tag']> = new Set<Request['_tag']>([
  'Status',
  'List',
  'Changes',
  'State',
  'Retained',
  'Operation',
  'CallResult',
  'Read',
  'Subscribe',
  'Screen',
  'ScreenPoint',
  'Processes',
  'Foreground',
  'Listeners',
  'ListenerInventory',
  'Stop',
  'CancelStart',
  'Signal',
  'Retire',
  'Shutdown',
  'Authority',
]);

export const answer = (
  executions: Executions['Service'],
  requests: ExecutionRequest['Service'],
  commands: HostCommands['Service'],
  processFacts: HostProcessFacts['Service'],
  lanes: InputLanes['Service'],
  custody: CustodyControl['Service'],
  stops: ExecutionStop['Service'],
  records: HostByteRecords['Service'],
  screens: TerminalScreen['Service'],
  retirement: ExecutionRetirement['Service'],
  lifecycle: HostLifecycle['Service'],
  pacing: PaceControl['Service'],
  disowning: HostDisown['Service'],
  bindings: Bindings['Service'],
  custodian: Custodian['Service'],
  capacity: ExecutionCapacity['Service'],
  admission: HostAdmission['Service'],
  evidence: ProcessEvidence | undefined,
  usage: ProcessUsage | undefined,
  admitted: Admitted,
  chunk: number,
  incarnation: number,
  installation: InstallationId,
): Effect.Effect<void> => {
  const body = admitted.body;
  const claimOf = (scope: { readonly binding: BindingClaim['binding']; readonly principal: BindingClaim['principal'] }) => ({
    binding: scope.binding,
    principal: scope.principal,
    connection: admitted.connection,
    epoch: admitted.epoch,
  });
  const refused = (failure: { readonly _tag: string }) => refusedAs(refusalOf(failure));
  const refusedAs = (refusal: Refusal) => Effect.andThen(noteRefusal(refusal), admitted.refuse(refusal));
  const span = <A, E, R>(
    verb: string,
    execution: string | undefined,
    operation: string | undefined,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    hostSpan(
      verb,
      {
        incarnation,
        role: admitted.role,
        connectionId: admitted.connection,
        executionId: execution,
        operationId: operation,
      },
      effect,
    );
  const answered = (response: HostAnswer) => Effect.asVoid(admitted.reply(response));
  const host = { connection: admitted.connection, epoch: admitted.epoch, role: admitted.role };

  if (admitted.role === 'recovery' && !RECOVERY_MAY.has(body._tag)) {
    return refusedAs({ _tag: 'Unauthorized', reason: `recovery may not ${body._tag}` });
  }

  const liveReadRef = liveReadRefOf(body);
  if (liveReadRef !== undefined) {
    const stale = actingRefusal(liveReadRef, installation, incarnation);
    if (stale !== undefined) return span(body._tag, liveReadRef.execution, undefined, refusedAs(stale));
  }

  switch (body._tag) {
    case 'EndProcess':
      return span(
        'EndProcess',
        undefined,
        undefined,
        Effect.gen(function* () {
          const reading = usage === undefined ? undefined : yield* usage.load;
          yield* stops
            .endProcess(host, body.target, reading)
            .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (outcome) => answered({ _tag: 'EndProcess', outcome }) }));
        }),
      );
    case 'EndResidual':
      return span(
        'EndResidual',
        body.origin.execution,
        undefined,
        stops
          .endResidual(host, body.origin, body.pid)
          .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (outcome) => answered({ _tag: 'EndResidual', outcome }) })),
      );

    case 'LoadInterest':
      return span(
        'LoadInterest',
        undefined,
        undefined,
        Effect.gen(function* () {
          const applied = usage !== undefined && (yield* admitted.hasSubscription(body.subscription));
          if (applied) yield* usage!.interest(`${admitted.connection}:${body.subscription}`, body.interested);
          yield* answered({ _tag: 'LoadInterest', applied });
        }),
      );

    case 'Status':
      return span(
        'Status',
        undefined,
        undefined,
        Effect.flatMap(lifecycle.status(), (status) => answered({ _tag: 'Status', status })),
      );

    case 'List':
      return span(
        'List',
        undefined,
        undefined,
        Effect.flatMap(executions.list(body.after === undefined ? undefined : readExecutionId(body.after.execution), body.limit), (page) =>
          answered({ _tag: 'Listed', page }),
        ),
      );

    case 'Changes':
      return span(
        'Changes',
        undefined,
        undefined,
        Effect.flatMap(executions.changes(body.since, body.limit), (changes) => answered({ _tag: 'Changes', changes })),
      );

    case 'Operation':
      return span(
        'Operation',
        undefined,
        body.operation.operation,
        Effect.flatMap(requests.operation(body.operation), (answer) => answered({ _tag: 'Operation', answer })),
      );

    case 'CallResult':
      return span(
        'CallResult',
        undefined,
        body.operation.operation,
        Effect.flatMap(requests.callResult(body.operation), (answer) => answered({ _tag: 'Call', answer })),
      );

    case 'Start':
      return span(
        'Start',
        undefined,
        body.operation.operation,
        Effect.flatMap(executions.start(host, body.operation, body.launch), (outcome) => answered({ _tag: 'Start', outcome })),
      );

    case 'CancelStart':
      return span(
        'CancelStart',
        undefined,
        body.operation.operation,
        Effect.flatMap(executions.cancelStart(host, body.operation, body.cause, body.trigger, body.when), (outcome) =>
          answered({ _tag: 'CancelStart', outcome }),
        ),
      );

    case 'Read':
      return records.read(body.cursor, body.limit).pipe(
        Effect.matchEffect({
          onFailure: (failure) => span('Read', body.cursor.ref.execution, undefined, refused(failure)),
          onSuccess: (read) =>
            span(
              'Read',
              body.cursor.ref.execution,
              undefined,
              Effect.andThen(
                Effect.annotateCurrentSpan({ bytes: read.bytes.length }),
                Effect.andThen(
                  countRead(read.bytes.length),
                  admitted.reply({ _tag: 'Read', range: read.range, bytes: read.bytes.length, modes: read.modes }, read.bytes),
                ),
              ),
            ),
        }),
      );

    case 'Screen':
      return span(
        'Screen',
        body.execution.execution,
        undefined,
        screens
          .screen(readExecutionId(body.execution.execution), {
            cells: body.cells,
            scrollback: body.scrollback,
          })
          .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (answer) => answered({ _tag: 'Screen', answer }) })),
      );

    case 'ScreenPoint':
      return span(
        'ScreenPoint',
        body.execution.execution,
        undefined,
        screens.point(readExecutionId(body.execution.execution), { scrollback: body.scrollback }).pipe(
          Effect.matchEffect({
            onFailure: refused,
            onSuccess: (pointed) =>
              Effect.andThen(
                Effect.annotateCurrentSpan({ bytes: pointed._tag === 'ScreenPoint' ? pointed.bytes.length : 0 }),
                pointed._tag === 'ScreenPoint'
                  ? Effect.asVoid(
                      admitted.reply(
                        {
                          _tag: 'ScreenPoint',
                          point: { _tag: 'ScreenPoint', ref: pointed.ref, position: pointed.position, geometry: pointed.geometry },
                          bytes: pointed.bytes.length,
                        },
                        pointed.bytes,
                      ),
                    )
                  : answered({ _tag: 'ScreenPoint', point: pointed, bytes: 0 }),
              ),
          }),
        ),
      );

    case 'Input': {
      const stale = actingRefusal(body.execution, installation, incarnation);
      if (stale !== undefined) return span('Input', body.execution.execution, undefined, refusedAs(stale));
      const request = inputOf(body, admitted.payload);
      if (request === undefined) {
        return refusedAs({
          _tag: 'UnsupportedCapability',
          reason:
            body.act._tag === 'Write'
              ? 'the input frame declared a byte count its payload does not carry'
              : `an input ${body.act._tag} carries no bytes, and this frame arrived with a payload`,
        });
      }
      return span(
        'Input',
        body.execution.execution,
        undefined,
        lanes
          .admit(readExecutionId(body.execution.execution), claimOf(body.scope), request)
          .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (outcome) => answered({ _tag: 'Input', outcome }) })),
      );
    }

    case 'OpenTerminalLane': {
      const stale = actingRefusal(body.execution, installation, incarnation);
      return span(
        'OpenTerminalLane',
        body.execution.execution,
        undefined,
        stale !== undefined
          ? refusedAs(stale)
          : lanes
              .open(readExecutionId(body.execution.execution), claimOf(body.claim))
              .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (lane) => answered({ _tag: 'OpenTerminalLane', ...lane }) })),
      );
    }

    case 'Custody':
      return span(
        'Custody',
        body.request.execution.execution,
        body.request.operation.operation,
        custody
          .move({ principal: body.principal, connection: admitted.connection, epoch: admitted.epoch }, body.request)
          .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (outcome) => answered({ _tag: 'Custody', outcome }) })),
      );

    case 'Stop': {
      const stale = actingRefusal(body.execution, installation, incarnation);
      return span(
        'Stop',
        body.execution.execution,
        body.operation.operation,
        stale !== undefined
          ? refusedAs(stale)
          : stops
              .stop(host, body.operation, readExecutionId(body.execution.execution), body.cause, body.action, body.trigger)
              .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (receipt) => answered({ _tag: 'Stop', receipt }) })),
      );
    }

    case 'Shutdown':
      return span(
        'Shutdown',
        undefined,
        body.operation.operation,
        lifecycle.shutdown(host, body.operation).pipe(
          Effect.matchEffect({
            onFailure: () =>
              answered({ _tag: 'Shutdown', outcome: { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation: body.operation } } }),
            onSuccess: (outcome) => answered({ _tag: 'Shutdown', outcome }),
          }),
        ),
      );

    case 'Retire': {
      const stale = actingRefusal(body.execution, installation, incarnation);
      return span(
        'Retire',
        body.execution.execution,
        body.operation.operation,
        stale !== undefined
          ? refusedAs(stale)
          : retirement.retire(host, body.operation, readExecutionId(body.execution.execution)).pipe(
              Effect.matchEffect({
                onFailure: refused,
                onSuccess: (outcome) => answered({ _tag: 'Retire', outcome: retirementOf(outcome) }),
              }),
            ),
      );
    }

    case 'Quiesce':
      return span(
        'Quiesce',
        undefined,
        body.operation.operation,
        Effect.flatMap(lifecycle.quiesce(host, body.operation), (outcome) => answered({ _tag: 'Quiesce', outcome })),
      );

    case 'Resume':
      return span(
        'Resume',
        undefined,
        undefined,
        Effect.flatMap(lifecycle.resume(host, body.ticket), (outcome) => answered({ _tag: 'Resume', outcome })),
      );

    case 'Prepare':
      return span(
        'Prepare',
        undefined,
        body.operation.operation,
        Effect.flatMap(lifecycle.prepare(host, body.operation), (outcome) => answered({ _tag: 'Prepare', outcome })),
      );

    case 'Yield':
      return span(
        'Yield',
        undefined,
        undefined,
        Effect.flatMap(lifecycle.yield(body.ticket), (outcome) => answered({ _tag: 'Yield', outcome })),
      );

    case 'Pace':
      return span(
        'Pace',
        undefined,
        undefined,
        pacing.set(host, body.pace).pipe(
          Effect.matchEffect({
            onFailure: refused,
            onSuccess: (report) => answered({ _tag: 'Pace', report }),
          }),
        ),
      );

    case 'Disown':
      return span(
        'Disown',
        undefined,
        undefined,
        disowning.disown(host, body.disowned).pipe(
          Effect.matchEffect({
            onFailure: refused,
            onSuccess: (report) => answered({ _tag: 'Disown', report }),
          }),
        ),
      );

    case 'Authority':
      return authority(lanes, retirement, bindings, custodian, capacity, admission, admitted, body, span);

    case 'Subscribe':
      return subscribe(executions, commands, records, screens, lanes, usage, admitted, body, chunk, refused, span);

    case 'State': {
      const generation = generationOf(body.execution, installation, incarnation);
      return span(
        'State',
        body.execution.execution,
        undefined,
        generation === 'retired'
          ? refusedAs(replacedRefusal(body.execution, incarnation))
          : generation === 'foreign'
            ? answered({ _tag: 'State' })
            : Effect.flatMap(executions.summary(readExecutionId(body.execution.execution)), (summary) =>
                answered({ _tag: 'State', summary: summary }),
              ),
      );
    }

    case 'Retained':
      return span(
        'Retained',
        body.execution.execution,
        undefined,
        generationOf(body.execution, installation, incarnation) === 'retired'
          ? records.retained(body.execution).pipe(
              Effect.matchEffect({
                onFailure: refused,
                onSuccess: (record) => answered({ _tag: 'Retained', record: record }),
              }),
            )
          : answered({ _tag: 'Retained' }),
      );

    case 'Ending': {
      const generation = generationOf(body.execution, installation, incarnation);
      const reading =
        generation === 'current'
          ? stops.ending(readExecutionId(body.execution.execution), body.remeasure)
          : generation === 'retired'
            ? Effect.map(records.retained(body.execution), (record) =>
                record?.final === undefined ? undefined : { ...recordedEnding(record.final), measurement: 'recorded' as const },
              )
            : Effect.succeed(undefined);
      return span(
        'Ending',
        body.execution.execution,
        undefined,
        reading.pipe(
          Effect.matchEffect({
            onFailure: refused,
            onSuccess: (reading) =>
              answered({
                _tag: 'Ending',
                receipt: reading === undefined ? undefined : strippedReading(reading),
                measurement: reading?.measurement,
              }),
          }),
        ),
      );
    }

    case 'Command':
      return span(
        'Command',
        body.execution.execution,
        undefined,
        generationOf(body.execution, installation, incarnation) === 'current'
          ? commands.command(readExecutionId(body.execution.execution)).pipe(
              Effect.matchEffect({
                onFailure: refused,
                onSuccess: (snapshot) => answered({ _tag: 'Command', snapshot: snapshot }),
              }),
            )
          : answered({ _tag: 'Command' }),
      );

    case 'Commands':
      return span(
        'Commands',
        undefined,
        undefined,
        Effect.flatMap(commands.inventory(body.query), (inventory) =>
          inventory._tag === 'Refused'
            ? answered({ _tag: 'Commands', inventory })
            : Effect.flatMap(measuredPage(inventory.page, usage), (page) =>
                answered({ _tag: 'Commands', inventory: { _tag: 'Page', page } }),
              ),
        ),
      );

    case 'CommandsAt':
      return span(
        'CommandsAt',
        undefined,
        undefined,
        Effect.flatMap(commands.commandsAt(body.refs), (batch) =>
          Effect.flatMap(measuredRows(batch.commands, usage), (measured) =>
            answered({
              _tag: 'CommandsAt',
              batch: { ...batch, commands: measured.commands, unmeasured: [...batch.unmeasured, ...measured.unmeasured] },
            }),
          ),
        ),
      );

    case 'Revise':
      return span(
        'Revise',
        body.request.execution.execution,
        body.request.operation.operation,
        commands
          .revise(host, body.request)
          .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (outcome) => answered({ _tag: 'Revise', outcome }) })),
      );

    case 'Signal': {
      const stale = actingRefusal(body.execution, installation, incarnation);
      return span(
        'Signal',
        body.execution.execution,
        undefined,
        stale !== undefined
          ? refusedAs(stale)
          : stops
              .signal(host, readExecutionId(body.execution.execution), body.signal)
              .pipe(Effect.matchEffect({ onFailure: refused, onSuccess: (outcome) => answered({ _tag: 'Signal', outcome }) })),
      );
    }

    case 'Foreground':
      return span(
        'Foreground',
        body.execution.execution,
        undefined,
        Effect.flatMap(processFacts.foreground(readExecutionId(body.execution.execution)), (outcome) =>
          answered({ _tag: 'Foreground', outcome }),
        ),
      );

    case 'Processes':
      return span(
        'Processes',
        body.execution.execution,
        undefined,
        evidence === undefined
          ? refusedAs(unscanned)
          : Effect.flatMap(evidence.processes(readExecutionId(body.execution.execution)), (report) =>
              answered({ _tag: 'Processes', report: report }),
            ),
      );

    case 'Listeners':
      return span(
        'Listeners',
        body.execution.execution,
        undefined,
        evidence === undefined
          ? refusedAs(unscanned)
          : Effect.flatMap(evidence.listeners(readExecutionId(body.execution.execution)), (report) =>
              answered({ _tag: 'Listeners', report: report }),
            ),
      );

    case 'ListenerInventory':
      return span(
        'ListenerInventory',
        undefined,
        undefined,
        evidence === undefined
          ? refusedAs(unscanned)
          : Effect.flatMap(evidence.inventory(evidence.scope), (report) => answered({ _tag: 'ListenerInventory', report })),
      );
  }
};

const retirementOf = (outcome: ForgetAnswer): RetireAnswer => {
  switch (outcome._tag) {
    case 'Forgotten':
      return { _tag: 'Retired', execution: outcome.execution };
    case 'ForgetRefused':
      return { _tag: 'Refused', execution: outcome.execution, reason: outcome.reason, detail: outcome.detail };
    case 'ForgetUnresolved':
      return { _tag: 'Unresolved', execution: outcome.execution, reads: outcome.reads };
  }
};

const unscanned: Refusal = {
  _tag: 'UnsupportedCapability',
  reason: 'this platform supplies no process evidence',
};

const inputOf = (body: Extract<Request, { readonly _tag: 'Input' }>, payload: Uint8Array): InputRequest | undefined => {
  if (body.act._tag === 'Write' && body.act.bytes !== payload.length) return undefined;
  if (body.act._tag !== 'Write' && payload.length !== 0) return undefined;
  return {
    sequence: body.sequence,
    cause: body.cause,
    profile: body.profile,
    act:
      body.act._tag === 'Write'
        ? ({ _tag: 'Write', bytes: payload } as const)
        : body.act._tag === 'Interrupt'
          ? ({ _tag: 'Interrupt' } as const)
          : body.act._tag === 'End'
            ? ({ _tag: 'End' } as const)
            : ({ _tag: 'Resize', geometry: body.act.geometry } as const),
  };
};
