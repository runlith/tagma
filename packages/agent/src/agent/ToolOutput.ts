import {
  TOOL_OUTPUT_MAX_BYTES,
  TOOL_OUTPUT_MAX_LINES,
  type ToolOutputKeep,
  boundDisplayText,
  boundedToolOutputPreview,
  countLines,
  retentionFailure,
} from './ToolOutputSpool';
import { ToolResultPart, type Message, type ToolResultRetention } from '@runlith/llm/schema/messages';
import type { ToolFileContent } from '@runlith/llm/schema/tool-content';
import type { ToolResultRetentionPolicy } from '@runlith/llm/profiles/contract';
import type { ToolCaller } from './contracts';
import type { Tool, ToolMedia, ToolOutputSource } from './tool';
import { mapFilePatches, type ToolDisplay, type ToolDisplayImage } from '../tool/display';
import { utf8ByteLength } from '@runlith/utils/utf8';
import type { StructuredValue } from '@runlith/utils/object';
import type { ActivityBody } from '@runlith/activity/fact';
import { degraded } from '@runlith/activity/Activity';
import { Effect } from 'effect';
import type { AgentHostFailed } from './AgentFailure';

export type AgentToolModelOutput = ToolResultPart['result'];

export type AgentToolOutputProjection = {
  readonly output: StructuredValue | undefined;
  readonly modelOutput: AgentToolModelOutput;
  readonly retained?: ToolResultRetention;
};

export type AgentKeptPicture =
  | {
      readonly kept: {
        readonly location: string;
        readonly mediaType: string;
        readonly width: number;
        readonly height: number;
        readonly sourceWidth: number;
        readonly sourceHeight: number;
      };
    }
  | { readonly refused: string };

export type AgentPictureKeeper = (picture: ToolMedia) => Effect.Effect<AgentKeptPicture, AgentHostFailed>;

export type AgentToolOutputInput = {
  readonly source?: ToolOutputSource;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: StructuredValue | undefined;
  readonly modelOutput: AgentToolModelOutput;
  readonly keep: ToolOutputKeep;
  readonly retention?: ToolResultRetentionPolicy;
};

export interface AgentToolOutputs {
  project(input: AgentToolOutputInput): Effect.Effect<AgentToolOutputProjection, AgentHostFailed>;
  projectMessages(messages: readonly Message[]): Effect.Effect<readonly Message[], AgentHostFailed>;
  readonly keepPicture?: AgentPictureKeeper;
}

export type AgentToolPictures = {
  readonly lines: readonly string[];
  readonly parts: readonly ToolFileContent[];
  readonly shown: readonly ToolDisplayImage[];
};

export function pictureModelOutput(output: AgentToolModelOutput, pictures: AgentToolPictures): AgentToolModelOutput {
  const carried = output.type === 'content' ? output.value.filter((part) => part.type !== 'text') : [];
  const said =
    output.type === 'content'
      ? output.value.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
      : agentToolOutputText(output);
  const lines = pictures.lines.join('\n');
  const text = lines.length === 0 ? said : said.length === 0 ? lines : `${said}\n\n${lines}`;
  const parts = [...carried, ...pictures.parts];
  if (parts.length === 0) return output.type === 'error' ? { type: 'error', value: text } : { type: 'text', value: text };
  return { type: 'content', value: [{ type: 'text', text }, ...parts] };
}

export type AgentToolOutputInspection = {
  format: 'text' | 'json';
  text: string;
  byteLength: number;
  lineCount: number;
  oversized: boolean;
};

export function agentToolModelOutput(input: {
  tool: Tool;
  toolCallId: string;
  caller: ToolCaller;
  toolInput: unknown;
  output: unknown;
}): AgentToolModelOutput {
  if (input.tool.toModelOutput) {
    return input.tool.toModelOutput({
      toolCallId: input.toolCallId,
      caller: input.caller,
      input: input.toolInput,
      output: input.output,
    });
  }
  if (typeof input.output === 'string') return { type: 'text', value: input.output };
  return doorToolModelOutput(input.output);
}

export function doorToolModelOutput(output: unknown): AgentToolModelOutput {
  return {
    type: 'json',
    value: (output === undefined ? null : output) as Extract<AgentToolModelOutput, { type: 'json' }>['value'],
  };
}

export function initialToolDisplay(input: { declared: ToolDisplay; mutates: boolean; keep: ToolOutputKeep }): ToolDisplay {
  const mutates = input.mutates ? { mutates: true as const } : {};
  return { ...boundDisplayBody(input.declared, input.keep), ...mutates };
}

export const PREVIEW_PLACE = 'tool preview';
export const PREVIEW_WHY =
  'The title and words of a call before its answer are presentation: the call, its answer and the history are the same without them.';

export const previewed = <A>(compute: () => A | undefined): Effect.Effect<A | undefined> =>
  degraded(PREVIEW_PLACE, PREVIEW_WHY, Effect.sync(compute), () => undefined);

export function agentToolDisplay(input: {
  declared: ToolDisplay | undefined;
  published: ToolDisplay | undefined;
  modelOutput: AgentToolModelOutput;
  mutates: boolean;
  keep: ToolOutputKeep;
  durationMs?: number | undefined;
  images?: readonly ToolDisplayImage[] | undefined;
}): ToolDisplay {
  const mutates = input.mutates ? { mutates: true as const } : {};
  const took = input.durationMs === undefined ? {} : { durationMs: Math.round(input.durationMs) };
  const shown = input.images === undefined || input.images.length === 0 ? {} : { images: input.images };
  const declared = input.declared;
  if (!declared) {
    return {
      ...settledHead(input.published),
      ...mutates,
      ...took,
      ...shown,
      form: 'text',
      text: boundDisplayText(agentToolOutputText(input.modelOutput), input.keep),
    };
  }
  const bounded = boundDisplayBody(declared, input.keep);
  return { ...bounded, ...mutates, ...took, ...(declared.images === undefined ? shown : {}) };
}

function settledHead(published: ToolDisplay | undefined) {
  if (!published) return {};
  return {
    title: published.title,
    alone: published.alone,
    subtitle: published.subtitle,
    facts: published.facts,
    details: published.details,
    reference: published.reference,
    app: published.app,
  };
}

function boundDisplayBody(display: ToolDisplay, keep: ToolOutputKeep): ToolDisplay {
  if (display.form === 'text' || display.form === 'markdown' || display.form === 'message') {
    return { ...display, text: boundDisplayText(display.text, keep) };
  }
  if (display.form === 'code') return { ...display, text: boundDisplayText(display.text, keep) };
  if (display.form === 'command') {
    return {
      ...display,
      command: boundDisplayText(display.command, keep),
      output: display.output === undefined ? undefined : boundDisplayText(display.output, keep),
    };
  }
  if (display.form === 'diff') {
    return { ...display, files: mapFilePatches(display.files, (file) => ({ ...file, patch: boundDisplayText(file.patch, keep) })) };
  }
  if (display.form === 'list' && display.items.length > TOOL_OUTPUT_MAX_LINES) {
    return { ...display, items: display.items.slice(0, TOOL_OUTPUT_MAX_LINES), total: display.total ?? display.items.length };
  }
  return display;
}

export function inspectAgentToolOutput(output: AgentToolModelOutput): AgentToolOutputInspection {
  const format = output.type === 'json' ? 'json' : 'text';
  const text = agentToolOutputText(output);
  const byteLength = utf8ByteLength(text);
  const lineCount = countLines(text);
  return {
    format,
    text,
    byteLength,
    lineCount,
    oversized: lineCount > TOOL_OUTPUT_MAX_LINES || byteLength > TOOL_OUTPUT_MAX_BYTES,
  };
}

export function boundAgentToolOutput(
  output: AgentToolModelOutput,
  input: {
    outputId: string;
    byteLength: number;
    lineCount: number;
    retrievalTool: string;
    format?: ToolResultRetention['format'];
    location?: string;
    contentLocation?: string;
    keep?: ToolOutputKeep;
  },
): AgentToolOutputProjection {
  const marker = [
    `... tool output truncated (${input.lineCount} lines, ${input.byteLength} bytes); full output id: ${input.outputId} ...`,
    `Use ${input.retrievalTool} with outputId "${input.outputId}" and an offset to inspect the complete output; where it is deferred, tool_search "select:${input.retrievalTool}" reveals it first.`,
    ...(input.location === undefined ? [] : [`The complete output is the file ${input.location}.`]),
  ].join('\n');
  const preview = boundedToolOutputPreview(agentToolOutputText(output), marker, input.keep ?? 'head');
  const modelOutput: AgentToolModelOutput =
    output.type === 'content'
      ? {
          type: 'content',
          value: [{ type: 'text', text: preview }, ...output.value.filter((part) => part.type !== 'text')],
        }
      : output.type === 'error'
        ? { type: 'error', value: preview }
        : { type: 'text', value: preview };
  return {
    output: {
      truncated: true,
      outputId: input.outputId,
      byteLength: input.byteLength,
      lineCount: input.lineCount,
      preview,
    },
    modelOutput,
    retained: {
      outputId: input.outputId,
      format: input.format ?? (output.type === 'json' ? 'json' : 'text'),
      byteLength: input.byteLength,
      lineCount: input.lineCount,
      location: input.location,
      contentLocation: input.contentLocation,
    },
  };
}

export function unretainedAgentToolOutput(
  output: StructuredValue | undefined,
  modelOutput: AgentToolModelOutput,
  keep: ToolOutputKeep,
): AgentToolOutputProjection {
  const inspected = inspectAgentToolOutput(modelOutput);
  if (!inspected.oversized) return { output, modelOutput };
  const marker = `... tool output truncated (${inspected.lineCount} lines, ${inspected.byteLength} bytes); the rest was not retained ...`;
  const preview = boundedToolOutputPreview(inspected.text, marker, keep);
  return {
    output: { truncated: true, byteLength: inspected.byteLength, lineCount: inspected.lineCount, preview },
    modelOutput: { type: 'text', value: preview },
  };
}

export function failedAgentToolOutputRetention(input: {
  toolName: string;
  toolCallId: string;
  output: unknown;
  modelOutput?: AgentToolModelOutput;
  error: unknown;
}): AgentToolOutputProjection {
  const failure = retentionFailure(
    agentToolOutputText(
      input.modelOutput ??
        (typeof input.output === 'string'
          ? { type: 'text', value: input.output }
          : {
              type: 'json',
              value: (input.output === undefined ? null : input.output) as Extract<AgentToolModelOutput, { type: 'json' }>['value'],
            }),
    ),
    input.error,
  );
  const diagnostic = failure.diagnostic;
  const preview = failure.preview;
  return {
    output: {
      toolCompleted: true,
      retained: false,
      truncated: true,
      diagnostic,
      preview,
    },
    modelOutput: { type: 'text', value: preview },
  };
}

export function projectToolResultMessages(
  messages: readonly Message[],
  project: AgentToolOutputs['project'],
): Effect.Effect<readonly Message[], AgentHostFailed> {
  return Effect.forEach(messages, (message) =>
    message.role === 'tool' || message.role === 'assistant'
      ? Effect.map(projectToolResults(message.content, project), (content) =>
          content === message.content ? message : { ...message, content },
        )
      : Effect.succeed(message),
  );
}

function projectToolResults<TPart extends ToolResultPart | { readonly type: string }>(
  parts: readonly TPart[],
  project: AgentToolOutputs['project'],
): Effect.Effect<readonly TPart[], AgentHostFailed> {
  return Effect.map(
    Effect.forEach(parts, (part) => {
      if (part.type !== 'tool-result') return Effect.succeed(part);
      const result = part as TPart & ToolResultPart;
      return Effect.map(
        project({ toolCallId: result.id, toolName: result.name, output: undefined, modelOutput: result.result, keep: 'head' }),
        (bounded): TPart => (bounded.modelOutput === result.result ? part : { ...result, result: bounded.modelOutput }),
      );
    }),
    (projected) => (projected.every((part, at) => part === parts[at]) ? parts : projected),
  );
}

const utf8 = new TextEncoder();

export function argumentsBody(source: string): ActivityBody {
  return { kind: 'input', contentType: 'application/json', encoded: utf8.encode(source) };
}

export function modelOutputBody(output: AgentToolModelOutput): ActivityBody {
  return {
    kind: 'result',
    contentType: output.type === 'json' ? 'application/json' : 'text/plain; charset=utf-8',
    encoded: utf8.encode(agentToolOutputText(output)),
  };
}

export function agentToolOutputText(output: AgentToolModelOutput): string {
  if (output.type === 'text' || output.type === 'error') {
    return typeof output.value === 'string' ? output.value : jsonText(output.value);
  }
  if (output.type === 'json') return jsonText(output.value);
  return output.value.map((part) => (part.type === 'text' ? part.text : `[Attached ${'mime' in part ? part.mime : 'file'}]`)).join('\n');
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
