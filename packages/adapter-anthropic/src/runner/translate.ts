import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import { Result, Schema } from 'effect';
import type { ContentBlock } from '@runlith/acp/content';
import type { StopReason, Usage } from '@runlith/acp/methods';
import type { ToolCallContent, ToolCallStatus, ToolKind } from '@runlith/acp/toolCalls';
import type { SessionUpdate } from '@runlith/acp/updates';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import type { Handed } from '@runlith/hosted-runner/handed';
import type { Said } from '@runlith/hosted-runner/output';
import { SERVED, type Names } from './names.js';
import { nativeNameOf, WEB_FETCH, WEB_SEARCH } from './vendor.js';

const KINDS: Readonly<Record<string, ToolKind>> = {
  read: 'read',
  ls: 'read',
  glob: 'search',
  grep: 'search',
  edit: 'edit',
  write: 'edit',
  delete: 'delete',
  rename: 'move',
  bash: 'execute',
  [WEB_FETCH.tagma]: 'fetch',
  [WEB_SEARCH.tagma]: 'fetch',
};

const Text = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String });
const Thinking = Schema.Struct({ type: Schema.Literal('thinking'), thinking: Schema.String });
const ToolUse = Schema.Struct({ type: Schema.Literal('tool_use'), id: Schema.String, name: Schema.String, input: Schema.Unknown });
const Other = Schema.Struct({ type: Schema.String });
const AssistantBlock = Schema.Union([
  Text,
  Thinking,
  ToolUse,
  Other.check(Schema.makeFilter((block) => block.type !== 'text' && block.type !== 'thinking' && block.type !== 'tool_use')),
]);

const Assistant = Schema.Struct({ id: Schema.String, content: Schema.Array(AssistantBlock) });

const ToolResult = Schema.Struct({
  type: Schema.Literal('tool_result'),
  tool_use_id: Schema.String,
  content: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.Union([Text, Other]))])),
  is_error: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});
const UserMessage = Schema.Struct({ content: Schema.Union([Schema.String, Schema.Array(Schema.Union([ToolResult, Text, Other]))]) });

const StreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal('message_start'), message: Schema.Struct({ id: Schema.String }) }),
  Schema.Struct({
    type: Schema.Literal('content_block_delta'),
    index: Schema.Number,
    delta: Schema.Union([
      Schema.Struct({ type: Schema.Literal('text_delta'), text: Schema.String }),
      Schema.Struct({ type: Schema.Literal('thinking_delta'), thinking: Schema.String }),
      Schema.Struct({ type: Schema.String }),
    ]),
  }),
  Schema.Struct({ type: Schema.String }),
]);

const decodeAssistant = Schema.decodeUnknownResult(Assistant);
const decodeUser = Schema.decodeUnknownResult(UserMessage);
const decodeEvent = Schema.decodeUnknownResult(StreamEvent);

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const toolOf = (name: string): string => (name.startsWith(SERVED) ? name.slice(SERVED.length) : (nativeNameOf(name) ?? name));

export const kindOf = (tool: string): ToolKind => KINDS[toolOf(tool)] ?? 'other';

const changed = (tool: string, input: unknown): readonly ToolCallContent[] => {
  const fields = record(input);
  const path = text(fields.path);
  if (path === null) return [];
  if (tool === 'edit') {
    const newText = text(fields.newString);
    return newText === null ? [] : [{ type: 'diff', path, oldText: text(fields.oldString), newText }];
  }
  if (tool === 'write') {
    const newText = text(fields.content);
    return newText === null ? [] : [{ type: 'diff', path, oldText: null, newText }];
  }
  return [];
};

const resultText = (content: (typeof ToolResult.Type)['content']): string => {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  return content.map((block) => ('text' in block && typeof block.text === 'string' ? block.text : `[${block.type}]`)).join('\n');
};

type Call = { readonly tool: string; readonly diff: readonly ToolCallContent[]; readonly tagma: boolean };

const startedOf = (name: string, tagma: boolean): ToolCallStatus => (tagma || name === WEB_FETCH.wire ? 'pending' : 'in_progress');

export type Translated = { readonly updates: readonly SessionUpdate[]; readonly said: Said | null };

const QUIET: Translated = { updates: [], said: null };

export class Translation {
  private streamed: string | null = null;
  private introduced: string[] = [];
  private readonly calls = new Map<string, Call>();
  private readonly early = new Set<string>();
  private message: string | null = null;
  private begun: string | null = null;

  constructor(
    private readonly handed: Handed,
    private readonly names: Names,
  ) {}

  started(toolCallId: string): readonly SessionUpdate[] {
    if (this.calls.has(toolCallId)) return [{ sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' }];
    this.early.add(toolCallId);
    return [];
  }

  stream(event: unknown): Translated {
    const decoded = decodeEvent(event);
    if (Result.isFailure(decoded)) return QUIET;
    const frame = decoded.success;
    if (frame.type === 'message_start' && 'message' in frame) {
      this.message = frame.message.id;
      this.begun = frame.message.id;
      this.streamed = null;
      this.introduced = [];
      return QUIET;
    }
    if (frame.type === 'message_stop') {
      const messageId = this.message;
      this.message = null;
      return messageId === null ? QUIET : { updates: [], said: { messageId, toolCallIds: this.introduced } };
    }
    if (frame.type !== 'content_block_delta' || !('delta' in frame) || this.message === null) return QUIET;
    const messageId = `${this.message}:${frame.index}`;
    const delta = frame.delta;
    if (delta.type === 'text_delta' && 'text' in delta) {
      this.streamed = this.message;
      return { updates: [{ sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: delta.text } }], said: null };
    }
    if (delta.type === 'thinking_delta' && 'thinking' in delta) {
      this.streamed = this.message;
      return {
        updates:
          delta.thinking === ''
            ? []
            : [{ sessionUpdate: 'agent_thought_chunk', messageId, content: { type: 'text', text: delta.thinking } }],
        said: null,
      };
    }
    return QUIET;
  }

  assistant(message: unknown) {
    return Result.map(decodeAssistant(message), (answer): Translated => {
      const unstreamed = this.streamed !== answer.id;
      const updates = answer.content.flatMap((block, index): SessionUpdate[] => {
        const messageId = `${answer.id}:${index}`;
        if (block.type === 'tool_use' && 'id' in block) {
          const tool = toolOf(block.name);
          const diff = changed(tool, block.input);
          const tagma = this.names.routed(block.name);
          this.calls.set(block.id, { tool, diff, tagma });
          if (answer.id === this.message) this.introduced.push(block.id);
          const path = text(record(block.input).path);
          return [
            {
              sessionUpdate: 'tool_call',
              toolCallId: block.id,
              title: tool,
              name: tool,
              kind: kindOf(tool),
              status: this.early.delete(block.id) ? 'in_progress' : startedOf(block.name, tagma),
              rawInput: block.input,
              content: diff.length === 0 ? undefined : diff,
              locations: path === null ? undefined : [{ path }],
              _meta: this.handed.offered(tagma),
            },
          ];
        }
        if (!unstreamed) return [];
        if (block.type === 'text' && 'text' in block && block.text !== '') {
          return [{ sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: block.text } }];
        }
        if (block.type === 'thinking' && 'thinking' in block && block.thinking !== '') {
          return [{ sessionUpdate: 'agent_thought_chunk', messageId, content: { type: 'text', text: block.thinking } }];
        }
        return [];
      });
      const toolCallIds = answer.content.flatMap((block) => (block.type === 'tool_use' && 'id' in block ? [block.id] : []));
      if (answer.id === this.begun || toolCallIds.length === 0) return { updates, said: null };
      return { updates, said: { messageId: answer.id, toolCallIds } };
    });
  }

  user(message: unknown, structured: unknown): readonly SessionUpdate[] {
    const decoded = decodeUser(message);
    if (Result.isFailure(decoded) || typeof decoded.success.content === 'string') return [];
    return decoded.success.content.flatMap((block): SessionUpdate[] => {
      if (block.type !== 'tool_result' || !('tool_use_id' in block)) return [];
      const call = this.calls.get(block.tool_use_id);
      this.calls.delete(block.tool_use_id);
      const execution = this.handed.answered(block.tool_use_id, call?.tagma === true);
      const said = resultText(block.content);
      return [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: block.tool_use_id,
          status: block.is_error === true ? 'failed' : 'completed',
          content: [
            ...(call?.diff ?? []),
            ...(said === '' ? [] : [{ type: 'content' as const, content: { type: 'text' as const, text: said } }]),
          ],
          rawOutput: structured ?? block.content ?? null,
          _meta: execution,
        },
      ];
    });
  }
}

const CostBasis = Schema.Literals(['list', 'managed', 'unknown']);
export type CostBasis = typeof CostBasis.Type;

export type Cost = { readonly amount: number; readonly currency: 'USD'; readonly basis: CostBasis };

export type Reading = {
  readonly input: number;
  readonly output: number;
  readonly thought: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cost: number;
  readonly basis: CostBasis;
};

export const ZERO: Reading = { input: 0, output: 0, thought: 0, cacheRead: 0, cacheWrite: 0, cost: 0, basis: 'list' };

const ModelUsage = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  thinkingTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.Number,
  cacheCreationInputTokens: Schema.Number,
  costBasis: Schema.optional(CostBasis),
});
const Totals = Schema.Struct({ total_cost_usd: Schema.Number, modelUsage: Schema.Record(Schema.String, ModelUsage) });
const decodeTotals = Schema.decodeUnknownResult(Totals);

export const readingOf = (result: unknown): Reading | null => {
  const decoded = decodeTotals(result);
  if (Result.isFailure(decoded)) return null;
  const models = Object.values(decoded.success.modelUsage);
  const sum = (field: (usage: typeof ModelUsage.Type) => number) => models.reduce((total, usage) => total + field(usage), 0);
  const bases = new Set(models.map((usage) => usage.costBasis ?? 'list'));
  return {
    input: sum((usage) => usage.inputTokens),
    output: sum((usage) => usage.outputTokens),
    thought: sum((usage) => usage.thinkingTokens ?? 0),
    cacheRead: sum((usage) => usage.cacheReadInputTokens),
    cacheWrite: sum((usage) => usage.cacheCreationInputTokens),
    cost: decoded.success.total_cost_usd,
    basis: bases.size === 1 ? [...bases][0]! : bases.size === 0 ? 'list' : 'unknown',
  };
};

export const usageOf = (counts: {
  readonly nonCached: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly reasoning: number;
}): Usage => {
  const inputTokens = counts.nonCached + counts.cacheRead + counts.cacheWrite;
  return {
    inputTokens,
    outputTokens: counts.output,
    thoughtTokens: counts.reasoning,
    cachedReadTokens: counts.cacheRead,
    cachedWriteTokens: counts.cacheWrite,
    totalTokens: inputTokens + counts.output,
  };
};

export const spent = (from: Reading, to: Reading): { readonly usage: Usage; readonly cost: Cost } => ({
  usage: usageOf({
    nonCached: to.input - from.input,
    cacheRead: to.cacheRead - from.cacheRead,
    cacheWrite: to.cacheWrite - from.cacheWrite,
    output: to.output - from.output,
    reasoning: to.thought - from.thought,
  }),
  cost: { amount: to.cost - from.cost, currency: 'USD', basis: to.basis },
});

const Ended = Schema.Struct({
  subtype: Schema.String,
  is_error: Schema.Boolean,
  stop_reason: Schema.NullOr(Schema.String),
  terminal_reason: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Array(Schema.String)),
  api_error_status: Schema.optional(Schema.NullOr(Schema.Finite)),
});
const decodeEnded = Schema.decodeUnknownResult(Ended);

export type Outcome =
  | { readonly _tag: 'Stopped'; readonly stopReason: StopReason }
  | { readonly _tag: 'Failed'; readonly message: string; readonly status: number | null; readonly failure?: TransportFailure | null };

const ABORTED = new Set(['aborted_streaming', 'aborted_tools']);

export const outcomeOf = (result: unknown, error: SDKAssistantMessageError | null): Outcome => {
  const decoded = decodeEnded(result);
  if (Result.isFailure(decoded))
    return { _tag: 'Failed', message: 'Claude Code ended the turn with a result Tagma cannot read.', status: null };
  const ended = decoded.success;
  if (ABORTED.has(ended.terminal_reason ?? '')) return { _tag: 'Stopped', stopReason: 'cancelled' };
  if (ended.subtype === 'error_max_turns') return { _tag: 'Stopped', stopReason: 'max_turn_requests' };
  if (error === 'max_output_tokens') return { _tag: 'Stopped', stopReason: 'max_tokens' };
  if (ended.subtype !== 'success' || ended.is_error) {
    const said = [ended.result ?? '', ...(ended.errors ?? [])].filter((line) => line.trim() !== '').join('\n');
    return {
      _tag: 'Failed',
      message: said === '' ? `Claude Code ended the turn with ${ended.subtype}` : said,
      status: ended.api_error_status ?? null,
    };
  }
  if (ended.stop_reason === 'max_tokens') return { _tag: 'Stopped', stopReason: 'max_tokens' };
  if (ended.stop_reason === 'refusal') return { _tag: 'Stopped', stopReason: 'refusal' };
  return { _tag: 'Stopped', stopReason: 'end_turn' };
};

export type PromptBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly source: { readonly type: 'base64'; readonly media_type: string; readonly data: string } };

export const promptBlocks = (prompt: ReadonlyArray<ContentBlock>): Result.Result<readonly PromptBlock[], string> => {
  const blocks: PromptBlock[] = [];
  for (const block of prompt) {
    switch (block.type) {
      case 'text':
        blocks.push({ type: 'text', text: block.text });
        break;
      case 'image':
        blocks.push({ type: 'image', source: { type: 'base64', media_type: block.mimeType, data: block.data } });
        break;
      case 'resource_link':
        blocks.push({ type: 'text', text: `[${block.name}](${block.uri})` });
        break;
      case 'resource':
        if ('text' in block.resource)
          blocks.push({ type: 'text', text: `<context ref="${block.resource.uri}">\n${block.resource.text}\n</context>` });
        else if (block.resource.mimeType?.startsWith('image/') === true) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: block.resource.mimeType, data: block.resource.blob } });
        } else return Result.fail(`a ${block.resource.mimeType ?? 'binary'} resource cannot be given to Claude Code`);
        break;
      case 'audio':
        return Result.fail('Claude Code takes no audio');
    }
  }
  return Result.succeed(blocks);
};
