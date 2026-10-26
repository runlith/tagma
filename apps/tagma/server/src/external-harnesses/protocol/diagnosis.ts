import { Clock, Effect } from 'effect';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { describeError } from '@runlith/utils/error';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ExecutionRecords } from '../../executions/contract/service/records.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import { gated } from '../../threads/projectGate.js';
import { ProtocolStates } from '../contract/service/protocol.js';
import type { SessionThreads } from '../contract/service/sessionThreads.js';
import type { ProtocolState } from '../contract/wire/protocolState.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { ProtocolAttendance } from './attendance.js';

export type DiagnosisParts = {
  readonly store: HarnessSessionStore;
  readonly rows: ProtocolRows;
  readonly records: ExecutionRecords['Service'];
  readonly terminals: Terminals['Service'];
  readonly attendance: ProtocolAttendance;
  readonly ownerId: string;
};

export const protocolState = Effect.fnUntraced(function* (parts: DiagnosisParts, threadId: string) {
  const { store, rows, records, terminals, attendance, ownerId } = parts;
  if ((yield* store.binding(threadId))?.adapter !== 'acp') {
    return yield* new GateRefusal('protocol-unavailable', `Thread ${threadId} runs its CLI in a terminal, so it speaks no protocol.`, [
      'read its screen with read_harness_screen',
    ]);
  }
  const facet = yield* store.read(threadId);
  const row = yield* rows.load(threadId);
  const now = yield* Clock.currentTimeMillis;
  const session = facet?.session ?? null;
  const execution = facet?.execution ?? row?.execution ?? null;
  const record =
    execution === null ? null : yield* terminals.record(execution.execution, execution.incarnation).pipe(Effect.mapError(threadCallFailed));
  const output =
    record === null
      ? { written: null, unread: 'this installation no longer holds the runner record' }
      : yield* records.bytes({ ref: record.execution, stream: 'stdout', offset: ByteOffset.make('0') }, 0).pipe(
          Effect.match({
            onSuccess: (read) => ({ written: String(read.range.durableThrough), unread: null }),
            onFailure: (failure) => ({ written: null, unread: describeError(failure) }),
          }),
        );
  return {
    threadId,
    session:
      session === null
        ? null
        : {
            state: session.state,
            owner:
              session.ownerId == null
                ? ('nobody' as const)
                : session.ownerId === ownerId
                  ? ('this server' as const)
                  : ('another server' as const),
            startedAt: session.startedAt,
          },
    driven: yield* attendance.driven(threadId),
    driverFailure: attendance.died(threadId),
    execution: execution === null ? null : { execution: execution.execution, incarnation: execution.incarnation, held: record !== null },
    phase: row?.phase ?? null,
    stdout: row === null ? null : { parsed: String(row.client.cursor.offset), ...output, torn: row.client.cursor.torn },
    requests: (row?.client.requests ?? []).map((request) => {
      const sentAt = row?.sent?.[request.id] ?? null;
      return {
        id: request.id,
        method: request.meaning === 'extension' ? request.method : request.meaning,
        turn: request.meaning === 'prompt' ? request.turn : null,
        admitted: request.admitted,
        uncertain: request.uncertain,
        sentAt,
        ageMs: sentAt === null ? null : Math.max(0, now - Date.parse(sentAt)),
      };
    }),
    asks: (row?.client.asks ?? [])
      .filter((ask) => ask.answer === null)
      .map((ask) => ({
        id: String(ask.id),
        method: ask.kind === 'permission' ? 'session/request_permission' : ask.method,
        turn: ask.turn,
        uncertain: ask.uncertain,
      })),
    turns: (row?.turns ?? []).map((turn) => ({ runId: turn.id, startedAt: turn.startedAt })),
    failure: row?.failure ?? null,
  } satisfies ProtocolState;
});

export const protocolStates = (
  records: ThreadRecords['Service'],
  threads: SessionThreads,
  state: (threadId: string) => ReturnType<typeof protocolState>,
): ProtocolStates['Service'] =>
  ProtocolStates.of({
    read: (threadId, projectId) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          if ((yield* threads.find(threadId, OPERATOR_PRINCIPAL))?.harness == null) {
            return yield* new GateRefusal(
              'not-a-harness-thread',
              `Thread ${threadId} runs an agent of this server, so it speaks no protocol.`,
              ['read the thread itself'],
            );
          }
          return yield* state(threadId);
        }),
      ),
  });
