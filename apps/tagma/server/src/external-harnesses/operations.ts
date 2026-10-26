import { Effect } from 'effect';
import type { Caller } from '../platform/contract/wire/caller.js';
import { threadIdOf } from '../platform/contract/wire/actor.js';
import { ThreadRecords, strangerRaised } from '../thread-record/contract/service/records.js';
import type { Raised } from '@runlith/agent/permissions';
import { body, pair } from '../platform/contract/service/body.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { declaredRefusals } from '../threads/refusalAnswers.js';
import { HarnessSpeech, ScreenAsks } from './contract/service/speech.js';
import { ProtocolStates } from './contract/service/protocol.js';
import { TransportSwitch } from './contract/service/transport.js';
import { ThreadList } from '../threads/contract/service/list.js';
import { HARNESS_OPERATIONS, HARNESS_OPERATION_IDS } from './contract/wire/operations.js';
import { said, type ModulePresentation } from '../platform/contract/service/presentation.js';
import { threadCalledDisplay } from '../threads/contract/wire/called.js';
import { movedDisplay, movedText, screenDisplay, screenText, spokenDisplay, spokenText } from './voice.js';

export const harnessSpoke = pair(
  HARNESS_OPERATIONS.speak_harness,
  body(HARNESS_OPERATIONS.speak_harness, {
    execute: Effect.fnUntraced(function* (input, _prepared) {
      const call = yield* yield* CurrentProject;
      const speech = yield* HarnessSpeech;
      const taken = yield* declaredRefusals(HARNESS_OPERATIONS.speak_harness)(speech.speak(input.threadId, call.project.id, input.text));
      return { status: 'spoken' as const, threadId: input.threadId, runId: taken.runId, queued: taken.status === 'queued' };
    }),
    voice: said(spokenText),
    display: spokenDisplay,
  }),
);

export const harnessScreenRead = pair(
  HARNESS_OPERATIONS.read_harness_screen,
  body(HARNESS_OPERATIONS.read_harness_screen, {
    execute: Effect.fnUntraced(function* (input, _prepared) {
      const call = yield* yield* CurrentProject;
      const screens = yield* ScreenAsks;
      const screen = yield* declaredRefusals(HARNESS_OPERATIONS.read_harness_screen)(screens.text(input.threadId, call.project.id));
      return { status: 'ok' as const, screenText: screen.text, threadId: input.threadId };
    }),
    voice: said(screenText),
    display: screenDisplay,
  }),
);

export const harnessProtocolRead = pair(
  HARNESS_OPERATIONS.read_harness_protocol,
  body(HARNESS_OPERATIONS.read_harness_protocol, {
    execute: Effect.fnUntraced(function* (input, _prepared) {
      const call = yield* yield* CurrentProject;
      const states = yield* ProtocolStates;
      const state = yield* declaredRefusals(HARNESS_OPERATIONS.read_harness_protocol)(states.read(input.threadId, call.project.id));
      return { status: 'ok' as const, ...state };
    }),
  }),
);

export const transportSet = pair(
  HARNESS_OPERATIONS.set_thread_transport,
  body<typeof HARNESS_OPERATIONS.set_thread_transport, readonly Raised[], ThreadRecords | CurrentProject | TransportSwitch | ThreadList>(
    HARNESS_OPERATIONS.set_thread_transport,
    {
      prepare: (input, caller: Caller) =>
        strangerRaised(input.threadId, threadIdOf(caller.actor), `its CLI moves to ${input.transport} anyway`),
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const switched = yield* declaredRefusals(HARNESS_OPERATIONS.set_thread_transport)(
          (yield* TransportSwitch).to(input.threadId, call.project.id, caller.actor, input.transport),
        );
        if (switched.status === 'switched') yield* (yield* ThreadList).announceThread(input.threadId);
        return { ...switched, threadId: input.threadId };
      }),
      voice: said(movedText),
      display: movedDisplay,
    },
  ),
);

export const HARNESS_PAIRS = [harnessSpoke, harnessScreenRead, harnessProtocolRead, transportSet] as const;

export const HARNESS_PRESENTATION: ModulePresentation = { operations: HARNESS_OPERATION_IDS, called: threadCalledDisplay };
