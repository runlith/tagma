import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const FORMER = 'plugin__';
const CURRENT = 'app__';

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

const renamed = (name: unknown): unknown =>
  typeof name === 'string' && name.startsWith(FORMER) ? `${CURRENT}${name.slice(FORMER.length)}` : name;

const renamedAll = (names: unknown): unknown => {
  if (!Array.isArray(names)) return names;
  const next = names.map(renamed);
  return next.every((name, at) => name === names[at]) ? names : next;
};

const part = (value: unknown): unknown => {
  if (!isRecord(value) || (value.type !== 'tool-call' && value.type !== 'tool-result')) return value;
  const name = renamed(value.name);
  const references = renamedAll(value.toolReferences);
  if (name === value.name && references === value.toolReferences) return value;
  return value.toolReferences === undefined ? { ...value, name } : { ...value, name, toolReferences: references };
};

const calls = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  const next = value.map((call: unknown) => {
    if (!isRecord(call)) return call;
    const toolName = renamed(call.toolName);
    return toolName === call.toolName ? call : { ...call, toolName };
  });
  return next.every((call, at) => call === value[at]) ? value : next;
};

export const toolNamesForm: ThreadFormStep = {
  name: '20261029173000_app_tool_names',
  samples: {
    payload: { contextChange: { evidence: { tools: ['read_settings', 'plugin__board__deal'] } } },
    entry: { type: 'tool', id: 'e', toolName: 'plugin__board__deal', toolCallId: 'c' },
    message: {
      role: 'assistant',
      content: [
        { type: 'tool-call', id: 'c', name: 'plugin__board__deal', input: {} },
        {
          type: 'tool-result',
          id: 'c',
          name: 'plugin__board__deal',
          result: { type: 'text', value: 'dealt' },
          toolReferences: ['plugin__board__look'],
        },
      ],
    },
  },
  payload: (payload) => {
    const context = payload.contextChange;
    if (!isRecord(context) || !isRecord(context.evidence)) return null;
    const tools = renamedAll(context.evidence.tools);
    return tools === context.evidence.tools
      ? null
      : { ...payload, contextChange: { ...context, evidence: { ...context.evidence, tools } } };
  },
  entry: (entry) => {
    const toolName = renamed(entry.toolName);
    const toolCalls = calls(entry.toolCalls);
    const listed = calls(entry.calls);
    if (toolName === entry.toolName && toolCalls === entry.toolCalls && listed === entry.calls) return null;
    const next: Record<string, unknown> = { ...entry };
    if (toolName !== entry.toolName) next.toolName = toolName;
    if (toolCalls !== entry.toolCalls) next.toolCalls = toolCalls;
    if (listed !== entry.calls) next.calls = listed;
    return next;
  },
  message: (message) => {
    const content = message.content;
    if (!Array.isArray(content)) return null;
    const next = content.map(part);
    return next.every((value, at) => value === content[at]) ? null : { ...message, content: next };
  },
};
