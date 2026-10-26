import { Effect } from 'effect';
import type { ToolResultRetentionPolicy } from '@runlith/llm/profiles/contract';
import type { ToolFileContent } from '@runlith/llm/schema/tool-content';
import type { ToolDisplay, ToolDisplayImage } from '../../tool/display';
import { AgentHostFailed } from '../AgentFailure';
import type { ToolCaller } from '../contracts';
import type { Tool, ToolMedia, ToolOutputSource } from '../tool';
import {
  type AgentKeptPicture,
  type AgentToolModelOutput,
  type AgentToolOutputProjection,
  type AgentToolOutputs,
  type AgentToolPictures,
  agentToolDisplay,
  agentToolModelOutput,
  failedAgentToolOutputRetention,
  pictureModelOutput,
  unretainedAgentToolOutput,
} from '../ToolOutput';
import type { ToolOutputKeep } from '../ToolOutputSpool';
import { messageOf } from './failures';
import type { AgentToolProduced } from './types';

export type ToolDisplayFacts = {
  readonly tool: Tool;
  readonly published: ToolDisplay | undefined;
  readonly answered: ToolDisplay | undefined;
  readonly modelOutput: AgentToolModelOutput;
  readonly durationMs?: number | undefined;
  readonly images?: readonly ToolDisplayImage[] | undefined;
};

export type ToolOutputRequest = AgentToolProduced & {
  readonly source?: ToolOutputSource;
  readonly modelOutput?: AgentToolModelOutput;
  readonly pictures?: AgentToolPictures;
};

export type OutputProjection = ReturnType<typeof makeOutputProjection>;

export const makeOutputProjection = ({
  outputs,
  caller,
}: {
  readonly outputs: AgentToolOutputs | undefined;
  readonly caller: ToolCaller;
}) => ({
  display: (input: ToolDisplayFacts): ToolDisplay =>
    agentToolDisplay({
      declared: input.answered,
      published: input.published,
      modelOutput: input.modelOutput,
      mutates: input.tool.mutates === true,
      keep: input.tool.keepsTail ? 'tail' : 'head',
      durationMs: input.durationMs,
      images: input.images,
    }),

  pictures: Effect.fnUntraced(function* (media: readonly ToolMedia[]) {
    const keep = outputs?.keepPicture;
    const lines: string[] = [];
    const parts: ToolFileContent[] = [];
    const shown: ToolDisplayImage[] = [];
    for (const medium of media) {
      const label = medium.label ?? medium.mediaType;
      if (keep === undefined) {
        lines.push(`Picture ${label} is not shown: this run keeps no pictures.`);
        continue;
      }
      const tried = yield* Effect.result(keep(medium));
      const answered: AgentKeptPicture =
        tried._tag === 'Success' ? tried.success : { refused: `it could not be kept (${messageOf(tried.failure.cause)})` };
      if ('refused' in answered) {
        lines.push(`Picture ${label} is not shown: ${answered.refused}.`);
        continue;
      }
      const kept = answered.kept;
      const reduced = kept.width !== kept.sourceWidth || kept.height !== kept.sourceHeight;
      lines.push(
        reduced
          ? `Picture ${label}: ${kept.width}×${kept.height}, reduced from ${kept.sourceWidth}×${kept.sourceHeight}.`
          : `Picture ${label}: ${kept.width}×${kept.height}.`,
      );
      parts.push({ type: 'file', uri: kept.location, mime: kept.mediaType, name: label, width: kept.width, height: kept.height });
      shown.push({ url: kept.location, mediaType: kept.mediaType, width: kept.width, height: kept.height, label });
    }
    return { lines, parts, shown };
  }),

  project: (
    call: ToolOutputRequest,
    executionCompleted: boolean,
    keep: ToolOutputKeep = 'head',
    retention?: ToolResultRetentionPolicy,
  ): Effect.Effect<AgentToolOutputProjection, AgentHostFailed> => {
    let modelOutput: AgentToolModelOutput | undefined;
    return Effect.gen(function* () {
      const produced =
        call.modelOutput ??
        (yield* Effect.try({
          try: () =>
            agentToolModelOutput({
              tool: call.tool,
              toolCallId: call.toolCallId,
              caller,
              toolInput: call.input,
              output: call.output,
            }),
          catch: (cause) => new AgentHostFailed({ port: 'toolOutputs', cause }),
        }));
      modelOutput = call.pictures ? pictureModelOutput(produced, call.pictures) : produced;
      if (!outputs) return unretainedAgentToolOutput(call.output, modelOutput, keep);
      return yield* outputs.project({
        source: call.source,
        toolCallId: call.toolCallId,
        toolName: call.name,
        output: call.output,
        modelOutput,
        keep,
        retention: retention,
      });
    }).pipe(
      Effect.catchTag('AgentHostFailed', (failure) => {
        if (!executionCompleted) return Effect.fail(failure);
        const kept = failedAgentToolOutputRetention({
          toolName: call.name,
          toolCallId: call.toolCallId,
          output: call.output,
          modelOutput: modelOutput,
          error: failure.cause,
        });
        return Effect.as(
          Effect.logWarning('tool output retention failed after execution', { toolName: call.name, toolCallId: call.toolCallId }),
          kept,
        );
      }),
    );
  },
});
