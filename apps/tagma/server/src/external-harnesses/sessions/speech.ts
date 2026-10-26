import { Effect } from 'effect';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalScreens } from '../../executions/contract/service/records.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import { gated } from '../../threads/projectGate.js';
import { HarnessSpeech, ScreenAsks } from '../contract/service/speech.js';
import type { HarnessSessions } from '../contract/service/sessions.js';
import type { SessionThreads } from '../contract/service/sessionThreads.js';

const visibleText = (lines: readonly string[]): string => {
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.trim() === '') end -= 1;
  return lines.slice(0, end).join('\n');
};

export function harnessSpeech(
  records: ThreadRecords['Service'],
  threads: SessionThreads,
  sessions: HarnessSessions['Service'],
  wrote: (threadId: string) => Effect.Effect<void>,
): HarnessSpeech['Service'] {
  return HarnessSpeech.of({
    speak: (threadId, projectId, text) =>
      gated(records, threadId, projectId, () =>
        Effect.tap(
          Effect.gen(function* () {
            if ((yield* threads.find(threadId, OPERATOR_PRINCIPAL))?.harness == null) {
              return yield* new GateRefusal(
                'not-a-harness-thread',
                `Thread ${threadId} runs an agent of this server — words go to it as a turn, not to a CLI.`,
                ['send a turn to this thread instead'],
              );
            }
            return yield* sessions.send(threadId, text);
          }),
          () => wrote(threadId),
        ),
      ),
  });
}

export function screenTexts(
  records: ThreadRecords['Service'],
  threads: SessionThreads,
  terminals: Terminals['Service'],
  screens: TerminalScreens['Service'],
): ScreenAsks['Service'] {
  return ScreenAsks.of({
    text: (threadId, projectId) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          const row = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
          if (!row?.harness) {
            return yield* new GateRefusal(
              'not-a-harness-thread',
              `Thread ${threadId} runs an agent of this server, so it holds no terminal to read.`,
              ['read the screen of a thread opened as a harness type — harness:<name>'],
            );
          }
          const execution = row.harness.execution;
          if (execution === null) {
            return yield* new GateRefusal('screen-unavailable', `Thread ${threadId} holds no terminal.`, [
              'speak to it — words start its CLI where none runs',
            ]);
          }
          if (row.harness.session?.origin === 'adopted' && !harnessSessionActive(row.harness.session)) {
            return yield* new GateRefusal(
              'screen-unavailable',
              `The CLI of ${threadId} was adopted in operator terminal ${execution.execution} and has ended; that terminal is the operator's, not the thread's.`,
              ['read the thread’s transcript', 'start the CLI again in that terminal to adopt it anew'],
            );
          }
          const unreadable = new GateRefusal('screen-unavailable', `The screen of ${threadId} could not be read.`, [
            'read the thread to see whether its process still stands',
          ]);
          const record = yield* terminals.record(execution.execution, execution.incarnation).pipe(Effect.mapError(() => unreadable));
          if (record === null) {
            return yield* new GateRefusal('screen-unavailable', `This installation no longer holds the process of ${threadId}.`, [
              'read the thread — its session may have ended',
            ]);
          }
          const update = yield* screens.screen(record.execution).pipe(Effect.mapError(() => unreadable));
          if (update._tag === 'ScreenTextFrame') return { text: visibleText(screenLines(update)) };
          if (update._tag === 'ScreenUnavailable') {
            return yield* new GateRefusal('screen-unavailable', `No screen can be presented for ${threadId}: ${update.detail}`, [
              'read the thread to see what its process is doing',
            ]);
          }
          return yield* unreadable;
        }),
      ),
  });
}
