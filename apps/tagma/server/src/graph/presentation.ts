import { Effect } from 'effect';
import { type ModulePresentation, UNVOICED, type VoiceAt } from '../platform/contract/service/presentation.js';
import { SessionIdentity } from '../platform/contract/wire/session.js';
import { GraphCall } from './contract/service/serving.js';
import { NO_TAGS } from './contract/wire/tags/served.js';
import type { GraphToolAnswer } from './contract/wire/toolAnswers.js';
import { graphText } from './voice/answers.js';
import { graphCalledDisplay, graphSettledDisplay, type GraphToolInput } from './voice/display.js';

export const GRAPH_PRESENTATION: ModulePresentation<GraphCall | SessionIdentity> = {
  voice: Effect.fnUntraced(function* (answer: unknown, _input: unknown, at: VoiceAt) {
    const identity = yield* SessionIdentity;
    const table = yield* Effect.match(yield* GraphCall, { onSuccess: (call) => call.vocabulary, onFailure: () => NO_TAGS });
    return graphText(table, answer as GraphToolAnswer, identity, at.operation) ?? UNVOICED;
  }),
  called: graphCalledDisplay,
  settled: (input, answer) => graphSettledDisplay(input as GraphToolInput, answer as GraphToolAnswer),
};
