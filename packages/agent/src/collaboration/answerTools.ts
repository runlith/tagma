import { Effect } from 'effect';
import { Tool } from '../agent/tool';
import type { ToolCatalog } from '../agent/ToolCatalog';
import { ASKS_NEVER } from '../permissions/vocabulary';
import { ANSWER, ANSWER_TOOL, answerInput, answerOf } from './askVerbs';
import { planeRefusals, SEND_REFUSALS } from './refusals';
import { answered } from './sendTools';
import type { ThreadAnswering } from './ThreadPlaneAccess';
import { hostCall } from './toolCalls';

export function answerTools(answering: ThreadAnswering): ToolCatalog {
  const to = [answering.parent];
  return {
    [ANSWER_TOOL]: Tool.make({
      approval: ASKS_NEVER,
      description: ANSWER,
      refusals: planeRefusals(SEND_REFUSALS),
      parameters: answerInput,
      document: true,
      subjects: () => [],
      display: {
        streamFields: ['text'],
        project: (input) => ({ form: 'message', verb: 'Answered', text: input.text ?? '' }),
      },
      execute: (input, call) =>
        hostCall(
          Effect.flatMap(answering.acting(call.caller), (verbs) =>
            verbs.messaging
              .send({ to, intent: 'message', text: input.text, key: call.toolCallId, final: true, answer: answerOf(input) })
              .pipe(Effect.map((answer) => answered(call, to, input.text, answer, true))),
          ),
        ),
      mutates: true,
    }),
  };
}
