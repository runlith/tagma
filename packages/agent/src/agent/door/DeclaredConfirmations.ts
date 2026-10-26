import { Effect } from 'effect';
import { AgentToolFailed } from '../AgentFailure';
import { reasonedConfirmation, toolConfirmation, toolPreparedConfirmation } from '../tool';
import { messageOf, projected } from './failures';
import type { ToolConfirmations } from './ports';

export const declaredConfirmations: ToolConfirmations = {
  confirm: Effect.fnUntraced(function* ({ call, input, prepared, reasons }) {
    const prompt = yield* projected(call.name, call.toolCallId, 'confirmation.prompt', () =>
      toolConfirmation(call.tool.confirmation, input, prepared),
    );
    const declared = yield* projected(call.name, call.toolCallId, 'confirmation.prepare', () =>
      toolPreparedConfirmation(call.tool.confirmation, input),
    );
    const confirmation = declared
      ? yield* declared.pipe(
          Effect.result,
          Effect.catchDefect((cause) =>
            Effect.fail(
              new AgentToolFailed({
                toolName: call.name,
                toolCallId: call.toolCallId,
                projection: 'confirmation.prepare',
                cause,
              }),
            ),
          ),
          Effect.map((made) =>
            made._tag === 'Success'
              ? made.success
              : prompt && {
                  ...prompt,
                  facts: [...(prompt.facts ?? []), { label: 'Preview', value: `could not be prepared (${messageOf(made.failure)})` }],
                },
          ),
        )
      : prompt;
    return reasonedConfirmation(confirmation, reasons, call.name);
  }),
};
