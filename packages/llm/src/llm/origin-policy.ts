import { type ContentPart, LLMRequest, Message } from './schema/messages';
import { ModelIdentity } from './schema/options';

export const applyOriginPolicy = (request: LLMRequest): LLMRequest => {
  const caller = ModelIdentity.of(request.model);
  const compatible = compatibleOrigins(request.messages, caller);
  if (request.messages.every((message) => compatible.some((origin) => ModelIdentity.same(message.origin, origin)))) return request;
  const messages: Message[] = [];
  const pending = new Set<string>();
  const deferred: Message[] = [];
  for (const source of request.messages) {
    const start = messages.length;
    for (const { message, historical } of portableFor(source, compatible)) {
      if (historical && pending.size > 0) {
        deferred.push(message);
        continue;
      }
      const previous = messages.at(-1);
      if (messages.length > start && previous?.role === 'assistant' && message.role === 'assistant') {
        messages[messages.length - 1] = new Message({ ...previous, content: [...previous.content, ...message.content] });
      } else {
        messages.push(message);
      }
      for (const part of message.content) {
        if (message.role === 'assistant' && part.type === 'tool-call' && part.providerExecuted !== true) pending.add(part.id);
        if (message.role === 'tool' && part.type === 'tool-result') pending.delete(part.id);
      }
      if (pending.size === 0) messages.push(...deferred.splice(0));
    }
  }
  messages.push(...deferred);
  return LLMRequest.update(request, { messages });
};

const compatibleOrigins = (messages: readonly Message[], caller: ModelIdentity): readonly ModelIdentity[] => {
  const compatible = [caller];
  for (let index = messages.length - 1; index >= 0; index--) {
    for (const part of messages[index]?.content ?? []) {
      if (part.type !== 'model-fallback') continue;
      if (
        compatible.some((origin) => ModelIdentity.same(part.to, origin)) &&
        !compatible.some((origin) => ModelIdentity.same(part.from, origin))
      )
        compatible.push(part.from);
    }
  }
  return compatible;
};

const portableFor = (message: Message, callers: readonly ModelIdentity[]): readonly { message: Message; historical: boolean }[] => {
  if (callers.some((caller) => ModelIdentity.same(message.origin, caller))) return [{ message, historical: false }];
  const { native: _native, id, requestId, ...rest } = message;
  const messages: { message: Message; historical: boolean }[] = [];
  let role = message.role;
  let historical = false;
  let content: ContentPart[] = [];
  const flush = () => {
    if (content.length === 0) return;
    messages.push({
      message: new Message({
        ...rest,
        id: messages.length === 0 ? id : undefined,
        requestId: messages.length === 0 ? requestId : undefined,
        role,
        content,
      }),
      historical,
    });
    content = [];
  };
  for (const part of message.content) {
    if (part.type === 'reasoning' || part.type === 'model-fallback') continue;
    const hosted = (part.type === 'tool-call' || part.type === 'tool-result') && part.providerExecuted === true;
    const nextHistorical = hosted && part.type === 'tool-result';
    const nextRole = nextHistorical ? 'user' : message.role;
    if (nextRole !== role || nextHistorical !== historical) {
      flush();
      role = nextRole;
      historical = nextHistorical;
    }
    if (hosted && part.type === 'tool-call') {
      content.push(Message.text(`Recorded provider tool request: ${JSON.stringify({ id: part.id, name: part.name, input: part.input })}`));
    } else if (hosted && part.type === 'tool-result') {
      content.push(
        Message.text(`Recorded provider tool result: ${JSON.stringify({ id: part.id, name: part.name, type: part.result.type })}`),
      );
      if (part.result.type === 'content') {
        content.push(
          ...part.result.value.map((item): ContentPart =>
            item.type === 'text' ? Message.text(item.text) : { type: 'media', mediaType: item.mime, data: item.uri, filename: item.name },
          ),
        );
      } else {
        content.push(
          Message.text(typeof part.result.value === 'string' ? part.result.value : (JSON.stringify(part.result.value) ?? 'null')),
        );
      }
    } else {
      content.push(withoutProviderState(part));
    }
  }
  flush();
  return messages;
};

const withoutProviderState = (part: ContentPart): ContentPart => {
  if (part.type === 'text' && part.providerMetadata !== undefined) {
    const { providerMetadata: _dropped, ...rest } = part;
    return rest;
  }
  if (part.type === 'tool-call' && part.providerMetadata !== undefined) {
    const { providerMetadata: _dropped, ...rest } = part;
    return rest;
  }
  if (part.type === 'tool-result' && part.providerMetadata !== undefined) {
    const { providerMetadata: _dropped, ...rest } = part;
    return rest;
  }
  return part;
};
