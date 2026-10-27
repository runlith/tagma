import { Clock, Context, Duration, Effect, Tracer } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputCause, InputInstruction, InputReceipt } from '@runlith/executions/protocol/input';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { terminalWriter } from '../store/terminal.js';
import { executionPolicy } from '../host/policy.js';
import type { GrantRoad } from '../contract/service/grants.js';
import type { TypedBy } from '../contract/service/writing.js';
import { TerminalRows } from '../store/terminalRows.js';

export const WRITER_PERSIST_MS = 60_000;

const REMEMBERED_RECEIPTS = executionPolicy.execution.input.receipts;

const OPERATOR = Principal.make('operator');

const NOT_TYPING: ReadonlySet<InputCause> = new Set<InputCause>(['resize', 'reply', 'end']);

type Mark = {
  at: number;
  stored: number | null;
  due: number;
  trailing: boolean;
};

type Held = {
  readonly execution: ExecutionRef;
  readonly writers: Map<Principal, Mark>;
  readonly receipts: Set<string>;
};

const keyOf = (execution: ExecutionRef): string => `${execution.installation}/${execution.execution}/${execution.incarnation}`;

export const typedInto = (writer: Principal, road: GrantRoad | null, cause: InputCause, act: InputInstruction['_tag']): boolean =>
  road !== 'harness' && act !== 'Resize' && !NOT_TYPING.has(cause) && !(writer === OPERATOR && cause === 'raw');

export type TerminalWriters = Effect.Success<ReturnType<typeof makeTerminalWriters>>;

export const TerminalWriters = Context.Service<TerminalWriters | null>('tagma/executions/TerminalWriters');

export const makeTerminalWriters = Effect.fn('TerminalWriters.make')(function* ({
  everyMs = WRITER_PERSIST_MS,
}: {
  readonly everyMs?: number;
} = {}) {
  const terminalRows = yield* TerminalRows;
  const units = yield* MachineUnits;
  const scope = yield* Effect.scope;
  const holding = new Map<string, Held>();

  const fork = (work: Effect.Effect<void>): Effect.Effect<void> =>
    Effect.asVoid(
      Effect.forkIn(
        Effect.updateContext(work, (context: Context.Context<never>) => Context.omit(Tracer.ParentSpan)(context)),
        scope,
      ),
    );

  const trail = (held: Held, writer: Principal, mark: Mark): Effect.Effect<void> => {
    if (mark.trailing) return Effect.void;
    mark.trailing = true;
    const key = keyOf(held.execution);
    return fork(
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(Math.max(0, mark.due - (yield* Clock.currentTimeMillis))));
        mark.trailing = false;
        if (holding.get(key)?.writers.get(writer) !== mark || mark.stored === mark.at) return;
        mark.due = (yield* Clock.currentTimeMillis) + everyMs;
        yield* persist(held.execution, writer, mark, held);
      }),
    );
  };

  const persist = (execution: ExecutionRef, writer: Principal, mark: Mark, retried?: Held): Effect.Effect<void> => {
    const at = mark.at;
    return units
      .write(writes('TerminalWriters.persist', [terminalWriter]), (unit) => terminalRows.markWriter(unit, execution, writer, at))
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (mark.stored === null || at > mark.stored) mark.stored = at;
          }),
        ),
        Effect.catch((failure) =>
          Effect.logWarning('a terminal writer note was not persisted', {
            execution: execution.execution,
            writer,
            reason: failure._tag,
          }).pipe(Effect.andThen(retried === undefined ? Effect.void : trail(retried, writer, mark))),
        ),
        Effect.withSpan('TerminalWriters.persist', { attributes: { execution: execution.execution, writer } }),
      );
  };

  const unstored = (held: Held): Effect.Effect<void> =>
    Effect.forEach(
      [...held.writers].filter(([, mark]) => mark.stored !== mark.at),
      ([writer, mark]) => persist(held.execution, writer, mark),
      { discard: true },
    );

  yield* Effect.addFinalizer(() => Effect.forEach([...holding.values()], unstored, { discard: true }));

  return {
    admitted: Effect.fnUntraced(function* (execution: ExecutionRef, writer: Principal, receipt: InputReceipt, given?: number) {
      const at = given ?? (yield* Clock.currentTimeMillis);
      const held = holding.get(keyOf(execution)) ?? { execution, writers: new Map<Principal, Mark>(), receipts: new Set<string>() };
      holding.set(keyOf(execution), held);
      if (held.receipts.has(receipt.acceptedThrough)) return;
      held.receipts.add(receipt.acceptedThrough);
      if (held.receipts.size > REMEMBERED_RECEIPTS) {
        const oldest = held.receipts.values().next();
        if (!oldest.done) held.receipts.delete(oldest.value);
      }
      const mark = held.writers.get(writer) ?? { at, stored: null, due: 0, trailing: false };
      held.writers.set(writer, mark);
      if (at > mark.at) mark.at = at;
      if (at < mark.due) return yield* trail(held, writer, mark);
      mark.due = at + everyMs;
      yield* fork(persist(held.execution, writer, mark, held));
    }),
    others: Effect.fnUntraced(function* (execution: ExecutionRef, reader: Principal | null) {
      const stored = yield* units.read((unit) => terminalRows.writers(unit, execution));
      const newest = new Map<Principal, number>();
      for (const row of stored) newest.set(row.writer, row.at);
      for (const [writer, mark] of holding.get(keyOf(execution))?.writers ?? []) {
        newest.set(writer, Math.max(newest.get(writer) ?? 0, mark.at));
      }
      return [...newest]
        .filter(([writer]) => writer !== reader)
        .map(([writer, at]): TypedBy => ({ writer, at }))
        .sort((one, other) => other.at - one.at);
    }),
    ended: (execution: ExecutionRef): Effect.Effect<void> =>
      Effect.suspend(() => {
        const key = keyOf(execution);
        const held = holding.get(key);
        if (held === undefined) return Effect.void;
        holding.delete(key);
        return fork(unstored(held));
      }),
  };
});
