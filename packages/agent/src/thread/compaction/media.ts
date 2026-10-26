import { type ContentPart, type MediaPart, Message, type ToolResultPart } from '@runlith/llm/schema/messages';
import type { ToolContent } from '@runlith/llm/schema/tool-content';
import { opensTurnMessage } from '../../agent/AgentSignal';

export type ThreadPicture = {
  readonly location: string | null;
  readonly index: number;
  readonly tool: boolean;
};

export function pictureKey(index: number, location: string): string {
  return `${index}\u0000${location}`;
}

export function isPicturePart(part: ContentPart): part is MediaPart {
  return part.type === 'media' && part.mediaType.startsWith('image/');
}

export function latestTurnStart(messages: readonly Message[]): number {
  const start = messages.findLastIndex(opensTurnMessage);
  return start < 0 ? messages.length : start;
}

export function omitThreadMedia(
  messages: readonly Message[],
  omits: (picture: ThreadPicture) => boolean,
  marker: (mediaType: string | undefined) => string,
): { readonly messages: readonly Message[]; readonly omitted: number } {
  let omitted = 0;
  const projected = messages.map((message, index): Message => {
    if (message.role === 'user') {
      if (!message.content.some(isPicturePart)) return message;
      let changed = false;
      const content = message.content.map((part) => {
        if (!isPicturePart(part)) return part;
        if (!omits({ location: typeof part.data === 'string' ? part.data : null, index, tool: false })) return part;
        omitted += 1;
        changed = true;
        return { type: 'text' as const, text: marker(part.mediaType) };
      });
      return changed ? Message.make({ ...message, content }) : message;
    }
    if (!message.content.some(holdsFiles)) return message;
    let changed = false;
    const content = message.content.map((part) => {
      if (!holdsFiles(part)) return part;
      const value = part.result.value.map((item) => {
        if (item.type !== 'file' || !omits({ location: item.uri, index, tool: true })) return item;
        omitted += 1;
        changed = true;
        return { type: 'text' as const, text: marker(item.mime) };
      });
      return { ...part, result: { type: 'content' as const, value } };
    });
    return changed ? Message.make({ ...message, content }) : message;
  });
  return omitted === 0 ? { messages, omitted } : { messages: projected, omitted };
}

type FileResult = ToolResultPart & { readonly result: { readonly type: 'content'; readonly value: readonly ToolContent[] } };

function holdsFiles(part: ContentPart): part is FileResult {
  return part.type === 'tool-result' && part.result.type === 'content' && part.result.value.some((item) => item.type === 'file');
}
