import type { ContentPart, MediaPart, Message, ToolResultValue } from '@runlith/llm/schema/messages';
import { resultFlags } from '@runlith/agent/thread/run/hostedReplay';
import { opensTurnMessage } from '@runlith/agent/AgentSignal';
import type { HostedContent, HostedMessage } from './contract/wire/hosted.js';

const DATA_URI = /^data:([^;,]+);base64,(.*)$/s;

const pictured = (mime: string, uri: string, name: string | undefined): HostedContent => {
  const inline = DATA_URI.exec(uri);
  return inline !== null && mime.startsWith('image/')
    ? { type: 'image', data: inline[2]!, mimeType: inline[1]! }
    : { type: 'text', text: `[${mime} ${name ?? uri}]` };
};

const media = (part: MediaPart): HostedContent =>
  typeof part.data === 'string'
    ? pictured(part.mediaType, part.data, part.filename)
    : part.mediaType.startsWith('image/')
      ? {
          type: 'image',
          data: Buffer.from(part.data.buffer, part.data.byteOffset, part.data.byteLength).toString('base64'),
          mimeType: part.mediaType,
        }
      : { type: 'text', text: `[${part.mediaType} ${part.filename ?? 'attachment'}]` };

export const hostedContent = (output: ToolResultValue, guides: readonly string[]): readonly HostedContent[] => {
  const said: HostedContent[] =
    output.type === 'content'
      ? output.value.map((part): HostedContent =>
          part.type === 'text' ? { type: 'text', text: part.text } : pictured(part.mime, part.uri, part.name),
        )
      : [{ type: 'text', text: typeof output.value === 'string' ? output.value : JSON.stringify(output.value) }];
  return [...said, ...guides.map((text): HostedContent => ({ type: 'text', text }))];
};

const recorded = (part: ContentPart): string | null => {
  if (part.type === 'tool-call' && part.providerExecuted === true)
    return `Recorded provider tool request: ${JSON.stringify({ id: part.id, name: part.name, input: part.input })}`;
  if (part.type !== 'tool-result' || part.providerExecuted !== true) return null;
  const said = hostedContent(part.result, []).flatMap((item) => (item.type === 'text' ? [item.text] : []));
  return [`Recorded provider tool result: ${JSON.stringify({ id: part.id, name: part.name, type: part.result.type })}`, ...said].join('\n');
};

const spoken = (message: Message): readonly HostedContent[] =>
  message.content.flatMap((part): HostedContent[] => {
    if (part.type === 'text') return part.text.trim() === '' ? [] : [{ type: 'text', text: part.text }];
    if (part.type === 'media') return [media(part)];
    const text = recorded(part);
    return text === null ? [] : [{ type: 'text', text }];
  });

const answered = (message: Message): HostedMessage[] => {
  const content: Extract<HostedMessage, { readonly role: 'assistant' }>['content'][number][] = [];
  for (const part of message.content) {
    if (part.type === 'tool-call' && part.providerExecuted !== true)
      content.push({ type: 'call', id: part.id, name: part.name, input: part.input });
    else if (part.type === 'text' && part.text.trim() !== '') content.push({ type: 'text', text: part.text });
    else {
      const text = recorded(part);
      if (text !== null) content.push({ type: 'text', text });
    }
  }
  return content.length === 0 ? [] : [{ role: 'assistant', content }];
};

export const hostedTurns = (messages: readonly Message[]): readonly (readonly Message[])[] => {
  const turns: Message[][] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (opensTurnMessage(message) || last === undefined) turns.push([message]);
    else last.push(message);
  }
  return turns;
};

export const hostedHistory = (messages: readonly Message[]): readonly HostedMessage[] =>
  messages.flatMap((message): HostedMessage[] => {
    if (message.role === 'assistant') return answered(message);
    if (message.role === 'tool') {
      return message.content.flatMap((part): HostedMessage[] =>
        part.type === 'tool-result' && part.providerExecuted !== true
          ? [{ role: 'result', id: part.id, content: hostedContent(part.result, []), failed: resultFlags(part).failed }]
          : [],
      );
    }
    const content = spoken(message);
    return content.length === 0 ? [] : [{ role: 'user', content }];
  });
