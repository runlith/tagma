import { type ContentPart, LLMRequest, Message, ToolDefinition } from './schema/messages';
import { CacheHint, type CachePolicy, type CachePolicyObject } from './schema/options';

const AUTO: CachePolicyObject = {
  tools: true,
  system: true,
  messages: 'latest-message',
};

const NONE: CachePolicyObject = {};

export const resolveCachePolicy = (policy: CachePolicy | undefined): CachePolicyObject => resolve(policy);

const resolve = (policy: CachePolicy | undefined): CachePolicyObject => {
  if (policy === undefined || policy === 'auto') return AUTO;
  if (policy === 'none') return NONE;
  return policy;
};

const makeHint = (ttlSeconds: number | undefined): CacheHint =>
  ttlSeconds !== undefined ? new CacheHint({ type: 'ephemeral', ttlSeconds }) : new CacheHint({ type: 'ephemeral' });

const markLastTool = (tools: ReadonlyArray<ToolDefinition>, hint: CacheHint): ReadonlyArray<ToolDefinition> => {
  if (tools.length === 0) return tools;
  const last = tools.length - 1;
  if (tools[last]!.cache) return tools;
  return tools.map((tool, i) => (i === last ? new ToolDefinition({ ...tool, cache: hint }) : tool));
};

const markLastSystem = (system: LLMRequest['system'], hint: CacheHint): LLMRequest['system'] => {
  if (system.length === 0) return system;
  const last = system.length - 1;
  if (system[last]!.cache) return system;
  return system.map((part, i) => (i === last ? { ...part, cache: hint } : part));
};

const lastIndexOfRole = (messages: ReadonlyArray<Message>, role: Message['role']): number => messages.findLastIndex((m) => m.role === role);

const markableIndex = (message: Message): number => message.content.findLastIndex((part) => part.type !== 'reasoning');

const markMessageAt = (messages: ReadonlyArray<Message>, index: number, hint: CacheHint): ReadonlyArray<Message> => {
  if (index < 0 || index >= messages.length) return messages;
  const target = messages[index]!;
  const markAt = markableIndex(target);
  if (markAt < 0) return messages;
  const existing = target.content[markAt]!;
  if ('cache' in existing && existing.cache) return messages;
  const nextContent = target.content.map((part, i) => (i === markAt ? ({ ...part, cache: hint } as ContentPart) : part));
  const next = new Message({ ...target, content: nextContent });
  const result = messages.slice();
  result[index] = next;
  return result;
};

const markLatest = (messages: ReadonlyArray<Message>, hint: CacheHint): ReadonlyArray<Message> => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (markableIndex(messages[i]!) >= 0) return markMessageAt(messages, i, hint);
  }
  return messages;
};

const markMessages = (
  messages: ReadonlyArray<Message>,
  strategy: NonNullable<CachePolicyObject['messages']>,
  hint: CacheHint,
): ReadonlyArray<Message> => {
  if (messages.length === 0) return messages;
  if (strategy === 'latest-message') return markLatest(messages, hint);
  if (strategy === 'latest-assistant') return markMessageAt(messages, lastIndexOfRole(messages, 'assistant'), hint);
  const start = Math.max(0, messages.length - strategy.tail);
  let next = messages;
  for (let i = start; i < messages.length; i++) next = markMessageAt(next, i, hint);
  return next;
};

export const applyCachePolicy = (request: LLMRequest): LLMRequest => {
  if (!request.model.route.inlineCacheHints) return request;
  const policy = resolve(request.cache);
  if (!policy.tools && !policy.system && !policy.messages) return request;

  const hint = makeHint(policy.ttlSeconds);
  const tools = policy.tools ? markLastTool(request.tools, hint) : request.tools;
  const system = policy.system ? markLastSystem(request.system, hint) : request.system;
  const messages = policy.messages ? markMessages(request.messages, policy.messages, hint) : request.messages;

  if (tools === request.tools && system === request.system && messages === request.messages) return request;
  return LLMRequest.update(request, { tools, system, messages });
};
