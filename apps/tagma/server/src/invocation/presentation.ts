import { Effect, type Schema } from 'effect';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '@runlith/agent/ToolOutputSpool';
import { documentLines } from '../platform/contract/wire/plainText.js';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { OperationId } from '../platform/contract/wire/ids.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import type { Operation } from '../platform/contract/wire/operation.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import type { SessionIdentity } from '../platform/contract/wire/session.js';
import type { VoiceRefused } from '../platform/contract/wire/voiceAnswer.js';
import {
  type Presentation,
  type TextBudget,
  UNVOICED,
  type Voice,
  type VoiceUnrendered,
  within,
} from '../platform/contract/service/presentation.js';
import type { GraphCall } from '../graph/contract/service/serving.js';
import type { OperationCatalog } from './contract/service/catalog.js';

export const VOICE_BUDGET: TextBudget = { bytes: TOOL_OUTPUT_MAX_BYTES, lines: TOOL_OUTPUT_MAX_LINES };

export type VoiceNeeds = GraphCall | SessionIdentity;

export const refusedAnswer = (answer: unknown): answer is VoiceRefused =>
  typeof answer === 'object' && answer !== null && (answer as { readonly status?: unknown }).status === 'refused';

export const refusalText = (refused: VoiceRefused): string => refusalLines(refused).join('\n');

export const voiced = <R>(
  presentation: Presentation<R>,
  document: Schema.Top,
  id: OperationId,
  answer: unknown,
  input: unknown,
  caller: Caller,
): Effect.Effect<string, never, R> => {
  const voice = presentation.voice;
  const generic = Effect.sync(() => within(documentLines(document, answer), VOICE_BUDGET));
  const spoken: Effect.Effect<string, VoiceUnrendered, R> =
    voice === null
      ? generic
      : voice(answer, input, { caller, operation: id, budget: VOICE_BUDGET }).pipe(
          Effect.flatMap((told) => (told === UNVOICED ? generic : Effect.succeed(told))),
        );
  const unbuilt = (reason: string) =>
    Effect.as(
      Effect.logWarning('the text of an operation answer could not be built', { operation: id, reason }),
      `The text of this answer could not be built (${reason}); the act happened and its document follows.\n${JSON.stringify(answer)}`,
    );
  return spoken.pipe(
    Effect.catchTag('VoiceUnrendered', (failure) => unbuilt(failure.message)),
    Effect.catchDefect((defect) => unbuilt(defect instanceof Error ? defect.message : String(defect))),
  );
};

export const presentationOf = (catalog: OperationCatalog['Service'], id: OperationId): Presentation<VoiceNeeds> => {
  const entry: Operation = catalog.registry.entry(id);
  const bound = catalog.bound(id);
  const module = catalog.presentation(id);
  const voice: Voice<unknown, unknown, VoiceNeeds> | undefined = bound?.voice ?? module?.voice;
  const called = entry.called ?? module?.called ?? null;
  const display = bound?.display;
  const settled = module?.settled;
  return {
    called,
    negative: module?.negative ?? null,
    settled: (input, answer): ToolDisplay | undefined =>
      refusedAnswer(answer)
        ? { form: 'text', title: called?.(input as Partial<Record<string, unknown>>).title, text: refusalText(answer) }
        : display === undefined
          ? settled?.(input, answer)
          : display(answer),
    voice: (answer, input, at) =>
      refusedAnswer(answer)
        ? Effect.succeed(refusalText(answer))
        : voice === undefined
          ? Effect.succeed(UNVOICED)
          : voice(answer, input, at),
  };
};
