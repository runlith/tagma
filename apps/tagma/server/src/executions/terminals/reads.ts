import { MachineUnits } from '../../platform/contract/service/units.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalInventory } from './inventory.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { CommandRows } from '../store/commandRows.js';
import { TerminalRows } from '../store/terminalRows.js';
import { Executions, HostRefused } from '@runlith/executions/Executions';
import { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import { ExecutionRecord } from '@runlith/executions/ExecutionRecord';
import { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import { TerminalScreen } from '@runlith/executions/TerminalScreen';
import { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { TableAnswers } from '../../platform/store/moves.js';
import type { TerminalListing } from '../store/terminalRows.js';
import { terminal } from '../store/terminal.js';
import { Clock, Effect, Stream } from 'effect';
import type { ExecutionRef, Incarnation, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { ListenerSnapshot } from '@runlith/executions/protocol/evidence';
import type { HeldReading } from './inventory.js';
import type { FrameRevision, ScreenPointRead, ScreenRead, ScreenFeedItem } from '@runlith/executions/protocol/presentation';
import type { RecordChunk } from '../contract/wire/viewLeases.js';
import { ByteOffset, offsetValue, type ByteCursor } from '@runlith/executions/protocol/record';
import type { SubscriptionEnding } from '@runlith/executions/protocol/wire';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import { operationPhase, type TerminalOperationDigest, type TerminalOperationState } from '../contract/wire/requestKeys.js';
import { principalOf } from './principals.js';
import {
  terminalView,
  type TerminalActor,
  type TerminalRow,
  type TerminalListQuery,
  type TerminalRecord,
} from '../contract/wire/terminals.js';
import { executionRecordCredits, executionWireLimits } from '../host/policy.js';
import { shellDigest } from '../../platform/credentials/grants.js';
import type { Unit } from '../../platform/contract/service/units.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import type { ExecutionHandle, TerminalFailure } from '../contract/service/terminals.js';
import type { BytesOptions } from '../contract/service/records.js';
import type { CommandCall, StartedCommand } from '../contract/service/commands.js';
import { writes } from '../../platform/contract/service/writes.js';
import { terminalIntent, terminalRequestKey, terminalRequestKeyTally } from '../store/terminal.js';
import { refKey, type StopDispatches } from './refs.js';
import { INVENTORY_PAGE } from '../store/terminalRows.js';
import { lostState } from '../host/generationEnded.js';
import * as capacity from '@runlith/executions/protocol/capacity';

export const makeCommandRecord = Effect.gen(function* () {
  const units = yield* MachineUnits;
  const rows = yield* CommandRows;
  return Effect.fn('Terminals.commandRecord')(function* (
    executionId: string,
    incarnation?: Incarnation,
  ): Effect.fn.Return<CommandRecord | null, TerminalFailure> {
    const row = yield* units.read((unit) => rows.recordCommand(unit, executionId));
    if (row === null) return null;
    return incarnation === undefined || row.execution.incarnation === incarnation ? row : null;
  });
});

export const makeTerminalRecord = Effect.gen(function* () {
  const units = yield* MachineUnits;
  const rows = yield* TerminalRows;
  return Effect.fn('Terminals.record')(function* (executionId: string, incarnation?: Incarnation) {
    const row = yield* units.read((unit) => rows.record(unit, executionId));
    if (row === null) return null;
    return incarnation === undefined || row.execution.incarnation === incarnation ? row : null;
  });
});

export const makeTerminalReads = Effect.fnUntraced(function* ({
  installation,
  dispatches,
}: {
  readonly installation: InstallationId;
  readonly dispatches: StopDispatches;
}) {
  const units = yield* MachineUnits;
  const requestKeys = yield* RequestKeys;
  const cell = yield* TerminalInventory;
  const intents = yield* TerminalIntents;
  const terminalRows = yield* TerminalRows;
  const host = yield* Executions;
  const executionRequest = yield* ExecutionRequest;
  const executionRecord = yield* ExecutionRecord;
  const executionFeed = yield* ExecutionFeed;
  const terminalScreen = yield* TerminalScreen;
  const hostLifecycle = yield* HostLifecycle;
  const ref = (operation: HostRequestKey) => ({ installation, operation });
  const record = yield* makeTerminalRecord;
  const commandRecord = yield* makeCommandRecord;
  const commandRows = yield* CommandRows;
  const listed: TableAnswers<string, TerminalListing> = (yield* MachineStore).moves.answers([terminal]);

  const commandStartedBy = Effect.fn('Terminals.commandStartedBy')(function* (
    projectId: number,
    call: CommandCall,
  ): Effect.fn.Return<StartedCommand | null, TerminalFailure> {
    return yield* units.read((unit) =>
      Effect.gen(function* () {
        const started = yield* commandRows.commandStartedBy(unit, projectId, call);
        if (started === null) return null;
        const key = yield* requestKeys.keyOf(unit, started.execution.execution, started.execution.incarnation);
        if (key === null) {
          return yield* new TerminalUnavailable({
            owner: 'store',
            message: `Command ${started.execution.execution} stands without the key it was started under, so its start cannot be named.`,
          });
        }
        return { record: started, operation: key.operationId };
      }),
    );
  });

  const operation = Effect.fn('Terminals.operation')(function* (
    projectId: number,
    operationId: HostRequestKey,
  ): Effect.fn.Return<TerminalOperationState, TerminalFailure> {
    const local = yield* units.read((unit) => requestKeys.operation(unit, projectId, operationId));
    if (
      local._tag === 'Unknown' ||
      local._tag === 'Expired' ||
      local._tag === 'Settled' ||
      local.key.mutation === 'write' ||
      local.key.mutation === 'interrupt' ||
      local.key.mutation === 'resize'
    )
      return local;
    if (local.key.mutation === 'stop' && dispatches.has(projectId, operationId)) return local;
    const answer = yield* executionRequest.operation(ref(operationId));
    switch (answer._tag) {
      case 'Accepted': {
        const execution = answer.execution;
        if (execution === undefined) return local;
        yield* units.write(writes('reads.operation', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
          requestKeys.admit(unit, projectId, operationId, execution),
        );
        yield* cell.invalidate(projectId);
        return { _tag: 'Admitted', key: local.key, execution };
      }
      case 'Cancelled':
      case 'Refused':
        yield* units.write(writes('reads.operation', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]), (unit) =>
          intents.settle(unit, projectId, operationId, { _tag: 'Settled' }),
        );
        return { _tag: 'Settled', key: local.key };
      case 'Uncertain':
        yield* units.write(writes('reads.operation', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
          intents.settle(unit, projectId, operationId, { _tag: 'Uncertain', effect: answer.effect }),
        );
        return { _tag: 'Uncertain', key: local.key, effect: answer.effect };
      case 'Unanswered': {
        if (local.key.mutation !== 'stop' || local.key.execution === undefined) return local;
        const unresolved = yield* units.write(writes('reads.operation', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
          Effect.gen(function* () {
            const standing = yield* requestKeys.operation(unit, projectId, operationId);
            if (standing._tag !== 'Pending') return standing;
            const effect = { _tag: 'InFlight' as const, operation: ref(operationId) };
            yield* intents.settle(unit, projectId, operationId, { _tag: 'Uncertain', effect });
            return { _tag: 'Uncertain' as const, key: standing.key, effect };
          }),
        );
        if (unresolved._tag !== 'Uncertain') return unresolved;
        const prevention = yield* executionRequest.preventStop(ref(operationId), local.key.execution);
        if (prevention._tag === 'Taken') return unresolved;
        if (prevention._tag === 'Refused') return yield* new HostRefused({ refusal: prevention.refusal });
        const settlement =
          prevention._tag === 'Prevented' ? { _tag: 'Settled' as const } : { _tag: 'Uncertain' as const, effect: prevention.effect };
        yield* units.write(writes('reads.operation', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]), (unit) =>
          intents.settle(unit, projectId, operationId, settlement),
        );
        return { ...settlement, key: unresolved.key };
      }
    }
  });

  const operationFor = Effect.fn('Terminals.operationFor')(function* (
    actor: TerminalActor,
    projectId: number,
    operationId: HostRequestKey,
  ) {
    const state = yield* operation(projectId, operationId);
    const key = state._tag === 'Unknown' || state._tag === 'Expired' ? null : state.key;
    if (key !== null && key.requester === principalOf(actor)) return { _tag: 'Whole' as const, state };
    const mutation = key?.mutation ?? (state._tag === 'Expired' ? state.mutation : null);
    const digest: TerminalOperationDigest = {
      operation: ref(operationId),
      mutation: mutation ?? undefined,
      phase: operationPhase(state),
    };
    if (state._tag !== 'Admitted' && !(state._tag === 'Settled' && state.execution !== undefined)) {
      return { _tag: 'Digest' as const, digest };
    }
    const execution = state._tag === 'Admitted' ? state.execution : state.execution;
    const seen = execution === undefined ? null : yield* record(execution.execution, execution.incarnation);
    return seen === null || seen.projectId !== projectId || execution === undefined
      ? { _tag: 'Digest' as const, digest }
      : { _tag: 'Digest' as const, digest: { ...digest, execution } };
  });

  const recordsOf = Effect.fn('Terminals.recordsOf')(function* (refs: readonly ExecutionHandle[]) {
    const rows = yield* units.read((unit) =>
      terminalRows.records(
        unit,
        refs.map((ref) => ref.execution),
      ),
    );
    const held = new Map<string, TerminalRecord>();
    for (const ref of refs) {
      const row = rows.get(ref.execution);
      if (row !== undefined && row.execution.incarnation === ref.incarnation) held.set(ref.execution, row);
    }
    return held;
  });

  const shell = Effect.fn('Terminals.shell')(function* (key: string, unit?: Unit<'machine'>) {
    const digest = shellDigest(key);
    return yield* unit === undefined ? units.read((read) => terminalRows.shell(read, digest)) : terminalRows.shell(unit, digest);
  });

  const stopAsked = Effect.fn('Terminals.stopAsked')(function* (execution: ExecutionRef) {
    return yield* units.read((unit) => requestKeys.stopAsked(unit, execution));
  });

  const inventory = Effect.fn('Terminals.inventory')(function* (projectId: number, query: TerminalListQuery) {
    const read = units.read((unit) => terminalRows.inventory(unit, projectId, query));
    const whole = query.after === undefined && query.holder === undefined && query.execution === undefined;
    const { records, total } =
      listed === null || !whole
        ? yield* read
        : yield* listed.read(JSON.stringify([projectId, query.standing ?? true, query.limit ?? INVENTORY_PAGE]), read);
    if (records.length === 0) return { terminals: [], total, stale: false };
    const held = yield* cell.of(projectId);
    const listening = new Map<string, ListenerSnapshot[]>();
    for (const socket of held.listeners?.listeners ?? []) {
      const owner = socket.association?.execution;
      if (owner === undefined) continue;
      const key = refKey(owner);
      const kept = listening.get(key);
      if (kept === undefined) listening.set(key, [socket]);
      else kept.push(socket);
    }
    const current = yield* generation();
    const terminals = records.map((record): TerminalRow => {
      const state = held.stateOf(record.execution) ?? lostState(record, current);
      const view = terminalView(record);
      if (state === undefined) return { record: view };
      const printed = held.printed(record.execution);
      if (held.listeners === undefined) return { record: view, state, printed };
      return {
        record: view,
        state,
        listeners: { ...held.listeners, listeners: listening.get(refKey(record.execution)) ?? [] },
        printed,
      };
    });
    return { terminals, total, stale: held.stale };
  });

  const generation = Effect.fn('Terminals.generation')(function* () {
    const standing = yield* Effect.result(hostLifecycle.generation());
    if (standing._tag === 'Failure') {
      yield* Effect.logDebug('the host generation is unread; no terminal is judged lost with its host', { reason: standing.failure._tag });
      return null;
    }
    return standing.success;
  });

  const lostWithHost = Effect.fn('Terminals.lostWithHost')(function* (execution: ExecutionRef) {
    const current = yield* generation();
    return current !== null && execution.incarnation < current;
  });

  const lost = Effect.fn('Terminals.lost')(function* (record: TerminalRecord) {
    return lostState(record, yield* generation()) ?? null;
  });

  const ledger = Effect.fn('Terminals.ledger')(function* () {
    const standing = yield* Effect.result(hostLifecycle.status());
    if (standing._tag === 'Failure') {
      yield* Effect.logDebug('the host status is unread; the listing carries no host ledger', { reason: standing.failure._tag });
      return undefined;
    }
    return standing.success.memory;
  });

  const keyRetention = () => units.read((unit) => requestKeys.keyRetention(unit));

  const offersCommands = Effect.fn('Terminals.offersCommands')(function* () {
    const offered = yield* Effect.result(hostLifecycle.capabilities());
    if (offered._tag === 'Failure') {
      yield* Effect.logDebug('the host capabilities are unread; commands are not offered through the host', {
        reason: offered.failure._tag,
      });
      return false;
    }
    return capacity.offersCommands(offered.success);
  });

  const bytes = Effect.fn('Terminals.bytes')(function* (cursor: ByteCursor, limit: number, options?: BytesOptions) {
    if (limit === 0) {
      const at = cursor.offset;
      const positions = yield* streamPositions(cursor);
      if (positions !== undefined) {
        return {
          range: {
            cursor,
            next: at,
            retainedFrom: positions.retainedFrom,
            durableThrough: positions.durableThrough,
            gap: offsetValue(at) < offsetValue(positions.retainedFrom),
          },
          positions,
          bytes: new Uint8Array(0),
        };
      }
      const chunk = yield* executionRecord.read(cursor, 1);
      return { range: chunk.range, bytes: chunk.bytes };
    }
    const chunk = yield* executionRecord.read(cursor, limit);
    if (options?.withPositions !== true) return { range: chunk.range, bytes: chunk.bytes };
    const positions = yield* streamPositions(cursor);
    return {
      range: chunk.range,
      positions: positions,
      bytes: chunk.bytes,
    };
  });

  const streamPositions = Effect.fn('Terminals.streamPositions')(function* (cursor: ByteCursor) {
    if (yield* lostWithHost(cursor.ref)) return undefined;
    const summary = yield* host.state(cursor.ref);
    return summary?.streams.find((stream) => stream.stream === cursor.stream);
  });

  const screen = Effect.fn('Terminals.screen')(function* (execution: ExecutionRef, request?: ScreenRead) {
    const answer = yield* terminalScreen.screen(execution, request);
    yield* Effect.annotateCurrentSpan({ bytes: Buffer.byteLength(JSON.stringify(answer), 'utf8') });
    return answer;
  });

  const point = Effect.fn('Terminals.point')(function* (execution: ExecutionRef, request: ScreenPointRead) {
    const pointed = yield* terminalScreen.point(execution, request);
    yield* Effect.annotateCurrentSpan({ bytes: pointed._tag === 'ScreenPoint' ? pointed.bytes.length : 0 });
    return pointed;
  });

  const screens = (execution: ExecutionRef, base?: FrameRevision): Stream.Stream<ScreenFeedItem, TerminalFailure> =>
    executionFeed.subscribe({ _tag: 'Screen', execution, base: base }, executionWireLimits.credits).pipe(
      Stream.map((delivery) =>
        delivery._tag === 'Screen'
          ? delivery.update
          : delivery._tag === 'Ended' && delivery.ending !== 'cancelled'
            ? ended(execution, delivery.ending)
            : null,
      ),
      Stream.filter((update): update is ScreenFeedItem => update !== null),
    );

  const settled = (execution: ExecutionRef, quietMs: number): Stream.Stream<void, TerminalFailure> =>
    executionFeed.subscribe({ _tag: 'ScreenSettled', execution, quietMs }, executionWireLimits.credits).pipe(
      Stream.takeWhile((delivery) => delivery._tag === 'ScreenSettled'),
      Stream.as(undefined),
    );

  const records = (cursor: ByteCursor): Stream.Stream<RecordChunk, TerminalFailure> =>
    Stream.unwrap(
      Effect.map(lostWithHost(cursor.ref), (lost): Stream.Stream<RecordChunk, TerminalFailure> =>
        lost
          ? Stream.fail(
              new TerminalRefused({
                reason: 'record-lost',
                message: `execution ${cursor.ref.execution} belongs to host generation ${cursor.ref.incarnation}, which ended (generation-ended); its live tail is gone, so read its retained bytes by key`,
              }),
            )
          : executionFeed.subscribe({ _tag: 'Bytes', cursor }, executionRecordCredits).pipe(
              Stream.tap((delivery) =>
                delivery._tag === 'Bytes'
                  ? Effect.withSpan(Effect.void, 'Terminals.records', {
                      attributes: { 'chunk.bytes': delivery.bytes.length },
                    })
                  : Effect.void,
              ),
              Stream.map((delivery): RecordChunk | null =>
                delivery._tag === 'Bytes'
                  ? { _tag: 'Bytes', range: delivery.range, bytes: delivery.bytes }
                  : delivery._tag === 'Ended' && delivery.ending !== 'cancelled'
                    ? { _tag: 'Ended', ending: delivery.ending }
                    : null,
              ),
              Stream.filter((chunk): chunk is RecordChunk => chunk !== null),
            ),
      ),
    );

  const ended = (execution: ExecutionRef, ending: SubscriptionEnding): ScreenFeedItem => ({
    _tag: 'ScreenUnavailable',
    ref: execution,
    parsedThrough: ByteOffset.make('0'),
    reason: 'closed',
    ending,
    detail: `this screen subscription ended: ${ending}`,
  });

  return {
    operation,
    operationFor,
    commandRecord,
    commandStartedBy,
    record,
    recordsOf,
    shell,
    stopAsked,
    inventory,
    lost,
    ledger,
    keyRetention,
    offersCommands,
    bytes,
    screen,
    point,
    screens,
    settled,
    records,
  };
});
