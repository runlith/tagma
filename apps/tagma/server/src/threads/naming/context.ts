import { agentOriginOf, agentReaderInput } from '@runlith/agent/AgentSignal';
import type { Message } from '@runlith/llm/schema/messages';

const reader = (message: Message): boolean =>
  message.role === 'user' && (agentOriginOf(message) === undefined || agentReaderInput(message) !== undefined);

export function titleContext(history: readonly Message[], budget: number): string {
  const opening: string[] = [];
  let room = budget + 1;
  outer: for (const message of history) {
    if (!reader(message)) continue;
    for (const part of message.content) {
      if (part.type !== 'text' || !/\S/u.test(part.text)) continue;
      if (opening.length > 0) {
        opening.push('\n');
        room -= 1;
      }
      if (room > 0) {
        const text = part.text.slice(0, room);
        opening.push(text);
        room -= text.length;
      }
      if (room === 0) break outer;
    }
  }
  const prefix = opening.join('');
  if (prefix.length <= budget) return prefix;
  const gap = '\n…\n'.slice(0, budget);
  const openingRoom = Math.ceil((budget - gap.length) / 2);
  const recent: string[] = [];
  room = budget - gap.length - openingRoom;
  tail: for (let index = history.length - 1; index >= 0 && room > 0; index -= 1) {
    const message = history[index]!;
    if (!reader(message)) continue;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex]!;
      if (part.type !== 'text' || !/\S/u.test(part.text)) continue;
      if (recent.length > 0) {
        recent.push('\n');
        room -= 1;
      }
      if (room > 0) {
        const text = part.text.slice(-room);
        recent.push(text);
        room -= text.length;
      }
      if (room === 0) break tail;
    }
  }
  return prefix.slice(0, openingRoom) + gap + recent.reverse().join('');
}
