import { Predicate, Schema } from 'effect';
import { Message, ToolCallPart } from '@runlith/llm/schema/messages';
import type { FinishReason } from '@runlith/llm/schema/ids';
import type { ClientEvent, Failure } from '@runlith/acp/events';
import type { OpenMessage } from '@runlith/acp/state';
import type { ToolCall, ToolCallUpdate } from '@runlith/acp/toolCalls';
import { Usage, type StopReason } from '@runlith/acp/methods';
import { Usage as Spent } from '@runlith/llm/schema/events';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { ThreadRunCost } from '@runlith/agent/thread/rows';
import type { ThreadRunStoppedBy } from '@runlith/agent/thread/ending';
import { TransportFailure, type ThreadEntry, type ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { assistantMessageEntryId, interruptionEntryId, reasoningEntryId, hostedToolEntryId } from '@runlith/agent/transcript/entryNames';
import { amendedEntry, callEntry, openedEntry, resultOf } from './calls.js';
import { textOf } from './content.js';
import type { OpenedTurn } from './row.js';
import type { VendorAddress } from '../store/turns.js';
import type { HarnessTurnEnded, HarnessTurnMessage } from './turns.js';
import { EXECUTES, FAILURE, OPENED, type Said } from '@runlith/hosted-runner/wire/extensions';

export type Sealed = { readonly _tag: 'Sealed'; readonly said: (typeof Said)['Type'] | null };

export type Interrupted = { readonly _tag: 'Interrupted'; readonly turn: string; readonly by: ThreadRunStoppedBy | null };

export type Projection = {
  readonly boundaries: readonly ThreadEntry[];
  readonly ended: readonly HarnessTurnEnded[];
  readonly turns: readonly OpenedTurn[];
  readonly closed: readonly OpenedTurn[];
  readonly vendor: readonly VendorAddress[];
  readonly heard: boolean;
  readonly messages: readonly HarnessTurnMessage[] | undefined;
  readonly failure: string | null;
};

export const executed = (call: ToolCall | ToolCallUpdate): boolean => field(call._meta, EXECUTES) === true;

export type CallDisplay = (name: string, input: unknown) => ToolDisplay | undefined;

export const standingIds = (events: ReadonlyArray<ClientEvent>, hosted: boolean): ReadonlySet<string> => {
  const opened = new Set<string>();
  const standing = new Set<string>();
  for (const event of events) {
    if (event._tag === 'ToolCallStarted') opened.add(hostedToolEntryId(event.turn, event.call.toolCallId));
    else if (event._tag === 'ToolCallAmended') {
      if (!(hosted && executed(event.update))) standing.add(hostedToolEntryId(event.turn, event.update.toolCallId));
    } else if (event._tag === 'ToolCallChanged' || event._tag === 'ToolCallEnded') {
      const id = hostedToolEntryId(event.turn, event.call.toolCallId);
      if (!(hosted && executed(event.call)) && !opened.has(id)) standing.add(id);
    }
  }
  return standing;
};

export const spend = (usage: Usage | null): Spent | null =>
  usage === null
    ? null
    : Spent.from({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        nonCachedInputTokens: usage.inputTokens - (usage.cachedReadTokens ?? 0) - (usage.cachedWriteTokens ?? 0),
        cacheReadInputTokens: usage.cachedReadTokens ?? undefined,
        cacheWriteInputTokens: usage.cachedWriteTokens ?? undefined,
        reasoningTokens: usage.thoughtTokens ?? undefined,
      });

const isSpend = Schema.is(
  Schema.Struct({ usage: Schema.optional(Usage), _meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }),
);

export const spendOf = (data: unknown) => (isSpend(data) ? data : null);

const isCost = Schema.is(Schema.Struct({ amount: Schema.Number, currency: Schema.String, basis: Schema.optional(Schema.String) }));

const costOf = (meta: Readonly<Record<string, unknown>> | null | undefined): ThreadRunCost | null => {
  const cost = meta?.['tagma/cost'];
  return isCost(cost) ? { amount: cost.amount, currency: cost.currency, basis: cost.basis ?? 'list' } : null;
};

export const failureText = (cause: Failure): string => {
  switch (cause._tag) {
    case 'Agent':
      return `The agent answered ${cause.error.code}: ${cause.error.message}`;
    case 'Unreadable':
      return 'The agent answered with a body Tagma cannot read.';
    case 'Protocol':
      return `The agent speaks ACP ${cause.answered}, and Tagma speaks 1.`;
    case 'Unwritten':
      return 'The execution host refused to write these words to the agent.';
    case 'Oversized':
      return `The agent wrote a line longer than the ${cause.ceiling} bytes Tagma can read whole, so this turn was cancelled.`;
    case 'Exited':
      return `The agent process died: ${cause.detail}`;
  }
};

const FINISHES: Partial<Record<StopReason, FinishReason>> = { max_tokens: 'length', refusal: 'content-filter' };

const classed = Schema.is(TransportFailure);

const classOf = (cause: Failure): TransportFailure | undefined => {
  if (cause._tag !== 'Agent') return undefined;
  const data = cause.error.data;
  if (!Predicate.isObject(data) || !(FAILURE in data)) return undefined;
  const failure = data[FAILURE];
  return classed(failure) ? failure : undefined;
};

const message = (turn: OpenedTurn, said: OpenMessage, at: string): ThreadEntry => {
  const text = textOf(said.content).trim();
  return said.stream === 'message'
    ? { type: 'message', id: assistantMessageEntryId(turn.id, turn.parts.text), role: 'assistant', runId: turn.id, text, occurredAt: at }
    : { type: 'reasoning', id: reasoningEntryId(turn.id, turn.parts.reasoning), runId: turn.id, text, state: 'done', occurredAt: at };
};

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const vendorOf = (run: string, meta: Readonly<Record<string, unknown>>): VendorAddress => ({
  run,
  address: text(field(meta['tagma/turn'], 'prompt')),
});

export const project = (
  events: ReadonlyArray<ClientEvent | Sealed | Interrupted>,
  opened: readonly OpenedTurn[],
  at: string,
  hosted = false,
  standing: ReadonlyMap<string, ThreadToolEntry> = new Map(),
  cwd: string | null = null,
  display: CallDisplay = () => undefined,
): Projection => {
  const boundaries: ThreadEntry[] = [];
  const tools = new Map(standing);
  const ended: HarnessTurnEnded[] = [];
  const closed: OpenedTurn[] = [];
  const vendor: VendorAddress[] = [];
  let heard = false;
  let turns = [...opened];
  const messages: HarnessTurnMessage[] | undefined = hosted ? [] : undefined;
  let failure: string | null = null;
  const broken = new Set(
    events.flatMap((event) =>
      event._tag === 'TurnEnded' && (event.outcome._tag === 'Failed' || event.outcome.stopReason === 'cancelled') ? [event.turn] : [],
    ),
  );
  const said = (turnId: string, change: (parts: OpenedTurn['assistant']) => OpenedTurn['assistant']) => {
    if (!hosted) return;
    const index = turns.findIndex((turn) => turn.id === turnId);
    if (index >= 0) turns[index] = { ...turns[index]!, assistant: change(turns[index]!.assistant) };
  };
  const flush = (turnId: string, id?: string) => {
    if (!hosted) return;
    const index = turns.findIndex((turn) => turn.id === turnId);
    if (index < 0) return;
    const { answered = [], ...turn } = turns[index]!;
    if (turn.assistant.length > 0)
      messages!.push({ turn: turnId, message: Message.make({ role: 'assistant', content: turn.assistant, id }) });
    for (const result of answered) messages!.push({ turn: turnId, message: Message.make({ role: 'tool', content: [result] }) });
    turns[index] = { ...turn, assistant: [] };
  };
  const answered = (turnId: string, call: ToolCall) => {
    const result = hosted ? resultOf(call) : null;
    if (result === null) return;
    const index = turns.findIndex((turn) => turn.id === turnId);
    const turn = index < 0 ? undefined : turns[index]!;
    if (turn === undefined || !turn.assistant.some((part) => part.type === 'tool-call' && part.id === call.toolCallId)) {
      messages!.push({ turn: turnId, message: Message.make({ role: 'tool', content: [result] }) });
      return;
    }
    turns[index] = { ...turn, answered: [...(turn.answered ?? []), result] };
  };
  const called = (turnId: string, call: ToolCallUpdate, starts: boolean) =>
    said(turnId, (parts) => {
      const index = parts.findIndex((part) => part.type === 'tool-call' && part.id === call.toolCallId);
      if (index < 0 && !starts) return parts;
      const previous = index < 0 ? undefined : (parts[index] as ToolCallPart);
      const part = ToolCallPart.from({
        id: call.toolCallId,
        name: call.name ?? call.title ?? previous?.name ?? 'tool',
        input: 'rawInput' in call ? call.rawInput : (previous?.input ?? null),
      });
      return index < 0 ? [...parts, part] : parts.with(index, part);
    });
  const open = (turnId: string) => turns.some((turn) => turn.id === turnId);
  for (const event of events) {
    switch (event._tag) {
      case 'Message': {
        const index = turns.findIndex((turn) => turn.id === event.turn);
        if (index < 0) break;
        const turn = turns[index]!;
        if (textOf(event.message.content).trim() === '') break;
        const tailed = event.closing === true && broken.has(event.turn);
        if (!tailed) boundaries.push(message(turn, event.message, at));
        const said = event.message.stream === 'message' ? textOf(event.message.content) : turn.said;
        const stream = event.message.stream === 'message' ? 'text' : 'reasoning';
        turns = turns.with(index, {
          ...turn,
          parts: { ...turn.parts, [stream]: turn.parts[stream] + 1 },
          said,
          assistant:
            hosted && !tailed
              ? [...turn.assistant, { type: stream === 'text' ? 'text' : 'reasoning', text: textOf(event.message.content) }]
              : turn.assistant,
        });
        break;
      }
      case 'ToolCallStarted':
      case 'ToolCallChanged':
      case 'ToolCallEnded': {
        if (!open(event.turn)) break;
        const tagma = hosted && executed(event.call);
        if (event._tag === 'ToolCallStarted' || !tagma) {
          const id = hostedToolEntryId(event.turn, event.call.toolCallId);
          const entry = tagma
            ? openedEntry(event.turn, event.call, at, display(event.call.name ?? event.call.title, event.call.rawInput))
            : callEntry(event.turn, event.call, at, cwd, tools.get(id));
          tools.set(id, entry);
          boundaries.push(entry);
        }
        if (event._tag === 'ToolCallStarted') called(event.turn, event.call, true);
        else if (event.update !== null) called(event.turn, event.update, false);
        if (event._tag === 'ToolCallEnded' && !tagma) answered(event.turn, event.call);
        break;
      }
      case 'ToolCallAmended': {
        if (!open(event.turn) || (hosted && executed(event.update))) break;
        const id = hostedToolEntryId(event.turn, event.update.toolCallId);
        const before = tools.get(id);
        if (before === undefined) break;
        const entry = amendedEntry(before, event.update, at, cwd);
        if (entry === null) {
          boundaries.push({
            type: 'interruption',
            id: interruptionEntryId(`${event.turn}:call:${event.update.toolCallId}`),
            runId: event.turn,
            text: 'A late update to this call arrived, but the record Tagma holds of the call cannot be read, so the update was not applied.',
            occurredAt: at,
          });
          break;
        }
        tools.set(id, entry);
        boundaries.push(entry);
        break;
      }
      case 'TurnEnded': {
        flush(event.turn);
        const turn = turns.find((standing) => standing.id === event.turn);
        const outcome = event.outcome;
        const failure = outcome._tag === 'Failed' ? failureText(outcome.cause) : null;
        const stopped = outcome._tag === 'Stopped' ? outcome.stopReason : null;
        const carried = outcome._tag === 'Failed' && outcome.cause._tag === 'Agent' ? spendOf(outcome.cause.error.data) : null;
        if (outcome.meta != null) vendor.push(vendorOf(event.turn, outcome.meta));
        if ((outcome.meta ?? carried?._meta)?.[OPENED] === true) heard = true;
        ended.push({
          turn: event.turn,
          at,
          status: outcome._tag === 'Failed' ? 'failed' : stopped === 'cancelled' ? 'aborted' : 'completed',
          rest: spend(outcome.usage ?? carried?.usage ?? null) ?? undefined,
          cost: costOf(outcome.meta ?? carried?._meta) ?? undefined,
          failure,
          cause: outcome._tag === 'Failed' ? classOf(outcome.cause) : undefined,
          finish: stopped === null ? undefined : FINISHES[stopped],
          stoppedBy: null,
          launch: event.delivery === 'refused' && outcome._tag === 'Failed' ? ('passing' as const) : undefined,
        });
        if (turn === undefined) break;
        closed.push({ ...turn, said: turn.said || (failure ?? '') });
        turns = turns.filter((standing) => standing.id !== event.turn);
        break;
      }
      case 'Interrupted': {
        flush(event.turn);
        const turn = turns.find((standing) => standing.id === event.turn);
        if (turn === undefined) break;
        ended.push({ turn: turn.id, at, status: 'aborted', failure: null, stoppedBy: event.by });
        closed.push(turn);
        turns = turns.filter((standing) => standing.id !== event.turn);
        break;
      }
      case 'Sealed': {
        if (!hosted) break;
        const turn = turns.at(-1);
        if (event.said === null || turn === undefined) {
          failure = 'The agent supplied an unreadable assistant-message boundary.';
          break;
        }
        const ids = new Set(turn.assistant.flatMap((part) => (part.type === 'tool-call' ? [part.id] : [])));
        if (event.said.toolCallIds.some((id) => !ids.has(id))) {
          failure = 'The agent closed an assistant message before introducing its tool calls.';
          break;
        }
        flush(turn.id, event.said.messageId);
        break;
      }
      case 'Uncertain': {
        for (const ask of event.asks) {
          if (ask.turn === null || !open(ask.turn)) continue;
          boundaries.push({
            type: 'interruption',
            id: interruptionEntryId(`${ask.turn}:ask:${ask.id}`),
            runId: ask.turn,
            text:
              ask.answer === null
                ? 'This agent question became uncertain after output was lost; it cannot be answered safely.'
                : 'Delivery of this answer to the agent is unconfirmed. It will not be sent twice; cancel the turn if the agent keeps waiting.',
            occurredAt: at,
          });
        }
        break;
      }
      case 'Gapped': {
        const turn = turns.at(-1)?.id ?? `gap:${event.from}`;
        boundaries.push({
          type: 'interruption',
          id: interruptionEntryId(`${turn}:gap:${event.to}`),
          runId: turn,
          text: `The agent's output from byte ${event.from} to ${event.to} was evicted before Tagma read it; what it said there is lost.`,
          occurredAt: at,
        });
        break;
      }
    }
  }
  return { boundaries, ended, turns, closed, vendor, heard, messages, failure };
};
