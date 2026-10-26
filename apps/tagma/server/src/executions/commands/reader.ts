import { Clock, Effect } from 'effect';
import type { CommandBatch, CommandEntry, CommandRefs } from '@runlith/executions/protocol/inventory';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { HostMemory } from '@runlith/executions/protocol/runtime';
import type { Commands } from '@runlith/executions/Commands';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { command, commandWait } from '../store/terminal.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import type { OperationKeyRetention } from '../contract/wire/requestKeys.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import type { CommandLives, CommandPage } from '../contract/service/commands.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import type {
  CommandHostAnswer,
  CommandListAnswer,
  CommandLive,
  CommandReading,
  CommandSelection,
  CommandView,
} from '../contract/wire/commands.js';
import { mintCursor, positionOf, readCursor, selectionKey } from './cursor.js';
import type { CommandMarks, CommandRows } from '../store/commandRows.js';
import type { CommandState } from '../store/rows.js';
import type { RequestKeys } from '../store/requestKeys.js';

type HostRead =
  | {
      readonly _tag: 'Answered';
      readonly asked: CommandBatch | undefined;
      readonly memory: HostMemory;
      readonly readAt: number;
    }
  | { readonly _tag: 'Unavailable'; readonly detail: string };

export const viewOf = (record: CommandRecord): CommandView => ({
  projectId: record.projectId,
  execution: record.execution,
  owner: record.owner,
  origin: record.origin,
  policyIdentity: record.policyIdentity,
  label: record.label,
  commandLine: record.commandLine,
  program: record.program,
  cwd: record.cwd,
  time: record.time,
  rootId: record.rootId,
  admittedAt: record.admittedAt,
});

const livesOf = (host: HostRead): CommandLives => {
  if (host._tag === 'Unavailable') {
    const live: CommandLive = { _tag: 'Unavailable', detail: host.detail };
    return { live: () => live, host: answerOf(host) };
  }
  const entries = new Map<string, CommandEntry>((host.asked?.commands ?? []).map((entry) => [entry.state.ref.execution, entry]));
  return {
    live: (execution) => {
      const entry = entries.get(execution.execution);
      return entry === undefined ? { _tag: 'Unheld' } : { _tag: 'Held', entry, readAt: host.readAt };
    },
    host: answerOf(host),
  };
};

export const readingOf = (standing: CommandState, live: CommandLive, view?: CommandView): CommandReading => ({
  command: view ?? viewOf(standing.record),
  wait: standing.wait ?? undefined,
  live,
});

export type StoredCommands = Effect.Success<ReturnType<typeof makeStoredCommands>>;

export const makeStoredCommands = Effect.fnUntraced(function* ({
  commandRows,
  requestKeys,
  host,
}: {
  readonly commandRows: CommandRows;
  readonly requestKeys: RequestKeys;
  readonly host: Commands['Service'] & HostLifecycle['Service'];
}) {
  const units = yield* MachineUnits;
  const marked = (yield* MachineStore).moves.answers<number, CommandMarks>([command, commandWait]);

  const batched = Effect.fn('CommandReader.batched')(function* (refs: readonly ExecutionRef[]) {
    let merged: CommandBatch | undefined = undefined;
    for (const chunk of chunksOf(refs)) {
      const batch: CommandBatch = yield* host.commandsAt(chunk);
      merged =
        merged === undefined
          ? batch
          : {
              commands: [...merged.commands, ...batch.commands],
              revision: Math.min(merged.revision, batch.revision),
              unmeasured: [...merged.unmeasured, ...batch.unmeasured],
            };
    }
    return merged as CommandBatch;
  });

  const read = Effect.fn('CommandReader.read')(function* (refs: readonly ExecutionRef[]): Effect.fn.Return<HostRead> {
    const status = yield* Effect.result(host.status());
    if (status._tag === 'Failure') return { _tag: 'Unavailable', detail: failureDetail(status.failure) };
    const mine = refs.filter((ref) => ref.installation === status.success.installation && ref.incarnation === status.success.incarnation);
    const asked = mine.length === 0 ? undefined : yield* Effect.result(batched(mine));
    if (asked !== undefined && asked._tag === 'Failure') return { _tag: 'Unavailable', detail: failureDetail(asked.failure) };
    return {
      _tag: 'Answered',
      asked: asked === undefined ? undefined : asked.success,
      memory: status.success.memory,
      readAt: yield* Clock.currentTimeMillis,
    };
  });

  const rows = Effect.fn('CommandReader.rows')(function* (
    projectId: number,
    selection: CommandSelection,
  ): Effect.fn.Return<CommandPage, TerminalFailure> {
    const filters = selectionKey(projectId, selection);
    const after = selection.after === undefined ? undefined : yield* at(selection.after, filters);
    const page = yield* units.read((unit) =>
      commandRows.commandPage(unit, projectId, {
        owner: selection.owner,
        standing: selection.standing,
        order: selection.order,
        after: after,
        limit: selection.limit + 1,
      }),
    );
    const carried = page.slice(0, selection.limit);
    const last = page.length > selection.limit ? carried.at(-1) : undefined;
    return {
      rows: carried,
      after: last === undefined ? undefined : mintCursor(filters, positionOf(last.record)),
    };
  });

  const lives = Effect.fn('CommandReader.lives')(function* (refs: readonly ExecutionRef[]) {
    return livesOf(yield* read(refs));
  });

  const operationKeys = Effect.fn('CommandReader.operationKeys')(function* (): Effect.fn.Return<OperationKeyRetention, TerminalFailure> {
    return yield* units.read((unit) => requestKeys.keyRetention(unit));
  });

  return {
    page: Effect.fn('CommandReader.page')(function* (
      projectId: number,
      selection: CommandSelection,
    ): Effect.fn.Return<CommandListAnswer, TerminalFailure> {
      const carried = yield* rows(projectId, selection);
      const known = yield* lives(carried.rows.map((standing) => standing.record.execution));
      return {
        readings: carried.rows.map((standing) => readingOf(standing, known.live(standing.record.execution))),
        after: carried.after,
        host: known.host,
        operationKeys: yield* operationKeys(),
      };
    }),
    rows,
    lives,
    operationKeys,
    marks: Effect.fn('CommandReader.marks')(function* (projectId: number): Effect.fn.Return<CommandMarks, TerminalFailure> {
      return yield* marked.read(
        projectId,
        units.read((unit) => commandRows.commandMarks(unit, projectId)),
      );
    }),
    one: Effect.fn('CommandReader.one')(function* (
      projectId: number,
      execution: string,
      incarnation: number,
    ): Effect.fn.Return<CommandReading, TerminalFailure> {
      const standing = yield* units.read((unit) => commandRows.commandState(unit, execution));
      if (standing === null || standing.record.projectId !== projectId || standing.record.execution.incarnation !== incarnation) {
        return yield* new TerminalRefused({
          reason: 'no-command',
          message: `This installation holds no command under ${execution} at incarnation ${incarnation}; read the inventory again.`,
        });
      }
      return readingOf(standing, livesOf(yield* read([standing.record.execution])).live(standing.record.execution));
    }),
  };
});

const COMMAND_BATCH_REFS = 50;

const chunksOf = (refs: readonly ExecutionRef[]): ReadonlyArray<CommandRefs> => {
  const chunks: ExecutionRef[][] = [];
  for (let at = 0; at < refs.length; at += COMMAND_BATCH_REFS) chunks.push(refs.slice(at, at + COMMAND_BATCH_REFS));
  return chunks;
};

const failureDetail = (failure: ExecutionsFailure): string => {
  if (failure.message !== '') return failure.message;
  const { _tag, ...fields } = failure;
  return `${_tag} ${JSON.stringify(fields)}`;
};

const answerOf = (host: HostRead): CommandHostAnswer =>
  host._tag === 'Answered'
    ? {
        _tag: 'Answered',
        revision: host.asked === undefined ? undefined : host.asked.revision,
        memory: host.memory,
        unmeasured: host.asked?.unmeasured ?? [],
      }
    : { _tag: 'Unavailable', detail: host.detail };

const at = (cursor: string, filters: string) =>
  Effect.suspend(() => {
    const read = readCursor(cursor);
    if (read === null || read.filters !== filters) {
      return Effect.fail(
        new TerminalRefused({
          reason: 'selection-changed',
          message: 'This cursor names a position in another walk: a page is continued only under the selection that produced its cursor.',
        }),
      );
    }
    return Effect.succeed(read.at);
  });
