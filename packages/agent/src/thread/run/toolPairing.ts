import { type ContentPart, Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { isVendorBoundary } from '../../agent/AgentSignal';

const NEVER_ANSWERED = 'The tool call did not finish: the run that made it ended first.';

export function pairedForProvider(history: readonly Message[]): readonly Message[] {
  const messages = history.some(isVendorBoundary) ? history.filter((message) => !isVendorBoundary(message)) : history;
  const calls = new Map<string, string>();
  const results = new Map<string, ContentPart>();
  for (const message of messages) {
    for (const part of message.content) {
      if (message.role === 'assistant' && part.type === 'tool-call' && part.providerExecuted !== true) {
        calls.set(part.id, part.name);
      }
      if (message.role === 'tool' && part.type === 'tool-result') results.set(part.id, part);
    }
  }
  if (alreadyPaired(messages)) return messages;

  const paired: Message[] = [];
  for (const message of messages) {
    if (message.role === 'tool') continue;
    paired.push(message);
    const answering = localCallIds(message);
    if (answering.length === 0) continue;
    paired.push(
      Message.make({
        role: 'tool',
        content: answering.map(
          (id) => results.get(id) ?? ToolResultPart.from({ id, name: calls.get(id) ?? id, result: NEVER_ANSWERED, resultType: 'error' }),
        ),
        origin: message.origin,
      }),
    );
  }
  return paired;
}

function localCallIds(message: Message): readonly string[] {
  if (message.role !== 'assistant') return [];
  return message.content.flatMap((part) => (part.type === 'tool-call' && part.providerExecuted !== true ? [part.id] : []));
}

export function alreadyPaired(messages: readonly Message[]): boolean {
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (!message) return true;
    const answering = localCallIds(message);
    if (answering.length === 0) {
      if (message.role === 'tool') return false;
      index += 1;
      continue;
    }
    const answer = messages[index + 1];
    if (!answer || answer.role !== 'tool' || answer.content.length !== answering.length) return false;
    for (const [at, part] of answer.content.entries()) {
      if (part.type !== 'tool-result' || part.id !== answering[at]) return false;
    }
    index += 2;
  }
  return true;
}
