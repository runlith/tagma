import { createHash } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';
import { Schema } from 'effect';
import {
  ToolCallContent,
  ToolCallLocation,
  type ToolCall,
  type ToolCallStatus,
  type ToolCallUpdate,
  type ToolKind,
} from '@runlith/acp/toolCalls';
import type { Step } from '@runlith/acp/events';
import type { AgentRequest, ClientState } from '@runlith/acp/state';
import { ToolResultPart } from '@runlith/llm/schema/messages';
import { ToolDisplay, ToolDisplayMeta, toolFilePatch, type ToolDisplayFilePatch } from '@runlith/agent/tool/display';
import { boundDisplayText, TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import {
  settleTool,
  toolInputJson,
  type ThreadToolEntry,
  type ThreadToolExecution,
  type ThreadToolSettled,
  type ThreadToolState,
} from '@runlith/agent/transcript/entries';
import { hostedToolEntryId } from '@runlith/agent/transcript/entryNames';
import { toJson } from '@runlith/utils/json';
import { textOf } from './content.js';

const Output = Schema.Struct({
  content: Schema.Array(ToolCallContent),
  locations: Schema.Array(ToolCallLocation),
  rawOutput: Schema.Unknown,
});
type Output = typeof Output.Type;

const isOutput = Schema.is(Output);

const NOTHING: Output = { content: [], locations: [], rawOutput: null };

const FAILED = 'The agent reported this call as failed.';

const MUTATING: ReadonlySet<ToolKind> = new Set(['edit', 'delete', 'move', 'execute']);

const mutating = (kind: ToolKind | null | undefined): boolean => kind != null && MUTATING.has(kind);

const shownPath = (cwd: string | null, path: string): string => {
  if (cwd === null) return path;
  const inside = relative(cwd, path);
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? inside : path;
};

//! An agent repeats a call's diffs in later frames, so the patches of the last ones are kept and not computed again.
const PATCHES_KEPT = 32;

const patches = new Map<string, ToolDisplayFilePatch>();

const patchOf = (path: string, before: string, after: string): ToolDisplayFilePatch => {
  const key = createHash('sha1').update(path).update('\0').update(before).update('\0').update(after).digest('hex');
  const held = patches.get(key);
  if (held !== undefined) return held;
  const file = toolFilePatch(path, before, after);
  const made = { ...file, patch: boundDisplayText(file.patch) };
  patches.set(key, made);
  const [oldest] = patches.keys();
  if (patches.size > PATCHES_KEPT && oldest !== undefined) patches.delete(oldest);
  return made;
};

type Content = { readonly files: readonly ToolDisplayFilePatch[]; readonly said: string; readonly terminals: readonly string[] };

const contentOf = (content: readonly ToolCallContent[], cwd: string | null): Content => {
  const files: ToolDisplayFilePatch[] = [];
  const texts: string[] = [];
  const terminals: string[] = [];
  for (const part of content) {
    if (part.type === 'diff') files.push(patchOf(shownPath(cwd, part.path), part.oldText ?? '', part.newText));
    else if (part.type === 'terminal') terminals.push(part.terminalId);
    else {
      const text = textOf([part.content]).trim();
      if (text !== '') texts.push(text);
    }
  }
  return { files, said: boundDisplayText(texts.join('\n\n')), terminals };
};

const rawText = (raw: unknown): string => {
  if (raw == null) return '';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  return text.trim() === '' ? '' : boundDisplayText(text);
};

const DisplayedAnswer = Schema.Struct({ _meta: ToolDisplayMeta });
const decodeDisplay = Schema.decodeUnknownSync(DisplayedAnswer);

const readDisplay = (value: unknown): ToolDisplay | undefined => {
  let answer = value;
  if (typeof answer === 'string') {
    if (answer.length > TOOL_OUTPUT_MAX_BYTES) return undefined;
    try {
      answer = JSON.parse(answer);
    } catch (failure) {
      if (failure instanceof SyntaxError) return undefined;
      throw failure;
    }
  }
  if (typeof answer !== 'object' || answer === null || !('_meta' in answer)) return undefined;
  const meta = answer._meta;
  if (typeof meta !== 'object' || meta === null || !('toolDisplay' in meta)) return undefined;
  return decodeDisplay(answer)._meta.toolDisplay;
};

const carriedDisplay = (output: Output): ToolDisplay | undefined => {
  const raw = readDisplay(output.rawOutput);
  if (raw !== undefined) return raw;
  for (const part of output.content) {
    if (part.type !== 'content' || part.content.type !== 'text') continue;
    const read = readDisplay(part.content.text);
    if (read !== undefined) return read;
  }
  return undefined;
};

const displayOf = (output: Output, mutates: boolean, cwd: string | null, failed: boolean): ToolDisplay => {
  const carried = carriedDisplay(output);
  if (carried !== undefined) return carried;
  const { files, said, terminals } = contentOf(output.content, cwd);
  const details = [
    ...output.locations.map((one) => ({
      label: 'file',
      value: one.line == null ? shownPath(cwd, one.path) : `${shownPath(cwd, one.path)}:${one.line}`,
    })),
    ...terminals.map((value) => ({ label: 'terminal', value })),
  ];
  const head = { details: details.length === 0 ? undefined : details, mutates: mutates ? mutates : undefined };
  const [first, ...rest] = files;
  if (first !== undefined) return { ...head, form: 'diff', files: [first, ...rest] };
  if (failed) return { ...head, form: 'none' };
  if (said !== '') return { ...head, form: 'text', text: said };
  const raw = terminals.length === 0 ? rawText(output.rawOutput) : '';
  return raw !== '' ? { ...head, form: 'text', text: raw } : { ...head, form: 'none' };
};

const failureOf = (output: Output, cwd: string | null): string => {
  const { said } = contentOf(output.content, cwd);
  if (said !== '') return said;
  const raw = output.rawOutput;
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  return raw == null ? FAILED : JSON.stringify(raw);
};

const settled = (
  status: ToolCallStatus | null | undefined,
  output: Output,
  mutates: boolean,
  cwd: string | null,
): ThreadToolSettled & { readonly toolDisplay: ToolDisplay } => {
  const toolDisplay = displayOf(output, mutates, cwd, status === 'failed');
  switch (status) {
    case 'completed':
      return { ...settleTool({ kind: 'answered', output: toJson(output) }), toolDisplay };
    case 'failed':
      return { ...settleTool({ kind: 'failed', error: failureOf(output, cwd), output: toJson(output) }), toolDisplay };
    default:
      return { toolState: 'input-available', toolOutput: toJson(output), toolDisplay };
  }
};

const statusOf = (state: ThreadToolState): ToolCallStatus | null =>
  state === 'output-available' ? 'completed' : state === 'output-error' ? 'failed' : null;

const boundedSeen = new WeakMap<object, unknown>();

const pruned = (value: unknown, budget: { left: number }): unknown => {
  if (budget.left <= 0) return null;
  if (typeof value === 'string') {
    const kept = value.length > budget.left ? value.slice(0, budget.left) : value;
    budget.left -= kept.length + 2;
    return kept;
  }
  if (typeof value !== 'object' || value === null) {
    budget.left -= 8;
    return value;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      if (budget.left <= 0) break;
      items.push(pruned(item, budget));
    }
    return items;
  }
  const fields: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (budget.left <= 0) break;
    budget.left -= key.length + 4;
    fields[key] = pruned(item, budget);
  }
  return fields;
};

export const bounded = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    if (typeof value !== 'string' || value.length <= TOOL_OUTPUT_MAX_BYTES) return value;
    return { truncated: true, characters: value.length, preview: value.slice(0, TOOL_OUTPUT_MAX_BYTES) };
  }
  const seen = boundedSeen.get(value);
  if (seen !== undefined) return seen;
  const budget = { left: TOOL_OUTPUT_MAX_BYTES };
  const preview = pruned(value, budget);
  const kept = budget.left > 0 ? value : { truncated: true, limit: TOOL_OUTPUT_MAX_BYTES, preview };
  boundedSeen.set(value, kept);
  boundedSeen.set(kept as object, kept);
  return kept;
};

export const boundedCall = <C extends ToolCall | ToolCallUpdate>(call: C): C => {
  const rawInput = bounded(call.rawInput);
  const rawOutput = bounded(call.rawOutput);
  return rawInput === call.rawInput && rawOutput === call.rawOutput ? call : { ...call, rawInput, rawOutput };
};

const boundedAsks = (client: ClientState, judged: (ask: AgentRequest) => boolean): ClientState => {
  let asks: AgentRequest[] | null = null;
  client.asks.forEach((ask, index) => {
    if (ask.kind !== 'permission' || !judged(ask)) return;
    const toolCall = boundedCall(ask.params.toolCall);
    if (toolCall === ask.params.toolCall) return;
    asks ??= [...client.asks];
    asks[index] = { ...ask, params: { ...ask.params, toolCall } };
  });
  return asks === null ? client : { ...client, asks };
};

export const boundedClient = (step: Step, judged: (ask: AgentRequest) => boolean): ClientState => {
  const client = step.state.asks.length === 0 ? step.state : boundedAsks(step.state, judged);
  const turn = client.turn;
  if (turn === null) return client;
  let calls: Record<string, ToolCall> | null = null;
  for (const event of step.events) {
    if (event._tag !== 'ToolCallStarted' && event._tag !== 'ToolCallChanged') continue;
    if (event.turn !== turn.id) continue;
    const id = event.call.toolCallId;
    const call = turn.calls[id];
    if (call === undefined) continue;
    const kept = boundedCall(call);
    if (kept !== call) {
      calls ??= { ...turn.calls };
      calls[id] = kept;
    }
  }
  return calls === null ? client : { ...client, turn: { ...turn, calls } };
};

const entryHead = (turn: string, call: ToolCall | ToolCallUpdate) => ({
  type: 'tool' as const,
  id: hostedToolEntryId(turn, call.toolCallId),
  runId: turn,
  toolName: call.title ?? call.kind ?? 'tool',
  toolCallId: call.toolCallId,
});

const inputOf = (call: ToolCall | ToolCallUpdate): Schema.Json =>
  toJson(bounded(call.rawInput ?? { kind: call.kind ?? null, locations: call.locations ?? [] }));

const executionOf = (
  status: ToolCallStatus | null | undefined,
  at: string,
  before: ThreadToolExecution | undefined,
): ThreadToolExecution | undefined => {
  if (before?.state === 'started') return before;
  if (status === 'pending') return { state: 'queued' };
  return status === 'in_progress' ? { state: 'started', at } : undefined;
};

const executing = (execution: ThreadToolExecution | undefined) => (execution === undefined ? {} : { execution });

export const callEntry = (
  turn: string,
  call: ToolCall | ToolCallUpdate,
  at: string,
  cwd: string | null,
  before?: ThreadToolEntry,
): ThreadToolEntry => {
  const output: Output = { content: call.content ?? [], locations: call.locations ?? [], rawOutput: bounded(call.rawOutput ?? null) };
  return {
    ...entryHead(turn, call),
    ...settled(call.status, output, mutating(call.kind), cwd),
    toolInput: inputOf(call),
    ...executing(executionOf(call.status, at, before?.execution)),
    occurredAt: at,
  };
};

export const openedEntry = (turn: string, call: ToolCall, at: string, toolDisplay: ToolDisplay | undefined): ThreadToolEntry => ({
  ...entryHead(turn, call),
  toolState: 'input-available',
  toolInput: inputOf(call),
  toolDisplay,
  execution: { state: 'queued', gated: true },
  occurredAt: at,
});

const wordsOf = (call: ToolCall): string => {
  const said = (call.content ?? []).flatMap((part) => (part.type === 'content' ? [textOf([part.content])] : [])).join('\n\n');
  if (said.trim() !== '') return said;
  const raw = call.rawOutput;
  return typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw);
};

export const resultOf = (call: ToolCall): ToolResultPart | null => {
  if (call.status !== 'completed' && call.status !== 'failed') return null;
  const failed = call.status === 'failed';
  const words = wordsOf(call);
  return ToolResultPart.from({
    id: call.toolCallId,
    name: call.name ?? call.title ?? 'tool',
    result: failed && words.trim() === '' ? FAILED : words,
    resultType: failed ? 'error' : 'text',
  });
};

export const amendedEntry = (standing: ThreadToolEntry, update: ToolCallUpdate, at: string, cwd: string | null): ThreadToolEntry | null => {
  const outcome =
    update.status != null || update.content != null || update.locations != null || update.kind != null || 'rawOutput' in update;
  if (!outcome) {
    return {
      ...standing,
      toolName: update.title ?? standing.toolName,
      toolInput: 'rawInput' in update ? toolInputJson(bounded(update.rawInput)) : standing.toolInput,
    };
  }
  const before = standing.toolOutput === undefined ? NOTHING : isOutput(standing.toolOutput) ? standing.toolOutput : null;
  if (before === null) return null;
  const output: Output = {
    content: update.content ?? before.content,
    locations: update.locations ?? before.locations,
    rawOutput: 'rawOutput' in update ? bounded(update.rawOutput ?? null) : before.rawOutput,
  };
  const mutates = update.kind == null ? standing.toolDisplay?.mutates === true : mutating(update.kind);
  const { toolOutput: _output, toolError: _error, toolRefusal: _refusal, toolDisplay: _display, execution, ...kept } = standing;
  return {
    ...kept,
    toolName: update.title ?? standing.toolName,
    ...settled(update.status ?? statusOf(standing.toolState), output, mutates, cwd),
    toolInput: 'rawInput' in update ? toolInputJson(bounded(update.rawInput)) : standing.toolInput,
    ...executing(update.status == null ? execution : executionOf(update.status, at, execution)),
  };
};
