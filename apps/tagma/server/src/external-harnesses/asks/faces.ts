import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalScreens } from '../../executions/contract/service/records.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { harnessSessionActive, ALLOW_ONCE, DENY } from '../../threads/contract/wire/harness/session.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessLanes } from '../sessions/lanes.js';
import { readHarnessFrame, typeHarnessKeys, waitForWidget, widgetOn } from '../sessions/keyboard.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { AskFaces, Typed } from './terminal.js';

const UNKNOWN_CODES: ReadonlySet<string> = new Set(['input-uncertain', 'input-doubt']);

export function terminalFaces(
  sessions: HarnessSessionStore,
  terminals: Terminals['Service'],
  screens: TerminalScreens['Service'],
  writing: TerminalWriting['Service'],
  lanes: HarnessLanes,
  adapters: HarnessAdapters['Service'],
): AskFaces {
  type Standing = { readonly facet: ExternalSession; readonly sessionId: string; readonly execution: HarnessExecutionRef };
  const rowOf = (held: Standing) => adapters.row(held.facet.name, held.facet.presentation.install);
  const standing = (threadId: string): Effect.Effect<Standing | null, HarnessFailure> =>
    Effect.map(sessions.read(threadId), (facet) =>
      facet !== null && harnessSessionActive(facet.session) && facet.execution !== null
        ? { facet, sessionId: facet.session.id, execution: facet.execution }
        : null,
    );
  return {
    widget: Effect.fnUntraced(function* (threadId) {
      const held = yield* standing(threadId);
      if (held === null) return null;
      return widgetOn(yield* rowOf(held), yield* readHarnessFrame(terminals, screens, held.execution));
    }),
    keys: Effect.fnUntraced(function* (threadId, widget, values, permission) {
      const held = yield* standing(threadId);
      if (held === null) return null;
      const adapter = yield* rowOf(held);
      if (!permission || values.length !== 1) return adapter.keysOf(widget, values);
      if (values[0] === DENY) return adapter.cancelKeysOf(widget);
      const first = widget.options[0]?.value;
      if (values[0] === ALLOW_ONCE) return first === undefined ? null : adapter.keysOf(widget, [first]);
      return adapter.keysOf(widget, values);
    }),
    type: Effect.fnUntraced(function* (threadId, keys, operation) {
      const ready = yield* Effect.result(
        Effect.gen(function* () {
          const found = yield* standing(threadId);
          return found === null ? null : { held: found, lane: yield* lanes.of(found.sessionId) };
        }),
      );
      if (ready._tag === 'Failure') {
        yield* Effect.logWarning('a terminal answer could not acquire its typing lane before any keys were sent', {
          threadId,
          failure: String(ready.failure),
        });
        return 'unwritten' as const;
      }
      if (ready.success === null) return 'unwritten' as const;
      const { held, lane } = ready.success;
      if (lane.spent(operation)) return 'unknown' as const;
      const typed = yield* Effect.result(
        lanes.typing(held.sessionId, (current) => typeHarnessKeys(terminals, screens, writing, current, held.execution, keys, operation)),
      );
      if (typed._tag === 'Success') return 'admitted' as const;
      const failure = typed.failure;
      yield* Effect.logWarning('a terminal answer did not finish typing its keys', { threadId, failure: String(failure) });
      return (failure instanceof GateRefusal && UNKNOWN_CODES.has(failure.code) ? 'unknown' : 'unwritten') satisfies Typed;
    }),
    left: Effect.fnUntraced(function* (threadId, widget) {
      const held = yield* standing(threadId);
      if (held === null) return 'unreadable' as const;
      const adapter = yield* rowOf(held);
      const ended = sessions.wait(threadId, (facet) => facet.session?.id !== held.sessionId || !harnessSessionActive(facet.session));
      return yield* Effect.raceFirst(waitForWidget(terminals, screens, held.execution, adapter, widget), Effect.as(ended, 'gone' as const));
    }),
  };
}
