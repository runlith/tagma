import { TerminalEndings, type TerminalWatched, type TerminalEnding } from '../contract/service/endings.js';
import { waiters } from '@runlith/held/Waiters';
import { Duration, Effect, Exit, Queue } from 'effect';
import { CurrentCost, producerCost } from '@runlith/performance/CostLedger';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { executionHandshakeMs } from '../contract/wire/terminalBehavior.js';
import { Discharge } from '../contract/service/discharge.js';
import { Terminals } from '../contract/service/terminals.js';
import { TerminalRows } from '../store/terminalRows.js';
import { CommandRows } from '../store/commandRows.js';

const WATCH_MS = 60_000;

const REMEASURES = 3;

const RESUME_PAGE = 100;

export const makeTerminalEndings = Effect.fnUntraced(function* ({
  opened,
  ended,
}: {
  readonly opened: Queue.Dequeue<TerminalWatched>;
  readonly ended: Queue.Enqueue<ExecutionRef>;
}) {
  const terminals = yield* Terminals;
  const discharge = yield* Discharge;
  const terminalRows = yield* TerminalRows;
  const commandRows = yield* CommandRows;
  const units = yield* MachineUnits;
  const scope = yield* Effect.scope;
  const waiting = yield* waiters<string, TerminalEnding, never>({
    name: 'executions/terminal-endings',
    owner: 'executions',
    key: (key) => key,
  });
  const settled = new Map<string, TerminalEnding>();
  const started = new Set<string>();

  const decide = (watched: TerminalWatched, ending: TerminalEnding): void => {
    const key = refKey(watched.execution);
    settled.set(key, ending);
    waiting.complete(key, Exit.succeed(ending));
  };

  const settle = Effect.fn('TerminalEndings.settle')(function* (watched: TerminalWatched) {
    let said = false;
    let remeasured = 0;
    while (true) {
      const discharged = yield* producerCost(
        'TerminalEndings.discharge',
        discharge.ended(watched.projectId, watched.execution, remeasured > 0),
      ).pipe(Effect.provideService(CurrentCost, null), Effect.result);
      if (discharged._tag === 'Failure') {
        const unreached = { execution: watched.execution.execution, reason: discharged.failure._tag };
        yield* said
          ? Effect.logDebug('a decided execution could not be discharged; custody stands', unreached)
          : Effect.logWarning('a decided execution could not be discharged; custody stands', unreached);
        said = true;
        yield* Effect.sleep(Duration.millis(executionHandshakeMs));
        continue;
      }
      if (discharged.success._tag === 'Discharged') {
        yield* Queue.offer(ended, watched.execution);
        return;
      }
      const reason = discharged.success.reason;
      if (reason === 'unended' || reason === 'unresolved-operation') {
        if (!said) {
          said = true;
          yield* Effect.logInfo('an ended execution has no proof of its ending yet; the watch holds', {
            execution: watched.execution.execution,
            reason,
          });
        }
        yield* Effect.sleep(Duration.millis(executionHandshakeMs));
        continue;
      }
      if (remeasured < REMEASURES && (reason === 'residual' || reason === 'unmeasured' || reason === 'incomplete-cleanup')) {
        remeasured += 1;
        yield* Effect.sleep(Duration.millis(executionHandshakeMs));
        continue;
      }
      yield* Effect.logInfo('an ended execution keeps its custody', {
        execution: watched.execution.execution,
        reason,
        remeasured,
      });
      yield* Queue.offer(ended, watched.execution);
      return;
    }
  });

  const follow = Effect.fn('TerminalEndings.follow')(function* (watched: TerminalWatched) {
    let said = false;
    while (true) {
      const answer = yield* producerCost('TerminalEndings.wait', terminals.wait(watched.execution, WATCH_MS)).pipe(
        Effect.provideService(CurrentCost, null),
        Effect.result,
      );
      if (answer._tag === 'Failure') {
        const unreached = { execution: watched.execution.execution, reason: answer.failure._tag };
        yield* said
          ? Effect.logDebug('a terminal ending watch cannot reach the host; custody stands', unreached)
          : Effect.logWarning('a terminal ending watch cannot reach the host; custody stands', unreached);
        said = true;
        yield* Effect.sleep(Duration.millis(executionHandshakeMs));
        continue;
      }
      said = false;
      const seen = answer.success;
      if (seen._tag === 'Undecided') continue;
      if (seen._tag === 'Unwatchable') {
        decide(watched, { _tag: 'Unwatchable' });
        const lost = yield* producerCost(
          'TerminalEndings.dischargeReplaced',
          discharge.dischargeReplaced(watched.projectId, watched.execution),
        ).pipe(Effect.provideService(CurrentCost, null), Effect.result);
        if (lost._tag === 'Failure') {
          yield* Effect.logWarning('an unwatchable execution of a replaced generation was not discharged; the boot sweep discharges it', {
            execution: watched.execution.execution,
            reason: lost.failure._tag,
          });
        }
        yield* Queue.offer(ended, watched.execution);
        return;
      }
      decide(watched, { _tag: 'Decided', summary: seen.summary });
      return yield* producerCost('TerminalEndings.settle', settle(watched)).pipe(Effect.provideService(CurrentCost, null));
    }
  });

  const watch = Effect.fn('TerminalEndings.watching')(function* (watched: TerminalWatched) {
    const key = refKey(watched.execution);
    const standing = settled.get(key);
    if (standing !== undefined) {
      waiting.complete(key, Exit.succeed(standing));
      return;
    }
    if (started.has(key)) return;
    started.add(key);
    yield* Effect.forkIn(producerCost('TerminalEndings.follow', follow(watched)).pipe(Effect.provideService(CurrentCost, null)), scope);
  });

  return TerminalEndings.of({
    decided: Effect.fn('TerminalEndings.decided')(function* (watched: TerminalWatched) {
      return yield* waiting.wait(refKey(watched.execution), watch(watched));
    }),
    watch,
    resume: Effect.fn('TerminalEndings.resume')(function* () {
      const held = yield* units.read((unit) => terminalRows.held(unit));
      yield* Effect.forEach(held, (record) => watch({ projectId: record.projectId, execution: record.execution }), { discard: true });
      let after: { readonly admittedAt: number; readonly execution: string } | undefined;
      let commands = 0;
      for (;;) {
        const page = yield* units.read((unit) => commandRows.commandsHeld(unit, after, RESUME_PAGE));
        if (page.length === 0) break;
        commands += page.length;
        yield* Effect.forEach(page, (row) => watch({ projectId: row.projectId, execution: row.execution }), { discard: true });
        const last = page[page.length - 1]!;
        after = { admittedAt: last.admittedAt, execution: last.execution.execution };
      }
      return held.length + commands;
    }),
    attend: (): Effect.Effect<never> => Effect.forever(Effect.flatMap(Queue.take(opened), watch)),
  });
});

const refKey = (ref: ExecutionRef): string => `${ref.installation}/${ref.execution}/${ref.incarnation}`;
