import type { ClientEvent } from '@runlith/acp/events';
import type { AgentRequest } from '@runlith/acp/state';
import type { PermissionOption } from '@runlith/acp/methods';
import type { ToolCall } from '@runlith/acp/toolCalls';
import type { ToolKind } from '@runlith/acp/toolCalls';
import type { HarnessCall, HarnessQuestionOption, HarnessTools } from '@runlith/tagma/adapter/harness';
import { ALLOW_ONCE, DENY, PERMISSION_OPTIONS } from '../../threads/contract/wire/harness/session.js';
import type { Schema } from 'effect';
import type { ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { questionEntryId } from '@runlith/agent/transcript/entryNames';

export type PermissionAsk = Extract<AgentRequest, { readonly kind: 'permission' }>;

const TOOLS: Record<ToolKind, string> = {
  read: 'read',
  search: 'grep',
  fetch: 'webfetch',
  edit: 'write',
  delete: 'delete',
  move: 'rename',
  execute: 'bash',
  think: 'other',
  switch_mode: 'other',
  other: 'other',
};

const MUTATING: ReadonlySet<string> = new Set(['write', 'delete', 'rename', 'bash']);

const SUBJECT_KEYS = ['command', 'file_path', 'path', 'filePath', 'url', 'query', 'pattern'] as const;

const named = (input: unknown): string | null => {
  if (typeof input === 'string') {
    try {
      return named(JSON.parse(input) as unknown) ?? input;
    } catch {
      return input;
    }
  }
  if (typeof input !== 'object' || input === null) return null;
  const fields = input as Record<string, unknown>;
  for (const key of SUBJECT_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
};

export const judgedCall = (
  ask: PermissionAsk,
  known: ToolCall | undefined,
  otherMutates: boolean,
  tools: HarnessTools,
): { readonly call: HarnessCall; readonly mutating: boolean } => {
  const asked = ask.params.toolCall;
  const kind = asked.kind ?? known?.kind ?? 'other';
  const tool = (tools.names === 'vendor' ? (asked.name ?? known?.name) : undefined) ?? TOOLS[kind];
  const subject =
    named(asked.rawInput ?? known?.rawInput) ??
    asked.locations?.[0]?.path ??
    known?.locations?.[0]?.path ??
    asked.title ??
    known?.title ??
    asked.toolCallId;
  return { call: { id: asked.toolCallId, tool, subject }, mutating: TOOLS[kind] === 'other' ? otherMutates : MUTATING.has(TOOLS[kind]) };
};

const offered = (options: ReadonlyArray<PermissionOption>, kind: PermissionOption['kind']): string | null =>
  options.find((option) => option.kind === kind)?.optionId ?? null;

export const allowOnce = (ask: PermissionAsk): string | null => offered(ask.params.options, 'allow_once');

export const refusal = (ask: PermissionAsk): string | null =>
  offered(ask.params.options, 'reject_once') ?? offered(ask.params.options, 'reject_always');

const paired = (ask: PermissionAsk): boolean => allowOnce(ask) !== null && refusal(ask) !== null;

export const askOptions = (ask: PermissionAsk): readonly HarnessQuestionOption[] =>
  paired(ask) ? PERMISSION_OPTIONS : ask.params.options.map((option: PermissionOption) => ({ value: option.optionId, label: option.name }));

const approving = (ask: PermissionAsk): string | null => (paired(ask) ? ALLOW_ONCE : allowOnce(ask));

export const chosenOption = (ask: PermissionAsk, value: string): string | null => {
  if (paired(ask)) return value === ALLOW_ONCE ? allowOnce(ask) : value === DENY ? refusal(ask) : null;
  return ask.params.options.some((option) => option.optionId === value) ? value : null;
};

export const questionId = (id: string | number): string => `harness-protocol:${String(id)}`;

export const questionEntry = (
  ask: PermissionAsk,
  turn: string,
  prompt: string,
  header: string | null,
  data: { readonly [key: string]: Schema.Json },
  at: string,
): ThreadQuestionEntry => {
  const toolCallId = ask.params.toolCall.toolCallId;
  return {
    type: 'question',
    id: questionEntryId(turn, [toolCallId, String(ask.id)]),
    runId: turn,
    questionId: questionId(ask.id),
    questions: [
      {
        id: questionId(ask.id),
        kind: 'choice',
        prompt,
        header: header ?? undefined,
        options: askOptions(ask),
        approves: approving(ask) === null ? undefined : approving(ask)!,
        toolCallId,
        data,
      },
    ],
    toolCalls: [{ toolCallId, toolName: ask.params.toolCall.title ?? ask.params.toolCall.kind ?? 'tool' }],
    status: 'open',
    occurredAt: at,
    updatedAt: at,
  };
};

export type Resolution = { readonly turn: string; readonly ask: string | number };

const FINAL = new Set(['completed', 'failed']);

const endedCall = (event: ClientEvent): { readonly turn: string; readonly toolCallId: string } | null => {
  if (event._tag === 'ToolCallEnded') return { turn: event.turn, toolCallId: event.call.toolCallId };
  if (event._tag === 'ToolCallAmended' && event.update.status != null && FINAL.has(event.update.status)) {
    return { turn: event.turn, toolCallId: event.update.toolCallId };
  }
  return null;
};

export const resolutionsOf = (events: readonly ClientEvent[], standing: readonly AgentRequest[]): readonly Resolution[] => {
  const found = new Map<string | number, Resolution>();
  for (const event of events) {
    if (event._tag === 'Withdrawn' || event._tag === 'Uncertain') {
      for (const ask of event.asks) if (ask.kind === 'permission' && ask.turn !== null) found.set(ask.id, { turn: ask.turn, ask: ask.id });
      continue;
    }
    const ended = endedCall(event);
    if (ended === null) continue;
    for (const ask of standing) {
      if (
        ask.kind === 'permission' &&
        ask.answer === null &&
        ask.turn === ended.turn &&
        ask.params.toolCall.toolCallId === ended.toolCallId
      ) {
        found.set(ask.id, { turn: ended.turn, ask: ask.id });
      }
    }
  }
  return [...found.values()];
};
